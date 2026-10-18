import json
import unittest

EXPECTED = {
    "src_mac": "a4:bb:6d:10:e2:f1", "dst_mac": "3c:52:82:a1:b2:c4",
    "src_ip": "192.0.2.40", "dst_ip": "198.51.100.53", "ttl": 64, "protocol": "udp",
    "src_port": 51515, "dst_port": 53, "ip_checksum_ok": False, "ip_checksum_correct": "0x31d7",
    "udp_checksum_ok": True, "dns_id": "0x4d2a", "dns_query": "build.example.org",
}


def norm(key, value):
    if isinstance(value, str):
        value = value.strip().lower().rstrip(".") if key == "dns_query" else value.strip().lower()
        if key in ("ip_checksum_correct", "dns_id"):
            value = "0x%04x" % int(value, 16)
    return value


class HiddenTest(unittest.TestCase):
    def test_packet_json(self):
        got = json.load(open("packet.json"))
        for key, want in EXPECTED.items():
            with self.subTest(key=key):
                self.assertIn(key, got)
                self.assertEqual(norm(key, got[key]), want)


if __name__ == "__main__":
    unittest.main()
