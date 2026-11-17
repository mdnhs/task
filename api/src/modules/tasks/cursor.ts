import { AppError } from "../../core/errors"

/** Opaque keyset cursor (base64url of `<ISO instant>|<uuid>`), the same shape as billing's. Anything else is 400 invalid_cursor. */
export const encodeCursor = (at: Date, id: string): string => Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url")

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id, extra] = Buffer.from(cursor, "base64url").toString("utf8").split("|")
  const at = new Date(iso ?? "")
  if (extra !== undefined || !id || Number.isNaN(at.getTime()) || at.toISOString() !== iso || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(400, "invalid_cursor", "Bad Request")
  }
  return { at, id }
}
