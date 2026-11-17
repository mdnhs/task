import { createHash } from "node:crypto"

/** A stable uuid (v5-shaped) from natural-key parts: the same task, report or file keeps the same id across seed runs. */
export function detId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const slugOf = (name: string): string =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")
