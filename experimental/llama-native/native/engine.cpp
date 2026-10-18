#include "engine.h"

#include "log.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <climits>

float logits_entropy(const float * l, int n); // entropy.cpp

static double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

Engine::Engine(common_params & params) : prm(params) {
    const auto lim = common_speculative_get_output_limits(
            prm.n_batch, prm.n_parallel, common_speculative_n_max(&prm.speculative));
    prm.n_outputs_max         = std::max<int32_t>(1, lim.total);
    prm.n_outputs_max_per_seq = std::max<int32_t>(1, lim.per_seq);

    init = common_init_from_params(prm);
    mdl  = init->model();
    ctx  = init->context();
    if (!mdl || !ctx) {
        LOG_ERR("failed to load model '%s'\n", prm.model.path.c_str());
        ctx = nullptr;
        return;
    }
    voc = llama_model_get_vocab(mdl);

    const bool spec_mtp = std::find(prm.speculative.types.begin(), prm.speculative.types.end(),
                                    COMMON_SPECULATIVE_TYPE_DRAFT_MTP) != prm.speculative.types.end();
    const bool spec_any = std::any_of(prm.speculative.types.begin(), prm.speculative.types.end(),
                                      [](auto t) { return t != COMMON_SPECULATIVE_TYPE_NONE; });
    if (prm.speculative.has_dft() || spec_mtp) {
        common_params params_dft = common_base_params_to_speculative(prm);
        spec_init = common_speculative_init_from_params(params_dft, mdl, ctx);
        ctx_dft   = spec_init->context();
        if (!ctx_dft) {
            LOG_ERR("%s", "failed to create the draft context\n");
            ctx = nullptr;
            return;
        }
        prm.speculative.draft.ctx_tgt = ctx;
        prm.speculative.draft.ctx_dft = ctx_dft;
    }
    if (spec_any) {
        spec = common_speculative_init(prm.speculative, 1);
        if (!spec) {
            LOG_WRN("%s", "speculative decoding requested but could not be initialised; continuing without it\n");
        }
    }

    rm_tgt = common_context_can_seq_rm(ctx);
    if (ctx_dft) {
        rm_dft = common_context_can_seq_rm(ctx_dft);
    }
    n_seq_max = llama_n_seq_max(ctx);
    tmpls = common_chat_templates_init(mdl, prm.chat_template);

    LOG_INF("engine: n_ctx=%d n_seq_max=%u seq_rm(tgt)=%d seq_rm(dft)=%d n_rs_seq=%u spec=%s\n",
            n_ctx(), n_seq_max, (int) rm_tgt, (int) rm_dft, llama_n_rs_seq(ctx), spec ? "on" : "off");
}

Engine::~Engine() {
    if (spec) {
        common_speculative_free(spec);
    }
}

int32_t Engine::n_ctx() const { return ctx ? (int32_t) llama_n_ctx(ctx) : 0; }

std::vector<llama_token> Engine::tokenize(const std::string & text, bool parse_special) const {
    return common_tokenize(voc, text, /*add_special*/ false, parse_special);
}

std::string Engine::piece(llama_token t, bool special) const {
    return common_token_to_piece(voc, t, special);
}

std::string Engine::detok(const std::vector<llama_token> & toks) const {
    std::string s;
    for (auto t : toks) {
        s += common_token_to_piece(voc, t, true);
    }
    return s;
}

bool Engine::can_partial_rm(size_t n_drop) const {
    if (n_drop == 0) {
        return true;
    }
    switch (rm_tgt) {
        case COMMON_CONTEXT_SEQ_RM_TYPE_PART: return true;
        case COMMON_CONTEXT_SEQ_RM_TYPE_RS:   return n_drop <= llama_n_rs_seq(ctx);
        default:                              return false;
    }
}

