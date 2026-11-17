import { expectTypeOf, test } from "vitest"
import type { ApiClient } from "@/lib/api/client"

// Compile-time contract (checked by `tsc --noEmit`): the client is typed from the generated OpenAPI `paths`.
// The functions are never called; `@ts-expect-error` makes tsc fail if a wrong call ever starts to type-check.
async function typed(api: ApiClient) {
  const me = await api.get("/v1/me")
  expectTypeOf(me.user.emailVerified).toEqualTypeOf<boolean>()
  expectTypeOf(me.platformRole).toEqualTypeOf<"owner" | "support" | "billing" | "viewer" | null>()
  expectTypeOf(me.tenants[0].slug).toEqualTypeOf<string>()

  const t = await api.get("/v1/me/tenant")
  expectTypeOf(t.features.drive).toEqualTypeOf<boolean>()
  expectTypeOf(t.brand.primaryColor).toEqualTypeOf<string | null>()

  const task = await api.get("/v1/tasks/{id}", { path: { id: "x" } })
  expectTypeOf(task.checklist[0].done).toEqualTypeOf<boolean>()
  expectTypeOf(task.repeat).toEqualTypeOf<{ freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift"; patternId?: string; days?: number[]; dayOfMonth?: number; until?: string } | undefined>()

  await api.post("/v1/tenants", { body: { name: "Coppers", slug: "coppers" } })

  // @ts-expect-error a path that is not in the API
  await api.get("/v1/nope")
  // @ts-expect-error GET on a path that only has POST
  await api.get("/v1/tenants")
  // @ts-expect-error a required path parameter is missing
  await api.get("/v1/tasks/{id}")
  // @ts-expect-error a required body is missing
  await api.post("/v1/tenants")
  // @ts-expect-error the body does not match the schema
  await api.post("/v1/tenants", { body: { name: 1 } })
}
void typed

test("the compile-time checks above are enforced by tsc (this file has no runtime assertions)", () => {
  expectTypeOf<ApiClient>().toHaveProperty("get")
})
