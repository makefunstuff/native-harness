#include "service.h"

#include "arg.h"
#include "log.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <functional>

static double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

static bool starts_with(const std::string & s, const std::string & p) {
    return s.size() >= p.size() && s.compare(0, p.size(), p) == 0;
}

static std::string trim(const std::string & s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

// OpenAI chat format -> common_chat_msg (content may be a string or text parts)
std::vector<common_chat_msg> parse_messages(const ojson & msgs) {
    std::vector<common_chat_msg> out;
    for (auto & m : msgs) {
        common_chat_msg c;
        c.role = m.value("role", "");
        if (m.contains("content")) {
            auto & ct = m["content"];
            if (ct.is_string()) {
                c.content = ct.get<std::string>();
            } else if (ct.is_array()) {
                for (auto & p : ct) {
                    if (p.value("type", "") == "text") {
                        if (!c.content.empty()) c.content += "\n";
                        c.content += p.value("text", "");
                    }
                }
            }
        }
        c.reasoning_content = m.value("reasoning_content", "");
        if (m.contains("tool_calls") && m["tool_calls"].is_array()) {
            for (auto & tc : m["tool_calls"]) {
                common_chat_tool_call t;
                t.id = tc.value("id", "");
                auto fn = tc.contains("function") ? tc["function"] : tc;
                t.name = fn.value("name", "");
                if (fn.contains("arguments")) {
                    t.arguments = fn["arguments"].is_string() ? fn["arguments"].get<std::string>() : fn["arguments"].dump();
                }
                c.tool_calls.push_back(t);
            }
        }
        c.tool_call_id = m.value("tool_call_id", "");
        c.tool_name = m.value("name", "");
        out.push_back(c);
    }
    return out;
}

std::vector<common_chat_tool> parse_tools(const ojson & tools) {
    std::vector<common_chat_tool> out;
    if (!tools.is_array()) return out;
    for (auto & t : tools) {
        auto fn = t.contains("function") ? t["function"] : t;
        common_chat_tool c;
        c.name = fn.value("name", "");
        c.description = fn.value("description", "");
        c.parameters = fn.contains("parameters") ? fn["parameters"].dump() : "{}";
        out.push_back(c);
    }
    return out;
}

Service::Service(const std::vector<std::string> & argv) : args(argv) {
    std::vector<char *> cargv;
    std::string prog = "llama-native";
    cargv.push_back(prog.data());
    for (auto & a : args) cargv.push_back(const_cast<char *>(a.c_str()));
    common_init();
    if (!common_params_parse((int) cargv.size(), cargv.data(), params, LLAMA_EXAMPLE_SERVER)) {
        err = "invalid llama arguments";
        return;
    }
    llama_backend_init();
    llama_numa_init(params.numa);
    eng = std::make_unique<Engine>(params);
    if (!eng->ok()) {
        err = "failed to load the model";
        return;
    }
    if (const char * mc = getenv("LLAMA_NATIVE_MAX_CKPT")) {
        eng->set_max_checkpoints(std::max(2, atoi(mc)));
    }
    eot_text = "<|im_end|>";
    const llama_token eot = llama_vocab_eot(eng->vocab());
    if (eot != LLAMA_TOKEN_NULL) eot_text = eng->piece(eot, true);
}

void Service::reset() {
    if (eng) eng->reset();
}

common_chat_templates_inputs Service::inputs(const std::vector<common_chat_msg> & msgs,
                                             const std::vector<common_chat_tool> & tools, const ojson & req,
                                             bool add_gen, bool thinking) {
    common_chat_templates_inputs in;
    in.messages = msgs;
    in.tools = tools;
    in.tool_choice = COMMON_CHAT_TOOL_CHOICE_AUTO;
    in.parallel_tool_calls = req.value("parallel_tool_calls", true);
    in.add_generation_prompt = add_gen;
    in.use_jinja = true;
    in.reasoning_format = params.reasoning_format;
    in.enable_thinking = params.enable_reasoning != 0;
    in.chat_template_kwargs = params.default_template_kwargs;
    if (req.contains("chat_template_kwargs") && req["chat_template_kwargs"].is_object()) {
        for (auto & [k, v] : req["chat_template_kwargs"].items()) in.chat_template_kwargs[k] = v.dump();
    }
    if (req.contains("reasoning_effort") && req["reasoning_effort"].is_string()) {
        const std::string e = req["reasoning_effort"];
        if (e == "none") {
            in.enable_thinking = false;
            in.chat_template_kwargs.erase("reasoning_effort");
        } else if (!e.empty()) {
            in.chat_template_kwargs["reasoning_effort"] = ojson(e).dump();
        }
    }
    // as the server does: an "enable_thinking" template kwarg switches thinking for this request
    {
        auto it = in.chat_template_kwargs.find("enable_thinking");
        if (it != in.chat_template_kwargs.end()) {
            if (it->second == "false") in.enable_thinking = false;
            else if (it->second == "true") in.enable_thinking = true;
        }
    }
    if (req.contains("enable_thinking") && req["enable_thinking"].is_boolean()) {
        in.enable_thinking = req["enable_thinking"].get<bool>();
    }
    if (!thinking) in.enable_thinking = false;
    if (!in.enable_thinking) in.chat_template_kwargs["enable_thinking"] = "false";
    return in;
}

std::string Service::msg_key(const common_chat_msg & m) {
    std::string k = trim(m.reasoning_content) + "\x1f" + trim(m.content);
    for (auto & t : m.tool_calls) {
        std::string a = t.arguments;
        try {
            a = nlohmann::json::parse(a).dump(); // canonical: sorted keys
        } catch (...) {}
        k += "\x1e" + t.name + "\x1f" + a;
    }
    return k;
}

// Render the conversation and tokenise it per message, so that the cache can keep a checkpoint at
// every message boundary. In "segments" mode, assistant messages this process generated are taken
// as their exact generated tokens instead of re-tokenising the template's rendering of them.
Service::Rendered Service::render(const std::vector<common_chat_msg> & msgs, const std::vector<common_chat_tool> & tools,
                                  const ojson & req, bool thinking, const std::string & mode) {
    Rendered r;
    auto tm = eng->templates();
    r.text = common_chat_templates_apply(tm, inputs(msgs, tools, req, true, thinking)).prompt;
    const size_t n = msgs.size();
    r.bounds.assign(n + 1, 0);
    r.bounds[n] = r.text.size();
    // message i ends at the end of render(msgs[0..i]) without a generation prompt
    for (size_t i = 1; i < n; ++i) {
        std::string b;
        try {
            std::vector<common_chat_msg> head(msgs.begin(), msgs.begin() + i);
            b = common_chat_templates_apply(tm, inputs(head, tools, req, false, thinking)).prompt;
        } catch (...) {
            r.bounds[i] = r.bounds[i - 1];
            r.n_inexact++;
            continue;
        }
        size_t k = 0;
        if (starts_with(r.text, b)) {
            k = b.size();
        } else {
            while (k < b.size() && k < r.text.size() && b[k] == r.text[k]) k++;
            r.n_inexact++;
        }
        r.bounds[i] = std::max(k, r.bounds[i - 1]);
    }
    // the generation prompt: the text after the last message
    {
        std::string b;
        try {
            b = common_chat_templates_apply(tm, inputs(msgs, tools, req, false, thinking)).prompt;
        } catch (...) {}
        if (!b.empty() && starts_with(r.text, b)) {
            r.gen_prompt = r.text.substr(b.size());
            r.bounds[n] = b.size(); // the generation prompt is a segment of its own
        }
    }
    if (mode == "server") {
        r.tokens = eng->tokenize(r.text);
        // token offset of the last user message, as the server computes it for its checkpoint
        for (size_t i = n; i-- > 0;) {
            if (msgs[i].role == "user") {
                r.last_user_tok = (int64_t) eng->tokenize(r.text.substr(0, r.bounds[i])).size();
                break;
            }
        }
        return r;
    }
    // per-segment tokenisation
    std::vector<size_t> cuts(r.bounds.begin(), r.bounds.end());
    cuts.push_back(r.text.size());
    for (size_t i = 0; i + 1 < cuts.size(); ++i) {
        const size_t a = cuts[i], b = cuts[i + 1];
        r.tok_bounds.push_back((int64_t) r.tokens.size());
        if (b <= a) continue;
        const std::string seg = r.text.substr(a, b - a);
        // message index of this segment: segment i (i >= 1) holds message i-1's tail... the
        // boundaries are message ends, so segment i (between bounds[i] and bounds[i+1]) is message i
        const size_t mi = i;
        if (mi < n && msgs[mi].role == "assistant") {
            auto it = gen_records.find(msg_key(msgs[mi]));
            const size_t e = seg.rfind(eot_text);
            if (it != gen_records.end() && e != std::string::npos) {
                auto t1 = eng->tokenize(it->second.gen_prompt);
                r.tokens.insert(r.tokens.end(), t1.begin(), t1.end());
                r.tokens.insert(r.tokens.end(), it->second.tokens.begin(), it->second.tokens.end());
                auto t2 = eng->tokenize(seg.substr(e));
                r.tokens.insert(r.tokens.end(), t2.begin(), t2.end());
                r.n_spliced++;
                continue;
            }
        }
        auto t = eng->tokenize(seg);
        r.tokens.insert(r.tokens.end(), t.begin(), t.end());
        if (mi < n && msgs[mi].role == "user") r.last_user_tok = r.tok_bounds.back();
    }
    r.tok_bounds.push_back((int64_t) r.tokens.size());
    return r;
}

ojson Service::chat(const ojson & req, const std::function<void(const std::string &)> & emit) {
    abort_flag = false;
    const double t0 = now_ms();
    auto msgs  = parse_messages(req.value("messages", ojson::array()));
    auto tools = parse_tools(req.value("tools", ojson::array()));
    const std::string mode = req.value("cache_mode", "segments");
    const EngineStats s0 = eng->stats;

    Rendered r = render(msgs, tools, req, true, mode);
    if (r.tokens.empty()) {
        return {{"error", "empty prompt"}};
    }
    // checkpoints: every message boundary (segments) or the server's policy
    std::vector<int64_t> ck;
    const int64_t N = (int64_t) r.tokens.size();
    if (mode == "server") {
        const int ub = (int) llama_n_ubatch(eng->context());
        ck = { r.last_user_tok, N - 4 - ub, N - 4 };
    } else {
        ck = r.tok_bounds;
    }
    const size_t cached_before = eng->cached().size();
    size_t common = 0;
    while (common < eng->cached().size() && common < r.tokens.size() && eng->cached()[common] == r.tokens[common]) common++;
    const double t_r = now_ms();
    if (!eng->sync_to(r.tokens, r.tokens.size() - 1, ck)) {
        return {{"error", "context_length_exceeded"}};
    }
    const double t_sync = now_ms();

    // chat session for the parser and the tool-call grammar (same object the server uses)
    common_chat_session session;
    try {
        session = common_chat_session(eng->templates(), eng->vocab(), inputs(msgs, tools, req, true, true));
    } catch (const std::exception & e) {
        return {{"error", std::string("template: ") + e.what()}};
    }
    GenRequest g;
    g.sampling = params.sampling;
    if (req.contains("temperature") && req["temperature"].is_number()) g.sampling.temp = req["temperature"];
    if (req.contains("top_p") && req["top_p"].is_number()) g.sampling.top_p = req["top_p"];
    if (req.contains("top_k") && req["top_k"].is_number()) g.sampling.top_k = req["top_k"];
    if (req.contains("min_p") && req["min_p"].is_number()) g.sampling.min_p = req["min_p"];
    if (req.contains("seed") && req["seed"].is_number()) g.sampling.seed = req["seed"];
    session.apply_sampling(g.sampling);
    const bool grammar = req.value("tool_grammar", true);
    if (!grammar) {
        g.sampling.grammar = common_grammar();
        g.sampling.grammar_lazy = false;
        g.sampling.grammar_triggers.clear();
    }
    g.stops = session.additional_stops();
    g.max_tokens = req.value("max_tokens", params.n_predict > 0 ? params.n_predict : 32768);
    g.use_spec = req.value("use_spec", true);
    g.id_last = r.tokens.back();

    common_chat_input acc;
    std::string sent_reasoning, sent_content;
    // stream via a cheap partial parse every few tokens
    common_chat_msg prev;
    prev.role = "assistant";
    int n_tok = 0;
    g.on_token = [&](llama_token t, const std::string & piece) {
        common_chat_input c;
        c.append(piece, t);
        acc.append(c);
        n_tok++;
        if (n_tok == 1 || n_tok % 8 == 0) {
            try {
                common_chat_parser_params pp;
                pp.format = session.format();
                pp.generation_prompt = common_chat_input(session.generation_prompt());
                pp.parser = session.parser();
                auto m = common_chat_parse(acc, true, pp);
                if (m.reasoning_content.size() > sent_reasoning.size() && starts_with(m.reasoning_content, sent_reasoning)) {
                    emit(ojson({{"t", "r"}, {"d", m.reasoning_content.substr(sent_reasoning.size())}}).dump());
                    sent_reasoning = m.reasoning_content;
                }
                if (m.content.size() > sent_content.size() && starts_with(m.content, sent_content)) {
                    emit(ojson({{"t", "c"}, {"d", m.content.substr(sent_content.size())}}).dump());
                    sent_content = m.content;
                }
            } catch (...) {}
        }
        return !abort_flag.load();
    };
    GenResult res = eng->generate(g);

    // final parse with the session (as the server does)
    common_chat_input all;
    for (size_t i = 0; i < res.tokens.size(); ++i) {
        const bool special = g.sampling.preserved_tokens.count(res.tokens[i]) > 0;
        all.append(eng->piece(res.tokens[i], special), res.tokens[i]);
    }
    common_chat_msg msg;
    bool parse_error = false;
    std::string parse_what;
    try {
        msg = session.finish(all);
    } catch (const std::exception & e) {
        parse_error = true;
        parse_what = e.what();
        msg = common_chat_msg();
        msg.content = res.text;
    }
    msg.role = "assistant";
    for (size_t i = 0; i < msg.tool_calls.size(); ++i) {
        if (msg.tool_calls[i].id.empty()) msg.tool_calls[i].id = "call_" + std::to_string((long long) (t0 * 1000)) + "_" + std::to_string(i);
    }
    // remember the exact tokens of this message, for splicing on the next request
    if (!res.tokens.empty() && !r.gen_prompt.empty()) {
        const std::string k = msg_key(msg);
        gen_records[k] = { r.gen_prompt, res.tokens };
        gen_order.push_back(k);
        while (gen_order.size() > 512) {
            gen_records.erase(gen_order.front());
            gen_order.erase(gen_order.begin());
        }
    }
    // final deltas
    if (msg.reasoning_content.size() > sent_reasoning.size() && starts_with(msg.reasoning_content, sent_reasoning)) {
        emit(ojson({{"t", "r"}, {"d", msg.reasoning_content.substr(sent_reasoning.size())}}).dump());
    }
    if (msg.content.size() > sent_content.size() && starts_with(msg.content, sent_content)) {
        emit(ojson({{"t", "c"}, {"d", msg.content.substr(sent_content.size())}}).dump());
    }

    // uncertainty: entropy over the whole message and over the part after the reasoning
    ojson ent = ojson::object();
    if (!res.entropy.empty()) {
        size_t act_from = 0;
        {
            std::string acc_t;
            const auto & ends = session.thinking_end_tags();
            for (size_t i = 0; i < res.tokens.size() && !ends.empty(); ++i) {
                acc_t += eng->piece(res.tokens[i], true);
                if (acc_t.find(ends[0]) != std::string::npos) { act_from = i + 1; break; }
            }
        }
        auto stats_of = [](std::vector<float> v) {
            v.erase(std::remove_if(v.begin(), v.end(), [](float x) { return std::isnan(x); }), v.end());
            if (v.empty()) return ojson::object();
            double sum = 0; int hi = 0; float mx = 0;
            for (float x : v) { sum += x; hi += x > 1.5f; mx = std::max(mx, x); }
            std::sort(v.begin(), v.end());
            return ojson({{"n", v.size()}, {"mean", sum / v.size()}, {"p90", v[(size_t) (0.9 * (v.size() - 1))]},
                          {"max", mx}, {"frac_high", (double) hi / v.size()}});
        };
        ent["all"] = stats_of(res.entropy);
        if (act_from < res.entropy.size()) {
            ent["act"] = stats_of(std::vector<float>(res.entropy.begin() + act_from, res.entropy.end()));
        }
    }
    const auto & s = eng->stats;
    ojson tcs = ojson::array();
    for (auto & t : msg.tool_calls) tcs.push_back({{"id", t.id}, {"name", t.name}, {"arguments", t.arguments}});
    std::string finish = "stop";
    if (!msg.tool_calls.empty()) finish = "tool_calls";
    else if (res.hit_limit) finish = "length";
    if (abort_flag.load()) finish = "aborted";
    ojson out = {
        {"content", msg.content},
        {"reasoning_content", msg.reasoning_content},
        {"tool_calls", tcs},
        {"finish_reason", finish},
        {"parse_error", parse_error},
        {"parse_what", parse_what},
        {"raw_text", parse_error ? res.text : ""},
        {"timings", {
            {"prompt_n", N},
            {"cache_n", (int64_t) (s.n_prompt_reused - s0.n_prompt_reused)},
            {"prompt_decoded", (int64_t) (s.n_prompt_decoded - s0.n_prompt_decoded)},
            {"refed", (int64_t) (s.n_refed - s0.n_refed)},
            {"predicted_n", (int64_t) res.tokens.size()},
            {"draft_n", (int64_t) (s.n_drafted - s0.n_drafted)},
            {"draft_n_accepted", (int64_t) (s.n_draft_accepted - s0.n_draft_accepted)},
            {"render_ms", t_r - t0},
            {"prompt_ms", t_sync - t_r},
            {"ttft_ms", (t_sync - t0) + res.ttft_ms},
            {"predicted_ms", res.t_ms},
            {"total_ms", now_ms() - t0},
            {"restores", (int64_t) (s.n_restores - s0.n_restores)},
            {"checkpoints", (int64_t) eng->checkpoints().size()},
            {"checkpoint_mib", eng->checkpoint_bytes() / 1048576.0},
            {"cached_before", cached_before},
            {"common_prefix", common},
            {"spliced", r.n_spliced},
            {"inexact_bounds", r.n_inexact},
            {"cache_mode", mode},
            {"tool_grammar", grammar},
            {"entropy", ent},
        }},
    };
    return out;
}

ojson Service::decide(const ojson & req) {
    const double t0 = now_ms();
    auto msgs  = parse_messages(req.value("messages", ojson::array()));
    auto tools = parse_tools(req.value("tools", ojson::array()));
    const size_t n_ctx_msgs = msgs.size();
    common_chat_msg q;
    q.role = "user";
    q.content = req.value("question", "");
    msgs.push_back(q);
    Rendered r = render(msgs, tools, req, false, "segments");
    // everything up to the question is the conversation (cached); the rest goes on the branch
    const int64_t k = r.tok_bounds.size() > n_ctx_msgs ? r.tok_bounds[n_ctx_msgs] : 0;
    const EngineStats s0 = eng->stats;
    if (!eng->sync_to(r.tokens, (size_t) k, r.tok_bounds)) {
        return {{"error", "sync failed"}};
    }
    std::vector<llama_token> suffix(r.tokens.begin() + k, r.tokens.end());
    if (!eng->branch_begin(suffix)) {
        return {{"error", "branch not supported (n_parallel < 2)"}};
    }
    std::vector<llama_token> cand;
    ojson labels = req.value("labels", ojson::array());
    for (auto & l : labels) {
        auto t = eng->tokenize(l.get<std::string>(), false);
        cand.push_back(t.empty() ? 0 : t[0]);
    }
    auto lp = eng->branch_logprobs(cand);
    eng->branch_end();
    double z = 0;
    for (auto v : lp) z += std::exp(v);
    ojson probs = ojson::array();
    for (auto v : lp) probs.push_back(std::exp(v) / z);
    const auto & s = eng->stats;
    return {{"probs", probs}, {"mass", z},
            {"timings", {{"total_ms", now_ms() - t0},
                         {"synced_decoded", (int64_t) (s.n_prompt_decoded - s0.n_prompt_decoded)},
                         {"branch_decoded", (int64_t) suffix.size()}}}};
}

ojson Service::branch_complete(const ojson & req) {
    const double t0 = now_ms();
    auto msgs  = parse_messages(req.value("messages", ojson::array()));
    auto tools = parse_tools(req.value("tools", ojson::array()));
    const size_t n_ctx_msgs = msgs.size();
    common_chat_msg q;
    q.role = "user";
    q.content = req.value("prompt", "");
    msgs.push_back(q);
    Rendered r = render(msgs, tools, req, false, "segments");
    const int64_t k = r.tok_bounds.size() > n_ctx_msgs ? r.tok_bounds[n_ctx_msgs] : 0;
    const EngineStats s0 = eng->stats;
    if (!eng->sync_to(r.tokens, (size_t) k, r.tok_bounds)) {
        return {{"error", "sync failed"}};
    }
    std::vector<llama_token> suffix(r.tokens.begin() + k, r.tokens.end());
    if (!eng->branch_begin(suffix)) {
        return {{"error", "branch not supported (n_parallel < 2)"}};
    }
    common_params_sampling sp = params.sampling;
    if (req.contains("temperature") && req["temperature"].is_number()) sp.temp = req["temperature"];
    auto g = eng->branch_generate(sp, req.value("max_tokens", 1024));
    eng->branch_end();
    const auto & s = eng->stats;
    return {{"text", g.text},
            {"timings", {{"total_ms", now_ms() - t0}, {"predicted_n", (int64_t) g.tokens.size()},
                         {"predicted_ms", g.t_ms},
                         {"synced_decoded", (int64_t) (s.n_prompt_decoded - s0.n_prompt_decoded)},
                         {"branch_decoded", (int64_t) suffix.size()}}}};
}

ojson Service::info() {
    ojson vram = ojson::object();
    for (auto & [d, mib] : Engine::device_used_mib()) vram[d] = mib;
    const auto & s = eng->stats;
    return {{"n_ctx", eng->n_ctx()}, {"cached", eng->cached().size()},
            {"checkpoints", eng->checkpoints().size()}, {"checkpoint_mib", eng->checkpoint_bytes() / 1048576.0},
            {"vram_used_mib", vram},
            {"totals", {{"prompt_decoded", s.n_prompt_decoded}, {"prompt_reused", s.n_prompt_reused},
                        {"refed", s.n_refed}, {"generated", s.n_generated}, {"drafted", s.n_drafted},
                        {"accepted", s.n_draft_accepted}, {"branch_decoded", s.n_branch_decoded},
                        {"branch_generated", s.n_branch_generated}, {"restores", s.n_restores},
                        {"t_prompt_ms", s.t_prompt_ms}, {"t_gen_ms", s.t_gen_ms}, {"t_ckpt_ms", s.t_ckpt_ms}}}};
}
