// Engine: one target model (plus its speculative drafter) loaded in this process, with the
// KV cache / recurrent state of sequence 0 tracked token by token, so the agent loop can
// append to it, rewind it to a checkpoint, fork it into a scratch sequence, or read logits.
#pragma once

#include "common.h"
#include "llama.h"
#include "sampling.h"
#include "speculative.h"
#include "chat.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

// Counters for one agent run. All token counts are target-model tokens.
struct EngineStats {
    int64_t n_prompt_decoded = 0;   // prompt tokens actually run through the model (incl. re-feeds)
    int64_t n_prompt_reused  = 0;   // prompt tokens that were already in the cache
    int64_t n_refed          = 0;   // tokens re-run after a rewind (subset of n_prompt_decoded)
    int64_t n_generated      = 0;   // sampled tokens (main sequence)
    int64_t n_drafted        = 0;
    int64_t n_draft_accepted = 0;
    int64_t n_branch_decoded = 0;   // tokens decoded on the scratch sequence (decisions, summaries)
    int64_t n_branch_generated = 0;
    int64_t n_checkpoints    = 0;   // checkpoints created
    int64_t n_restores       = 0;   // checkpoint restores (rewinds)
    double  t_prompt_ms      = 0;
    double  t_gen_ms         = 0;
    double  t_branch_ms      = 0;
    double  t_ckpt_ms        = 0;
};

struct Checkpoint {
    int64_t n_tokens = 0;            // tokens of seq 0 covered by this state
    std::vector<uint8_t> tgt;        // recurrent (non-rollbackable) part of the target state
    std::vector<uint8_t> dft;        // same for the drafter, when it needs it
    std::vector<uint8_t> spec;       // speculative implementation state
    size_t bytes() const { return tgt.size() + dft.size() + spec.size(); }
};

struct GenRequest {
    llama_token id_last;                       // last prompt token, not yet decoded
    common_params_sampling sampling;           // incl. grammar from the chat session
    std::vector<std::string> stops;            // extra stop strings
    int32_t max_tokens = 32768;
    bool use_spec = true;
    bool want_entropy = true;
    // called with each newly accepted token and its text piece; return false to stop
    std::function<bool(llama_token, const std::string &)> on_token;
};

struct GenResult {
    std::vector<llama_token> tokens;           // generated tokens (eog excluded)
    std::vector<float> entropy;                // entropy (nats) of the target distribution per token
    std::string text;
    bool hit_eog = false;
    bool hit_stop = false;
    bool hit_limit = false;
    bool stopped_by_callback = false;
    double ttft_ms = 0;                        // first token after generate() was called
    double t_ms = 0;
};

class Engine {
public:
    explicit Engine(common_params & params);
    ~Engine();

    bool ok() const { return ctx != nullptr; }

    const llama_vocab * vocab() const { return voc; }
    llama_model   * model()  const { return mdl; }
    llama_context * context() const { return ctx; }
    const common_chat_templates * templates() const { return tmpls.get(); }
    common_params & params() { return prm; }
    int32_t n_ctx() const;

    std::vector<llama_token> tokenize(const std::string & text, bool parse_special = true) const;
    std::string piece(llama_token t, bool special) const;
    std::string detok(const std::vector<llama_token> & toks) const;

    // tokens currently in seq 0, in position order
    const std::vector<llama_token> & cached() const { return kv; }

    // Run tokens through the target (and drafter) appended to seq 0. No logits are kept.
    // `reason` selects the counter: false = new prompt tokens, true = re-feed after a rewind.
    bool feed(const std::vector<llama_token> & toks, bool refeed = false,
              const std::vector<int64_t> & ckpt_at = {});

    // Generate on seq 0 starting from req.id_last.
    GenResult generate(GenRequest & req);

    // Make seq 0 hold exactly the first n tokens of `target` (a token list that shares a prefix
    // with what is cached). Reuses the longest cached prefix, rewinding to the nearest usable
    // checkpoint, and re-feeds the rest. Returns false on failure.
    // After the call cached() == target[0..n).
    bool sync_to(const std::vector<llama_token> & target, size_t n,
                 const std::vector<int64_t> & ckpt_at = {});

    // checkpoints of seq 0
    void checkpoint();                         // at the current end of seq 0
    void drop_checkpoints_after(int64_t n_tokens);
    const std::vector<Checkpoint> & checkpoints() const { return ckpts; }
    size_t checkpoint_bytes() const;
    void set_max_checkpoints(int n) { max_ckpts = n; }

    // Clear everything in seq 0 (new task).
    void reset();

    // Save / restore the full state of seq 0 (target only) to memory, for cross-task prefix reuse.
    bool snapshot(std::vector<uint8_t> & out, std::vector<llama_token> & toks);
    bool restore_snapshot(const std::vector<uint8_t> & data, const std::vector<llama_token> & toks);

    // ---- scratch branch (seq 1): fork the main sequence, append text, read logits / generate ----
    bool has_branch() const { return n_seq_max > 1; }
    // Fork seq 0 into seq 1, feed `suffix` on seq 1. Returns false if not supported.
    bool branch_begin(const std::vector<llama_token> & suffix);
    // log-probabilities of the given candidate tokens as the next token of the branch
    std::vector<float> branch_logprobs(const std::vector<llama_token> & cands);
    // sample on the branch (no speculation); stops at eog or max_tokens
    GenResult branch_generate(common_params_sampling sampling, int32_t max_tokens,
                              const std::vector<std::string> & stops = {});
    void branch_end();

    EngineStats stats;

    // memory used on each GPU right now (MiB), via the backend devices
    static std::vector<std::pair<std::string, size_t>> device_used_mib();

private:
    bool decode_chunked(const std::vector<llama_token> & toks, llama_seq_id seq, llama_pos pos0,
                        bool last_logits, bool feed_spec, const std::vector<int64_t> & ckpt_at);
    bool restore(const Checkpoint & c);
    bool can_partial_rm(size_t n_drop) const;

    common_params & prm;
    common_init_result_ptr init;
    common_speculative_init_result_ptr spec_init;
    common_speculative * spec = nullptr;
    common_chat_templates_ptr tmpls;
    llama_model * mdl = nullptr;
    llama_context * ctx = nullptr;
    llama_context * ctx_dft = nullptr;
    const llama_vocab * voc = nullptr;
    common_context_seq_rm_type rm_tgt = COMMON_CONTEXT_SEQ_RM_TYPE_PART;
    common_context_seq_rm_type rm_dft = COMMON_CONTEXT_SEQ_RM_TYPE_PART;
    uint32_t n_seq_max = 1;
    std::vector<llama_token> kv;     // seq 0 tokens
    std::vector<Checkpoint> ckpts;   // sorted by n_tokens
    int max_ckpts = 16; // ~150 MB each for Qwen3.8-27B (recurrent state); LLAMA_NATIVE_MAX_CKPT overrides
    // branch
    llama_pos branch_pos = 0;
    bool branch_active = false;
    std::vector<llama_token> branch_tokens;
};
