import { expect, test } from "vitest"
import { makeS3Storage } from "./s3-storage"

const storage = () =>
  makeS3Storage({ get: async () => ({ region: "auto", bucket: "b", accessKeyId: "AKIATEST", secretAccessKey: "s".repeat(40), forcePathStyle: true, endpoint: "https://acc.r2.cloudflarestorage.com" }) })
const sign = async (mime: string, inline?: boolean, name = "n.bin") => {
  const u = new URL(await storage().presignGet("t/a/b", { name, mime, expiresSec: 60, inline }))
  return { type: u.searchParams.get("response-content-type"), disp: u.searchParams.get("response-content-disposition") }
}

test("presigned GET URL for text/html is attachment with the stored mime, never the caller's", async () => {
  for (const inline of [undefined, true]) {
    const r = await sign("text/html", inline)
    expect(r.disp).toMatch(/^attachment;/)
    expect(r.type).toBe("text/html")
  }
})
test("presigned GET for svg is attachment", async () => {
  expect((await sign("image/svg+xml", true)).disp).toMatch(/^attachment;/)
  expect((await sign("IMAGE/SVG+XML", true)).disp).toMatch(/^attachment;/)
})
test("inline is honoured for image/png and refused for image/svg+xml; default is attachment", async () => {
  for (const m of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
    expect((await sign(m, true, "a b.png")).disp).toBe("inline; filename*=UTF-8''a%20b.png")
    expect((await sign(m)).disp).toMatch(/^attachment;/)
  }
  expect((await sign("image/svg+xml", true)).disp).toMatch(/^attachment;/)
  expect((await sign("image/heic", true)).disp).toMatch(/^attachment;/)
})