bool Engine::decode_chunked(const std::vector<llama_token> & toks, llama_seq_id seq, llama_pos pos0,
                            bool last_logits, bool feed_spec, const std::vector<int64_t> & ckpt_at) {
    const int32_t n_batch = (int32_t) llama_n_batch(ctx);
    size_t i = 0;
    while (i < toks.size()) {
        size_t end = std::min(toks.size(), i + (size_t) n_batch);
        // split at requested checkpoint positions, so the state can be saved exactly there
        if (seq == 0) {
            for (int64_t at : ckpt_at) {
                const int64_t rel = at - pos0;
                if (rel > (int64_t) i && rel < (int64_t) end) {
                    end = (size_t) rel;
                }
            }
        }
        common_batch b(ctx);
        for (size_t k = i; k < end; ++k) {
            b.add(toks[k], pos0 + (llama_pos) k, seq, last_logits && k + 1 == toks.size());
        }
        const int32_t rc = llama_process(ctx, LLAMA_PROCESS_TYPE_DECODE, b.get());
        if (rc != 0) {
            LOG_ERR("llama_process failed rc=%d (seq %d, %zu tokens at %d)\n", rc, seq, end - i, pos0 + (int) i);
            return false;
        }
        if (feed_spec && spec && seq == 0) {
            if (!common_speculative_process(spec, b)) {
                LOG_ERR("%s", "speculative process failed\n");
                return false;
            }
        }
        if (seq == 0) {
            kv.insert(kv.end(), toks.begin() + i, toks.begin() + end);
            for (int64_t at : ckpt_at) {
                if (at == (int64_t) kv.size()) {
                    checkpoint();
                }
            }
        }
        i = end;
    }
    return true;
}

bool Engine::feed(const std::vector<llama_token> & toks, bool refeed, const std::vector<int64_t> & ckpt_at) {
    if (toks.empty()) {
        return true;
    }
    if ((int64_t) kv.size() + (int64_t) toks.size() >= n_ctx()) {
        LOG_ERR("context full: %zu + %zu >= %d\n", kv.size(), toks.size(), n_ctx());
        return false;
    }
    for (int64_t at : ckpt_at) {
        if (at == (int64_t) kv.size()) {
            checkpoint();
        }
    }
    const double t0 = now_ms();
    const bool ok = decode_chunked(toks, 0, (llama_pos) kv.size(), false, true, ckpt_at);
    stats.t_prompt_ms += now_ms() - t0;
    stats.n_prompt_decoded += toks.size();
    if (refeed) {
        stats.n_refed += toks.size();
    }
    return ok;
}

