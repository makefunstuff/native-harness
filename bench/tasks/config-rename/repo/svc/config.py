class Config:
    def __init__(self, host, port, timeout):
        self.host = host
        self.port = port
        self.timeout = timeout


def load_config(d):
    return Config(d.get("host", "127.0.0.1"), int(d.get("port", 8080)), d.get("timeout", 30))
