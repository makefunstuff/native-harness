import json, unittest
from shop.handlers import OrderHandler, UserHandler, Invalid, NotFound

class T(unittest.TestCase):
    def test_user(self):
        h = UserHandler({("user", 1): {"name": "a"}})
        self.assertEqual(json.loads(h.handle({"id": 1})), {"name": "a", "type": "user"})

    def test_missing(self):
        with self.assertRaises(NotFound):
            OrderHandler({}).handle({"id": 2})

if __name__ == "__main__":
    unittest.main()
