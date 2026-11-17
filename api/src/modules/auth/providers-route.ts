import { createRoute, z } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"

const Providers = z
  .object({ google: z.boolean(), microsoft: z.boolean() })
  .openapi({ example: { google: true, microsoft: false } })

const providersRoute = createRoute({
  method: "get",
  path: "/v1/auth/providers",
  responses: { 200: { description: "Which social sign-in providers are configured (both client id and secret set). Public: the sign-in page needs it before anyone is signed in; it carries no id and no secret", content: { "application/json": { schema: Providers } } } },
})

export const authProviderRoutes = newRouter().openapi(providersRoute, (c) => {
  const env = c.get("deps").env
  return c.json({ google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) }, 200)
})
