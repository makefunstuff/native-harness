import unittest, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from jobs import Job, Scheduler

class T(unittest.TestCase):
    def test_tick(self):
        s = Scheduler()
        s.add(Job("a", 10, lambda: 1))
        self.assertEqual(s.tick(0), {"a": 1})
        self.assertEqual(s.tick(5), {})

if __name__ == "__main__":
    unittest.main()
