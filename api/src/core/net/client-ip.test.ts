import { expect, test } from "vitest"
import { clientIp, ipBucket, UNKNOWN_IP } from "./client-ip"

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff })

test("clientIp ignores x-forwarded-for when hops is 0", () => {
  expect(clientIp(h("9.9.9.9"), "10.0.0.1", 0)).toBe("10.0.0.1")
  expect(clientIp(h("1.1.1.1, 2.2.2.2"), undefined, 0)).toBe(UNKNOWN_IP)
})
test("clientIp takes the entry hops from the right (client-prepended entries are ignored)", () => {
  expect(clientIp(h("1.1.1.1, 2.2.2.2"), "10.0.0.1", 1)).toBe("2.2.2.2")
  expect(clientIp(h("6.6.6.6, 1.1.1.1, 2.2.2.2"), "10.0.0.1", 2)).toBe("1.1.1.1")
  // a forged left entry never wins, however many are prepended
  expect(clientIp(h("6.6.6.6, 7.7.7.7, 8.8.8.8, 2.2.2.2"), "10.0.0.1", 1)).toBe("2.2.2.2")
})
test("clientIp falls back to the socket when the header is short, absent or not an address", () => {
  expect(clientIp(h("2.2.2.2"), "10.0.0.1", 2)).toBe("10.0.0.1") // fewer entries than hops
  expect(clientIp(h(), "10.0.0.1", 1)).toBe("10.0.0.1")
  expect(clientIp(h("not-an-ip"), "10.0.0.1", 1)).toBe("10.0.0.1")
  expect(clientIp(h("1.1.1.1, <script>"), "10.0.0.1", 1)).toBe("10.0.0.1")
})
test("clientIp handles spaces, IPv6 and an empty header", () => {
  expect(clientIp(h("  1.1.1.1 ,   2.2.2.2  "), undefined, 1)).toBe("2.2.2.2")
  expect(clientIp(h("1.1.1.1, 2001:DB8::1"), undefined, 1)).toBe("2001:db8::1")
  expect(clientIp(h("1.1.1.1, [2001:db8::2]"), undefined, 1)).toBe("2001:db8::2")
  expect(clientIp(h("1.1.1.1, 3.3.3.3:4711"), undefined, 1)).toBe("3.3.3.3")
  expect(clientIp(h(""), "10.0.0.1", 1)).toBe("10.0.0.1")
  expect(clientIp(h("1.1.1.1,"), "10.0.0.1", 1)).toBe("10.0.0.1") // an empty last entry is not an address
  expect(clientIp(h(""), undefined, 1)).toBe(UNKNOWN_IP)
})
test("ipBucket collapses IPv6 to its /64 and keeps IPv4", () => {
  expect(ipBucket("1.2.3.4")).toBe("1.2.3.4")
  expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64")
  expect(ipBucket("2001:db8:1:2:ffff::1")).toBe(ipBucket("2001:db8:1:2::9"))
  expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64")
  expect(ipBucket("::ffff:1.2.3.4")).toBe("1.2.3.4")
  expect(ipBucket(UNKNOWN_IP)).toBe(UNKNOWN_IP)
})
