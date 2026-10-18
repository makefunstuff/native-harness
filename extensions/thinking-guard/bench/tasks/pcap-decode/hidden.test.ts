import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const EXPECTED: Record<string, unknown> = {
	src_mac: "a4:bb:6d:10:e2:f1", dst_mac: "3c:52:82:a1:b2:c4",
	src_ip: "192.0.2.40", dst_ip: "198.51.100.53", ttl: 64, protocol: "udp",
	src_port: 51515, dst_port: 53, ip_checksum_ok: false, ip_checksum_correct: "0x31d7",
	udp_checksum_ok: true, dns_id: "0x4d2a", dns_query: "build.example.org",
};

function norm(key: string, value: unknown): unknown {
	if (typeof value !== "string") return value;
	let v = value.trim().toLowerCase();
	if (key === "dns_query") v = v.replace(/\.$/, "");
	if (key === "ip_checksum_correct" || key === "dns_id") v = "0x" + parseInt(v, 16).toString(16).padStart(4, "0");
	return v;
}

test("packet.json has the frame's fields", () => {
	const got = JSON.parse(readFileSync("packet.json", "utf8"));
	for (const [key, want] of Object.entries(EXPECTED)) {
		assert.ok(key in got, `missing ${key}`);
		assert.equal(norm(key, got[key]), want, key);
	}
});
