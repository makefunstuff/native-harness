import time


class TTLCache:
    def __init__(self, ttl):
        self.ttl = ttl
        self._data = {}

    def get_or_compute(self, key, fn):
        hit = self._data.get(key)
        if hit and hit[1] > time.time():
            return hit[0]
        value = fn()
        self._data[key] = (value, time.time() + self.ttl)
        return value

    def __len__(self):
        return len(self._data)
