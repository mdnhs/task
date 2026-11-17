// One in-house typed client (B6 ruling I3): generic over the generated `paths` (lib/api/schema.d.ts, from the API's OpenAPI document).
// No openapi-fetch, no better-auth client, no server code: `import type` only. Used by server code (apiServer), the browser (apiBrowser)
// and the contract tests (`fetch` = the real app's `app.request`).
import type { paths } from "./schema"
import { ApiError } from "./problem"

export type Method = "get" | "post" | "put" | "patch" | "delete"

type Op<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>
export type PathsWith<M extends Method> = { [P in keyof paths]: [NonNullable<paths[P][M]>] extends [never] ? never : P }[keyof paths]

type PathParams<O> = O extends { parameters: { path: infer X } } ? X : never
type QueryParams<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never
type BodyOf<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? B : never
type OptBodyOf<O> = O extends { requestBody?: { content: { "application/json": infer B } } } ? B : never
type OkStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206
/** The JSON body of the first 2xx response (undefined for a 204 or an answer with no body). */
export type ResOf<O> = O extends { responses: infer R }
  ? { [S in keyof R & OkStatus]: R[S] extends { content: { "application/json": infer J } } ? J : undefined }[keyof R & OkStatus]
  : never

type Common = { signal?: AbortSignal }
type Required_<O> = ([PathParams<O>] extends [never] ? unknown : { path: PathParams<O> }) & ([BodyOf<O>] extends [never] ? unknown : { body: BodyOf<O> })
type Optional_<O> = ([QueryParams<O>] extends [never] ? unknown : { query?: QueryParams<O> }) & ([BodyOf<O>] extends [never] ? ([OptBodyOf<O>] extends [never] ? unknown : { body?: OptBodyOf<O> }) : unknown)
export type Req<P extends keyof paths, M extends Method> = Required_<Op<P, M>> & Optional_<Op<P, M>> & Common
export type Res<P extends keyof paths, M extends Method> = ResOf<Op<P, M>>

type Args<P extends keyof paths, M extends Method> = {} extends Req<P, M> ? [o?: Req<P, M>] : [o: Req<P, M>] // eslint-disable-line @typescript-eslint/no-empty-object-type

export type ApiClient = {
  get<P extends PathsWith<"get">>(path: P, ...o: Args<P, "get">): Promise<Res<P, "get">>
  post<P extends PathsWith<"post">>(path: P, ...o: Args<P, "post">): Promise<Res<P, "post">>
  put<P extends PathsWith<"put">>(path: P, ...o: Args<P, "put">): Promise<Res<P, "put">>
  patch<P extends PathsWith<"patch">>(path: P, ...o: Args<P, "patch">): Promise<Res<P, "patch">>
  delete<P extends PathsWith<"delete">>(path: P, ...o: Args<P, "delete">): Promise<Res<P, "delete">>
}

export type ClientOptions = {
  /** Origin and path prefix to call, no trailing slash: API_URL on the server, "" in the browser (same origin). */
  baseUrl: string
  /** Injected in tests (the contract tests pass the real app's `app.request`); defaults to the global fetch at call time. */
  fetch?: typeof globalThis.fetch
  /** Headers added to every request, asked per call with its method (apiServer: cookies, tenant, Origin on writes). */
  headers?: (req: { method: string }) => Promise<Headers> | Headers
  cache?: RequestCache
  credentials?: RequestCredentials
}

type Loose = { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown } & Common

function fill(template: string, params: Record<string, unknown> | undefined): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = params?.[name]
    if (v === undefined || v === null || v === "") throw new Error(`missing path parameter "${name}" for ${template}`)
    return encodeURIComponent(String(v))
  })
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return ""
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined && item !== null) sp.append(k, String(item))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

export function makeApiClient(o: ClientOptions): ApiClient {
  const base = o.baseUrl.replace(/\/+$/, "")

  async function request(method: Method, template: string, opt: Loose = {}): Promise<unknown> {
    const verb = method.toUpperCase()
    const url = `${base}${fill(template, opt.path)}${queryString(opt.query)}`
    const headers = new Headers({ accept: "application/json" })
    for (const [k, v] of (await o.headers?.({ method: verb }))?.entries() ?? []) headers.set(k, v)
    let body: string | undefined
    if (opt.body !== undefined) {
      body = JSON.stringify(opt.body)
      headers.set("content-type", "application/json")
    }
    const doFetch = o.fetch ?? globalThis.fetch
    const res = await doFetch(url, { method: verb, headers, body, signal: opt.signal, ...(o.cache ? { cache: o.cache } : {}), ...(o.credentials ? { credentials: o.credentials } : {}) })
    if (!res.ok) throw await ApiError.fromResponse(res)
    if (res.status === 204 || res.status === 205) return undefined
    const text = await res.text()
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  const verb = (m: Method) => (path: string, opt?: Loose) => request(m, path, opt)
  return { get: verb("get"), post: verb("post"), put: verb("put"), patch: verb("patch"), delete: verb("delete") } as unknown as ApiClient
}
