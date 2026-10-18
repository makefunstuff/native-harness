import warnings


class Config:
    def __init__(self, host, port, timeout_s):
        self.host, self.port, self.timeout_s = host, port, timeout_s

    @property
    def timeout(self):
        warnings.warn("Config.timeout is deprecated; use timeout_s", DeprecationWarning, stacklevel=2)
        return self.timeout_s


def load_config(d):
    if "timeout" in d and "timeout_s" in d:
        raise ValueError("give timeout_s only")
    if "timeout" in d:
        warnings.warn("'timeout' is deprecated; use 'timeout_s'", DeprecationWarning, stacklevel=2)
    t = d.get("timeout_s", d.get("timeout", 30))
    if isinstance(t, bool) or not isinstance(t, (int, float)) or t <= 0:
        raise ValueError("timeout_s must be a positive number")
    return Config(d.get("host", "127.0.0.1"), int(d.get("port", 8080)), t)