void Engine::checkpoint() {
    if (rm_tgt == COMMON_CONTEXT_SEQ_RM_TYPE_PART && rm_dft == COMMON_CONTEXT_SEQ_RM_TYPE_PART) {
        return; // plain KV cache: any prefix can be kept with seq_rm, no state to save
    }
    if (!ckpts.empty() && ckpts.back().n_tokens == (int64_t) kv.size()) {
        return;
    }
    const double t0 = now_ms();
    Checkpoint c;
    c.n_tokens = (int64_t) kv.size();
    if (rm_tgt != COMMON_CONTEXT_SEQ_RM_TYPE_PART) {
        const size_t sz = llama_state_seq_get_size_ext(ctx, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
        c.tgt.resize(sz);
        llama_state_seq_get_data_ext(ctx, c.tgt.data(), sz, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
    }
    if (ctx_dft && rm_dft != COMMON_CONTEXT_SEQ_RM_TYPE_PART) {
        const size_t sz = llama_state_seq_get_size_ext(ctx_dft, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
        c.dft.resize(sz);
        llama_state_seq_get_data_ext(ctx_dft, c.dft.data(), sz, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
    }
    if (spec) {
        common_speculative_get_state(spec, 0, c.spec);
    }
    // keep sorted; drop any stale checkpoint past this point
    drop_checkpoints_after(c.n_tokens - 1);
    ckpts.push_back(std::move(c));
    // evict: keep the first (stable prefix) and the newest; drop the one in the densest spot so
    // the remaining checkpoints stay spread over the whole conversation
    while ((int) ckpts.size() > max_ckpts && ckpts.size() > 2) {
        size_t best = 1;
        int64_t best_gap = INT64_MAX;
        for (size_t i = 1; i + 1 < ckpts.size(); ++i) {
            const int64_t gap = ckpts[i + 1].n_tokens - ckpts[i - 1].n_tokens;
            if (gap < best_gap) {
                best_gap = gap;
                best = i;
            }
        }
        ckpts.erase(ckpts.begin() + best);
    }
    stats.n_checkpoints++;
    stats.t_ckpt_ms += now_ms() - t0;
}

void Engine::drop_checkpoints_after(int64_t n_tokens) {
    while (!ckpts.empty() && ckpts.back().n_tokens > n_tokens) {
        ckpts.pop_back();
    }
}

size_t Engine::checkpoint_bytes() const {
    size_t s = 0;
    for (auto & c : ckpts) {
        s += c.bytes();
    }
    return s;
}

bool Engine::restore(const Checkpoint & c) {
    const double t0 = now_ms();
    auto * mem = llama_get_memory(ctx);
    if (!c.tgt.empty()) {
        if (llama_state_seq_set_data_ext(ctx, c.tgt.data(), c.tgt.size(), 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY) == 0) {
            LOG_ERR("%s", "failed to restore target checkpoint\n");
            return false;
        }
    }
    if (!llama_memory_seq_rm(mem, 0, (llama_pos) c.n_tokens, -1)) {
        LOG_ERR("seq_rm after restore failed at %lld\n", (long long) c.n_tokens);
        return false;
    }
    if (ctx_dft) {
        if (!c.dft.empty()) {
            llama_state_seq_set_data_ext(ctx_dft, c.dft.data(), c.dft.size(), 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
        }
        llama_memory_seq_rm(llama_get_memory(ctx_dft), 0, (llama_pos) c.n_tokens, -1);
    }
    if (spec && !c.spec.empty()) {
        common_speculative_set_state(spec, 0, c.spec);
    }
    kv.resize(c.n_tokens);
    stats.n_restores++;
    stats.t_ckpt_ms += now_ms() - t0;
    return true;
}

void Engine::reset() {
    llama_memory_clear(llama_get_memory(ctx), true);
    if (ctx_dft) {
        llama_memory_clear(llama_get_memory(ctx_dft), true);
    }
    kv.clear();
    ckpts.clear();
}

bool Engine::sync_to(const std::vector<llama_token> & target, size_t n, const std::vector<int64_t> & ckpt_at) {
    n = std::min(n, target.size());
    size_t common = 0;
    while (common < kv.size() && common < n && kv[common] == target[common]) {
        common++;
    }
    size_t start = kv.size();
    if (common < kv.size()) {
        const size_t n_drop = kv.size() - common;
        if (can_partial_rm(n_drop)) {
            auto * mem = llama_get_memory(ctx);
            if (!llama_memory_seq_rm(mem, 0, (llama_pos) common, -1)) {
                LOG_ERR("%s", "partial seq_rm failed\n");
                return false;
            }
            if (ctx_dft) {
                llama_memory_seq_rm(llama_get_memory(ctx_dft), 0, (llama_pos) common, -1);
            }
            kv.resize(common);
            drop_checkpoints_after((int64_t) common);
        } else {
            // newest checkpoint at or before the divergence point
            const Checkpoint * best = nullptr;
            for (auto & c : ckpts) {
                if (c.n_tokens <= (int64_t) common) {
                    best = &c;
                }
            }
            if (best) {
                const int64_t at = best->n_tokens;
                if (!restore(*best)) {
                    return false;
                }
                drop_checkpoints_after(at);
            } else {
                reset();
            }
        }
        start = kv.size();
    }
    // tokens between the restore point and the divergence point were cached before: re-fed
    const size_t n_refeed = common > start ? common - start : 0;
    stats.n_prompt_reused += start;
    if (n_refeed > 0) {
        std::vector<llama_token> a(target.begin() + start, target.begin() + common);
        if (!feed(a, true, ckpt_at)) {
            return false;
        }
    }
    if (kv.size() < n) {
        std::vector<llama_token> b(target.begin() + kv.size(), target.begin() + n);
        if (!feed(b, false, ckpt_at)) {
            return false;
        }
    }
    return true;
}

GenResult Engine::generate(GenRequest & req) {
    GenResult res;
    const double t0 = now_ms();
    auto * mem = llama_get_memory(ctx);
    common_sampler_ptr smpl(common_sampler_init(mdl, req.sampling));
    if (!smpl) {
        LOG_ERR("%s", "failed to init sampler (bad grammar?)\n");
        return res;
    }
    // the preserved tokens (e.g. <tool_call>) are rendered as text for the parser
    const auto & preserved = req.sampling.preserved_tokens;
    const bool use_spec = req.use_spec && spec != nullptr;
    if (use_spec) {
        common_speculative_begin(spec, 0, kv);
    }

    llama_token id_last = req.id_last;
    llama_tokens draft;
    Checkpoint spec_ck;
    bool done = false;
    int32_t n_gen = 0;

    while (!done) {
        const llama_pos P = (llama_pos) kv.size();
        if (P + 2 >= n_ctx()) {
            res.hit_limit = true;
            break;
        }
        draft.clear();
        bool have_ck = false;
        if (use_spec) {
            int n_draft_max = std::min<int>(n_ctx() - P - 2, req.max_tokens - n_gen - 1);
            n_draft_max = std::max(n_draft_max, 0);
            auto & dp = common_speculative_get_draft_params(spec, 0);
            dp.drafting = true;
            dp.n_max    = n_draft_max;
            dp.pos0     = P;
            dp.id_last  = id_last;
            dp.prompt   = &kv;
            dp.result   = &draft;
            dp.temp     = req.sampling.temp;
            dp.seed     = req.sampling.seed;
            common_speculative_draft(spec);
            if (ctx_dft) {
                llama_memory_seq_rm(llama_get_memory(ctx_dft), 0, P, -1);
            }
            if (!draft.empty() && !can_partial_rm(draft.size())) {
                // state before verification, for partial acceptance on non-rollbackable memory
                spec_ck = Checkpoint();
                spec_ck.n_tokens = P;
                const size_t sz = llama_state_seq_get_size_ext(ctx, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                spec_ck.tgt.resize(sz);
                llama_state_seq_get_data_ext(ctx, spec_ck.tgt.data(), sz, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
                if (spec) {
                    common_speculative_get_state(spec, 0, spec_ck.spec);
                }
                have_ck = true;
            }
        }

        // verify [id_last, draft...]
        common_batch b(ctx);
        b.add(id_last, P, 0, true);
        for (size_t i = 0; i < draft.size(); ++i) {
            b.add(draft[i], P + 1 + (llama_pos) i, 0, true);
        }
        if (llama_process(ctx, LLAMA_PROCESS_TYPE_DECODE, b.get()) != 0) {
            LOG_ERR("%s", "decode failed during generation\n");
            break;
        }
        if (use_spec && !common_speculative_process(spec, b)) {
            LOG_ERR("%s", "speculative process failed\n");
            break;
        }
        std::vector<llama_token> ids = draft.empty()
            ? std::vector<llama_token>{ common_sampler_sample(smpl.get(), ctx, 0) }
            : common_sampler_sample_and_accept_n(smpl.get(), ctx, draft);
        if (draft.empty()) {
            common_sampler_accept(smpl.get(), ids[0], true);
        }
        stats.n_drafted += draft.size();

        // walk the accepted tokens; stop at eog / stop string / callback / limit
        size_t s = 0;
        for (; s < ids.size(); ++s) {
            const llama_token t = ids[s];
            if (llama_vocab_is_eog(voc, t)) {
                res.hit_eog = true;
                done = true;
                break;
            }
            const bool special = preserved.count(t) > 0;
            const std::string p = piece(t, special);
            if (res.tokens.empty()) {
                res.ttft_ms = now_ms() - t0;
            }
            res.tokens.push_back(t);
            res.text += p;
            if (req.want_entropy) {
                const float * lg = llama_get_logits_ith(ctx, (int32_t) s);
                res.entropy.push_back(lg ? logits_entropy(lg, llama_vocab_n_tokens(voc)) : NAN);
            }
            n_gen++;
            bool stop_now = false;
            for (auto & st : req.stops) {
                if (!st.empty() && res.text.size() >= st.size() &&
                    res.text.compare(res.text.size() - st.size(), st.size(), st) == 0) {
                    res.hit_stop = true;
                    stop_now = true;
                }
            }
            if (req.on_token && !req.on_token(t, p)) {
                res.stopped_by_callback = true;
                stop_now = true;
            }
            if (n_gen >= req.max_tokens) {
                res.hit_limit = true;
                stop_now = true;
            }
            if (stop_now) {
                done = true;
                s++; // token s is emitted and becomes the new last token
                break;
            }
        }
        // tokens kept in memory: id_last + ids[0..s_last-1], new id_last = ids[s_last]
        // s == number of emitted tokens in this step (eog not counted); the eog itself is id_last
        size_t s_last = done ? (res.hit_eog ? s : s - 1) : ids.size() - 1;
        const size_t n_accepted = std::min(s_last, draft.size());
        stats.n_draft_accepted += n_accepted;
        if (use_spec) {
            common_speculative_accept(spec, 0, (uint16_t) n_accepted);
        }
        const llama_pos keep = P + 1 + (llama_pos) s_last;   // positions [0, keep) stay
        const size_t in_mem  = 1 + draft.size();
        const size_t n_roll  = (size_t) (P + in_mem) - (size_t) keep;
        std::vector<llama_token> committed;
        committed.push_back(id_last);
        for (size_t j = 0; j < s_last; ++j) {
            committed.push_back(ids[j]);
        }
        if (n_roll > 0 && !can_partial_rm(n_roll)) {
            GGML_ASSERT(have_ck);
            restore(spec_ck);
            stats.n_restores--; // not a context rewind
            kv.resize(P);
            // replay the accepted tokens without sampling
            if (!decode_chunked(committed, 0, P, false, use_spec, {})) {
                break;
            }
        } else {
            if (n_roll > 0) {
                llama_memory_seq_rm(mem, 0, keep, -1);
            }
            if (ctx_dft) {
                llama_memory_seq_rm(llama_get_memory(ctx_dft), 0, keep, -1);
            }
            kv.insert(kv.end(), committed.begin(), committed.end());
        }
        id_last = ids[s_last];
    }
    // the final token (eog or last sampled) is not in memory; the caller appends it as text
    res.t_ms = now_ms() - t0;
    stats.t_gen_ms += res.t_ms;
    stats.n_generated += res.tokens.size();
    if (!res.hit_eog && !res.tokens.empty()) {
        // a stop / limit / callback: the last emitted token was not decoded, decode it now so the
        // cache matches the text that was produced
        const llama_token t = res.tokens.back();
        if (kv.size() < (size_t) n_ctx() - 1) {
            decode_chunked({ t }, 0, (llama_pos) kv.size(), false, use_spec, {});
        }
    }
    return res;
}

bool Engine::snapshot(std::vector<uint8_t> & out, std::vector<llama_token> & toks) {
    // layout: [u64 n_tgt][tgt bytes][dft bytes...]
    const size_t n_tgt = llama_state_seq_get_size(ctx, 0);
    const size_t n_dft = ctx_dft ? llama_state_seq_get_size(ctx_dft, 0) : 0;
    out.resize(sizeof(uint64_t) + n_tgt + n_dft);
    const uint64_t h = n_tgt;
    std::memcpy(out.data(), &h, sizeof(h));
    if (llama_state_seq_get_data(ctx, out.data() + sizeof(h), n_tgt, 0) == 0) {
        return false;
    }
    if (n_dft > 0) {
        llama_state_seq_get_data(ctx_dft, out.data() + sizeof(h) + n_tgt, n_dft, 0);
    }
    toks = kv;
    return true;
}

bool Engine::restore_snapshot(const std::vector<uint8_t> & data, const std::vector<llama_token> & toks) {
    reset();
    uint64_t n_tgt = 0;
    std::memcpy(&n_tgt, data.data(), sizeof(n_tgt));
    if (llama_state_seq_set_data(ctx, data.data() + sizeof(n_tgt), n_tgt, 0) == 0) {
        return false;
    }
    const size_t n_dft = data.size() - sizeof(n_tgt) - n_tgt;
    if (ctx_dft && n_dft > 0) {
        llama_state_seq_set_data(ctx_dft, data.data() + sizeof(n_tgt) + n_tgt, n_dft, 0);
    }
    kv = toks;
    return true;
}

// ---------------------------------------------------------------------------------------------

bool Engine::branch_begin(const std::vector<llama_token> & suffix) {
    if (n_seq_max < 2) {
        return false;
    }
    auto * mem = llama_get_memory(ctx);
    llama_memory_seq_rm(mem, 1, -1, -1);
    llama_memory_seq_cp(mem, 0, 1, -1, -1);
    branch_active = true;
    branch_tokens = suffix;
    const double t0 = now_ms();
    const bool ok = decode_chunked(suffix, 1, (llama_pos) kv.size(), true, false, {});
    stats.t_branch_ms += now_ms() - t0;
    stats.n_branch_decoded += suffix.size();
    branch_pos = (llama_pos) (kv.size() + suffix.size());
    if (!ok) {
        branch_end();
    }
    return ok;
}

std::vector<float> Engine::branch_logprobs(const std::vector<llama_token> & cands) {
    const float * logits = llama_get_logits_ith(ctx, -1);
    const int n_vocab = llama_vocab_n_tokens(voc);
    float mx = -INFINITY;
    for (int i = 0; i < n_vocab; ++i) {
        mx = std::max(mx, logits[i]);
    }
    double sum = 0;
    for (int i = 0; i < n_vocab; ++i) {
        sum += std::exp((double) logits[i] - mx);
    }
    const double lse = mx + std::log(sum);
    std::vector<float> out;
    for (auto t : cands) {
        out.push_back((float) (logits[t] - lse));
    }
    return out;
}

GenResult Engine::branch_generate(common_params_sampling sampling, int32_t max_tokens,
                                  const std::vector<std::string> & stops) {
    GenResult res;
    const double t0 = now_ms();
    common_sampler_ptr smpl(common_sampler_init(mdl, sampling));
    for (int i = 0; i < max_tokens; ++i) {
        const llama_token t = common_sampler_sample(smpl.get(), ctx, -1);
        common_sampler_accept(smpl.get(), t, true);
        if (llama_vocab_is_eog(voc, t)) {
            res.hit_eog = true;
            break;
        }
        if (res.tokens.empty()) {
            res.ttft_ms = now_ms() - t0;
        }
        res.tokens.push_back(t);
        res.text += piece(t, false);
        bool stop = false;
        for (auto & st : stops) {
            if (!st.empty() && res.text.size() >= st.size() &&
                res.text.compare(res.text.size() - st.size(), st.size(), st) == 0) {
                stop = true;
            }
        }
        if (stop) {
            res.hit_stop = true;
            break;
        }
        if (!decode_chunked({ t }, 1, branch_pos, true, false, {})) {
            break;
        }
        branch_pos++;
    }
    if (!res.hit_eog && !res.hit_stop) {
        res.hit_limit = true;
    }
    res.t_ms = now_ms() - t0;
    stats.t_branch_ms += res.t_ms;
    stats.n_branch_generated += res.tokens.size();
    return res;
}

void Engine::branch_end() {
    if (!branch_active) {
        return;
    }
    llama_memory_seq_rm(llama_get_memory(ctx), 1, -1, -1);
    branch_active = false;
}

std::vector<std::pair<std::string, size_t>> Engine::device_used_mib() {
    std::vector<std::pair<std::string, size_t>> out;
    for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        auto * dev = ggml_backend_dev_get(i);
        if (ggml_backend_dev_type(dev) != GGML_BACKEND_DEVICE_TYPE_GPU) {
            continue;
        }
        size_t free = 0, total = 0;
        ggml_backend_dev_memory(dev, &free, &total);
        out.emplace_back(ggml_backend_dev_name(dev), (total - free) / (1024 * 1024));
    }
    return out;
}
