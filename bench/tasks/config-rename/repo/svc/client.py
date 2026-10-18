class Client:
    def __init__(self, config):
        self.config = config

    def request_options(self):
        return {"url": f"http://{self.config.host}:{self.config.port}/",
                "timeout": self.config.timeout}
