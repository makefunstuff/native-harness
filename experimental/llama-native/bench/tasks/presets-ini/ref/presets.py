import sys


def load_presets(path):
    defaults, out, cur = {}, {}, None
    with open(path) as f:
        for n, raw in enumerate(f, 1):
            s = raw.strip()
            if not s or s[0] in "#;":
                continue
            if s.startswith("[") and s.endswith("]"):
                name = s[1:-1].strip()
                if name in out:
                    raise ValueError(f"line {n}: duplicate section {name}")
                out[name] = cur = {}
                continue
            if "=" not in s:
                raise ValueError(f"line {n}: cannot parse {s!r}")
            k, v = s.split("=", 1)
            (defaults if cur is None else cur)[k.strip()] = v.strip()
    return {name: {**defaults, **keys} for name, keys in out.items()}


def main(argv=None):
    for name, k in load_presets((argv or sys.argv[1:])[0]).items():
        print(f"{name} ctx={k.get('ctx-size', '-')} devices={k.get('device', '-')} "
              f"split={k.get('split-mode', 'layer')} draft={'yes' if 'spec-draft-model' in k else 'no'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
