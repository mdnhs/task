// The report template as the API holds it (FR-M1-25, B6 T6.7): `GET/PUT /v1/shift-reports/template`. A department is matched to a team BY NAME on the server (the team rename carries the template
// key, I26), so the UI shows the department names the API returns. Shared by the report editor (the sections of a team) and Settings (the editor). Strict: a missing field throws.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"
import { reader } from "@/lib/api/read"
import type { TemplateData } from "@opsdesk/domain/shift-report"

const R = reader("template")

export const TEMPLATE_MAX_BYTES = 64 * 1024

/** `GET /v1/shift-reports/template`: the departments the API returned (a department is matched to a team by NAME). */
export function toTemplateData(dto: unknown): TemplateData {
  const r = R.rec(dto, "template")
  return {
    departments: R.arr(r, "departments").map((d) => {
      const x = R.rec(d, "department")
      return {
        dept: R.str(x, "dept"),
        sections: R.arr(x, "sections").map((s) => {
          const y = R.rec(s, "section")
          return {
            id: R.str(y, "id"),
            title: R.str(y, "title"),
            enabled: R.bool(y, "enabled"),
            fields: R.arr(y, "fields").map((f) => {
              const z = R.rec(f, "field")
              return { id: R.str(z, "id"), label: R.str(z, "label"), required: R.bool(z, "required") }
            }),
          }
        }),
      }
    }),
  }
}

/** The PUT body. Over the API's 64 KB cap it throws `template_too_large` before any request (the API says 422 template_too_large as well). */
export function toTemplateBody(data: TemplateData): { departments: TemplateData["departments"] } {
  const body = { departments: data.departments.map((d) => ({ dept: d.dept, sections: d.sections.map((s) => ({ id: s.id, title: s.title, enabled: s.enabled, fields: s.fields.map((f) => ({ id: f.id, label: f.label, required: f.required })) })) })) }
  if (new TextEncoder().encode(JSON.stringify(body)).length > TEMPLATE_MAX_BYTES) throw new ApiError(422, "template_too_large", "")
  return body
}


/** The template with the strong ETag it came with (null only if a proxy dropped the header). Send the tag back as `If-Match` on the save (ruling S6). */
export type TemplateWithEtag = { data: TemplateData; etag: string | null }

export async function fetchTemplate(api: Pick<ApiClient, "get">): Promise<TemplateWithEtag> {
  let etag: string | null = null
  const dto = await api.get("/v1/shift-reports/template", { onResponse: (r) => void (etag = r.headers.get("etag")) })
  return { data: toTemplateData(dto), etag }
}

/** Replaces the whole template under `If-Match`. 412 (changed since `etag`) is an ApiError the caller maps to "Changed by someone else"; the answer carries the new tag. */
export async function putTemplate(api: Pick<ApiClient, "put">, data: TemplateData, etag: string | null): Promise<TemplateWithEtag> {
  const body = toTemplateBody(data)
  let next: string | null = null
  const dto = await api.put("/v1/shift-reports/template", { body, headers: etag ? { "if-match": etag } : undefined, onResponse: (r) => void (next = r.headers.get("etag")) })
  return { data: toTemplateData(dto), etag: next }
}
