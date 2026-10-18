class Server:
    def __init__(self, config):
        self.config = config

    def keepalive_deadline(self, now):
        return now + 2 * self.config.timeout_s
