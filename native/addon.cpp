// Node-API binding: loads llama.cpp into the Node process that runs pi.
//
//   const m = require("llama_native.node")
//   const h = await m.load(["-m", "model.gguf", ...])     // llama-server style arguments
//   const res = JSON.parse(await m.chat(h, JSON.stringify(req), (delta) => ...))
//   JSON.parse(await m.decide(h, JSON.stringify(req)))
//   JSON.parse(await m.branchComplete(h, JSON.stringify(req)))
//   JSON.parse(await m.info(h)); await m.reset(h); m.abort(h)
//
// Every call on a handle runs on that handle's own worker thread, one at a time, so the event loop
// never blocks on inference.
#include "service.h"

#include <node_api.h>

#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

#define NAPI_CALL(env, call)                                                   \
    do {                                                                       \
        if ((call) != napi_ok) {                                               \
            napi_throw_error((env), nullptr, "napi call failed: " #call);      \
            return nullptr;                                                    \
        }                                                                      \
    } while (0)

struct Msg {
    enum Kind { DELTA, RESOLVE, REJECT } kind;
    std::string data;
};

// one in-flight call: a promise plus a thread-safe function that delivers deltas and the result
struct Call {
    napi_deferred deferred = nullptr;
    napi_threadsafe_function tsfn = nullptr;
    napi_ref on_delta = nullptr;
};

static void call_js(napi_env env, napi_value /*js_cb*/, void * context, void * data) {
    Call * c = (Call *) context;
    Msg * m = (Msg *) data;
    if (env != nullptr) {
        napi_value s;
        napi_create_string_utf8(env, m->data.c_str(), m->data.size(), &s);
        if (m->kind == Msg::DELTA) {
            if (c->on_delta) {
                napi_value fn, undef;
                napi_get_reference_value(env, c->on_delta, &fn);
                napi_get_undefined(env, &undef);
                napi_call_function(env, undef, fn, 1, &s, nullptr);
            }
        } else if (m->kind == Msg::RESOLVE) {
            napi_resolve_deferred(env, c->deferred, s);
        } else {
            napi_value err;
            napi_create_error(env, nullptr, s, &err);
            napi_reject_deferred(env, c->deferred, err);
        }
        if (m->kind != Msg::DELTA) {
            if (c->on_delta) napi_delete_reference(env, c->on_delta);
            napi_release_threadsafe_function(c->tsfn, napi_tsfn_release);
        }
    }
    if (m->kind != Msg::DELTA) delete c;
    delete m;
}

struct Worker {
    std::unique_ptr<Service> svc;
    std::thread th;
    std::mutex mu;
    std::condition_variable cv;
    std::deque<std::function<void()>> jobs;
    bool stop = false;

    Worker() {
        th = std::thread([this] {
            while (true) {
                std::function<void()> j;
                {
                    std::unique_lock<std::mutex> lk(mu);
                    cv.wait(lk, [this] { return stop || !jobs.empty(); });
                    if (stop && jobs.empty()) return;
                    j = std::move(jobs.front());
                    jobs.pop_front();
                }
                j();
            }
        });
    }
    void post(std::function<void()> j) {
        {
            std::lock_guard<std::mutex> lk(mu);
            jobs.push_back(std::move(j));
        }
        cv.notify_one();
    }
};

// handles live for the process lifetime (a model is loaded once per pi process)
static std::vector<Worker *> g_workers;

static Call * new_call(napi_env env, napi_value on_delta, napi_value * promise) {
    Call * c = new Call();
    napi_create_promise(env, &c->deferred, promise);
    if (on_delta) {
        napi_valuetype t;
        napi_typeof(env, on_delta, &t);
        if (t == napi_function) napi_create_reference(env, on_delta, 1, &c->on_delta);
    }
    napi_value name;
    napi_create_string_utf8(env, "llama_native", NAPI_AUTO_LENGTH, &name);
    napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr, c, call_js, &c->tsfn);
    return c;
}

static void send(Call * c, Msg::Kind k, std::string s) {
    napi_call_threadsafe_function(c->tsfn, new Msg{k, std::move(s)}, napi_tsfn_blocking);
}

