import threading, time


class _Flight:
    def __init__(self):
        self.done = threading.Event()
        self.value = self.exc = None


class TTLCache:
    def __init__(self, ttl, clock=time.monotonic):
        self.ttl, self.clock = ttl, clock
        self._data, self._flights = {}, {}
        self._lock = threading.Lock()

    def get_or_compute(self, key, fn):
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[1] > self.clock():
                return hit[0]
            fl = self._flights.get(key)
            leader = fl is None
            if leader:
                fl = self._flights[key] = _Flight()
        if not leader:
            fl.done.wait()
            if fl.exc:
                raise fl.exc
            return fl.value
        try:
            fl.value = fn()
            with self._lock:
                self._data[key] = (fl.value, self.clock() + self.ttl)
        except BaseException as e:
            fl.exc = e
            raise
        finally:
            with self._lock:
                del self._flights[key]
            fl.done.set()
        return fl.value

    def __len__(self):
        now = self.clock()
        with self._lock:
            return sum(1 for _, exp in self._data.values() if exp > now)
