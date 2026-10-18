// Chat service on top of Engine: what llama-server does for one slot, but called in-process by
// pi's provider, plus operations HTTP cannot offer (decisions and summaries on a forked branch of
// the cached conversation).
//
// All requests and results are JSON; messages and tools use the OpenAI chat format that pi's
// llama.cpp provider sends over HTTP, so the two paths see the same conversation.
#pragma once

#include "engine.h"

#include "nlohmann/json.hpp"

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

using ojson = nlohmann::ordered_json;

class Service {
public:
    // argv: llama-server style arguments (the same ones the router preset uses)
    explicit Service(const std::vector<std::string> & argv);
    bool ok() const { return eng && eng->ok(); }
    std::string error() const { return err; }

    // chat completion. req: {messages, tools, reasoning_effort?, enable_thinking?, max_tokens?,
    //   temperature?, top_p?, top_k?, min_p?, seed?, tool_grammar?, use_spec?, cache_mode?}
    // emit() receives streaming deltas as JSON strings.
    ojson chat(const ojson & req, const std::function<void(const std::string &)> & emit);
    // logprob classifier on a branch: req: {messages, tools, question, labels[]}
    ojson decide(const ojson & req);
    // free-form generation on a branch (e.g. a summary): req: {messages, tools, prompt, max_tokens}
    ojson branch_complete(const ojson & req);
    ojson info();
    // drop the whole cache (new conversation)
    void reset();

    std::atomic<bool> abort_flag{false};

private:
    struct Rendered {
        std::string text;                         // full prompt text
        std::vector<size_t> bounds;               // text offsets of message boundaries (size = n_msgs + 1)
        std::vector<llama_token> tokens;
        std::vector<int64_t> tok_bounds;          // token offsets of the same boundaries
        int n_spliced = 0;                        // assistant messages taken from exact generated tokens
        int n_inexact = 0;                        // boundaries that are not clean prefixes
        int64_t last_user_tok = 0;
        std::string gen_prompt;                   // text after the last message (generation prompt)
    };
    common_chat_templates_inputs inputs(const std::vector<common_chat_msg> & msgs,
                                        const std::vector<common_chat_tool> & tools, const ojson & req,
                                        bool add_gen, bool thinking);
    Rendered render(const std::vector<common_chat_msg> & msgs, const std::vector<common_chat_tool> & tools,
                    const ojson & req, bool thinking, const std::string & mode);
    static std::string msg_key(const common_chat_msg & m);

    std::vector<std::string> args;
    common_params params;
    std::unique_ptr<Engine> eng;
    std::string err;
    std::string eot_text;
    // exact tokens of assistant messages this process generated, keyed by their content
    struct GenRecord { std::string gen_prompt; std::vector<llama_token> tokens; };
    std::map<std::string, GenRecord> gen_records;
    std::vector<std::string> gen_order;
    ojson last_stats;
};

std::vector<common_chat_msg> parse_messages(const ojson & msgs);
std::vector<common_chat_tool> parse_tools(const ojson & tools);