static std::string get_string(napi_env env, napi_value v) {
    size_t n = 0;
    napi_get_value_string_utf8(env, v, nullptr, 0, &n);
    std::string s(n, '\0');
    napi_get_value_string_utf8(env, v, s.data(), n + 1, &n);
    return s;
}

static Worker * get_worker(napi_env env, napi_value v) {
    int32_t i = -1;
    napi_value num;
    if (napi_coerce_to_number(env, v, &num) != napi_ok) return nullptr;
    napi_get_value_int32(env, num, &i);
    if (i < 0 || i >= (int32_t) g_workers.size()) return nullptr;
    return g_workers[i];
}

static napi_value js_load(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
    std::vector<std::string> args;
    uint32_t n = 0;
    NAPI_CALL(env, napi_get_array_length(env, argv[0], &n));
    for (uint32_t i = 0; i < n; ++i) {
        napi_value e;
        napi_get_element(env, argv[0], i, &e);
        args.push_back(get_string(env, e));
    }
    napi_value promise;
    Call * c = new_call(env, nullptr, &promise);
    Worker * w = new Worker();
    const int id = (int) g_workers.size();
    g_workers.push_back(w);
    w->post([w, c, args, id] {
        try {
            w->svc = std::make_unique<Service>(args);
            if (!w->svc->ok()) {
                send(c, Msg::REJECT, w->svc->error());
                return;
            }
            send(c, Msg::RESOLVE, std::to_string(id));
        } catch (const std::exception & e) {
            send(c, Msg::REJECT, e.what());
        }
    });
    return promise;
}

// generic request: fn(handle, json, onDelta?) -> Promise<string>
template <typename F>
static napi_value request(napi_env env, napi_callback_info info, F op) {
    size_t argc = 3;
    napi_value argv[3] = {nullptr, nullptr, nullptr};
    NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
    Worker * w = get_worker(env, argv[0]);
    if (!w) {
        napi_throw_error(env, nullptr, "invalid llama_native handle");
        return nullptr;
    }
    std::string body = argc > 1 && argv[1] ? get_string(env, argv[1]) : "{}";
    napi_value promise;
    Call * c = new_call(env, argc > 2 ? argv[2] : nullptr, &promise);
    w->post([w, c, body, op] {
        try {
            if (!w->svc || !w->svc->ok()) {
                send(c, Msg::REJECT, "model not loaded");
                return;
            }
            ojson req = body.empty() ? ojson::object() : ojson::parse(body);
            ojson res = op(*w->svc, req, [c](const std::string & d) { send(c, Msg::DELTA, d); });
            send(c, Msg::RESOLVE, res.dump());
        } catch (const std::exception & e) {
            send(c, Msg::REJECT, e.what());
        }
    });
    return promise;
}

static napi_value js_chat(napi_env env, napi_callback_info info) {
    return request(env, info, [](Service & s, const ojson & r, auto emit) { return s.chat(r, emit); });
}
static napi_value js_decide(napi_env env, napi_callback_info info) {
    return request(env, info, [](Service & s, const ojson & r, auto) { return s.decide(r); });
}
static napi_value js_branch(napi_env env, napi_callback_info info) {
    return request(env, info, [](Service & s, const ojson & r, auto) { return s.branch_complete(r); });
}
static napi_value js_info(napi_env env, napi_callback_info info) {
    return request(env, info, [](Service & s, const ojson &, auto) { return s.info(); });
}
static napi_value js_reset(napi_env env, napi_callback_info info) {
    return request(env, info, [](Service & s, const ojson &, auto) { s.reset(); return ojson::object(); });
}

// abort the running generation (synchronous, any thread)
static napi_value js_abort(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NAPI_CALL(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
    Worker * w = get_worker(env, argv[0]);
    if (w && w->svc) w->svc->abort_flag = true;
    return nullptr;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        {"load", nullptr, js_load, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"chat", nullptr, js_chat, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"decide", nullptr, js_decide, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"branchComplete", nullptr, js_branch, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"info", nullptr, js_info, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"reset", nullptr, js_reset, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"abort", nullptr, js_abort, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
