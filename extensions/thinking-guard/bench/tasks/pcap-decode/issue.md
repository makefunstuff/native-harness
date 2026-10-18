# Decode the captured frame

`capture.hex` is a hex dump of one Ethernet frame taken from a packet capture (offset, then
16 bytes per line). We need its key fields for the incident report.

Write `packet.json` in the repository root with exactly these keys:

- `src_mac`, `dst_mac`: lower-case, colon-separated (`aa:bb:cc:dd:ee:ff`)
- `src_ip`, `dst_ip`: dotted quad
- `ttl`: integer
- `protocol`: transport protocol name in lower case (`tcp`, `udp`, ...)
- `src_port`, `dst_port`: integers
- `ip_checksum_ok`: whether the IPv4 header checksum stored in the frame is correct
- `ip_checksum_correct`: the correct IPv4 header checksum, as a hex string like `0x1a2b`
- `udp_checksum_ok`: whether the UDP checksum stored in the frame is correct
- `dns_id`: the DNS transaction id, as a hex string like `0x1a2b`
- `dns_query`: the queried name, without a trailing dot

All values must come from the bytes in `capture.hex`.
