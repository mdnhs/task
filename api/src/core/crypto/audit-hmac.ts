import { createHmac } from "node:crypto"
import { buildKeyring } from "./secret-box"

/**
 * Pseudonymous email reference for the immutable audit log (ruling B14): HMAC-SHA256 of the normalised address under a
 * per-tenant key derived from the CURRENT secrets key (HMAC(masterKey, "audit.email_hmac:<tenantId>")). The same address
 * in the same tenant gives the same value (so entries can be correlated), another tenant gives another value, and the
 * address itself is never recoverable from the log. Rotating the current key changes new values; old ones stay as written.
 */
export function emailHmac(env: Parameters<typeof buildKeyring>[0], tenantId: string, email: string): string {
  const key = createHmac("sha256", buildKeyring(env).current.key).update(`audit.email_hmac:${tenantId}`).digest()
  return createHmac("sha256", key).update(email.trim().normalize("NFC").toLowerCase()).digest("hex")
}
