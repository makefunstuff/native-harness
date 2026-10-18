import unittest, warnings
from svc.config import load_config
from svc.client import Client
from svc.server import Server


class Hidden(unittest.TestCase):
    def test_new_key(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            c = load_config({"timeout_s": 5})
            self.assertEqual(c.timeout_s, 5)
            self.assertEqual(Client(c).request_options()["timeout"], 5)
            self.assertEqual(Server(c).keepalive_deadline(100), 110)

    def test_default(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            self.assertEqual(load_config({}).timeout_s, 30)

    def test_old_key_warns(self):
        with self.assertWarns(DeprecationWarning):
            c = load_config({"timeout": 7})
        self.assertEqual(c.timeout_s, 7)

    def test_both_keys(self):
        with self.assertRaises(ValueError):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                load_config({"timeout": 7, "timeout_s": 8})

    def test_old_attribute_alias(self):
        c = load_config({"timeout_s": 9})
        with self.assertWarns(DeprecationWarning):
            self.assertEqual(c.timeout, 9)
        with self.assertRaises(AttributeError):
            c.timeout = 3

    def test_validation(self):
        for bad in (0, -1, "10", None, True):
            with self.assertRaises(ValueError, msg=repr(bad)):
                load_config({"timeout_s": bad})
        self.assertEqual(load_config({"timeout_s": 2.5}).timeout_s, 2.5)


if __name__ == "__main__":
    unittest.main()
