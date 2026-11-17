// The first-run workspace set-up (B6 T6.3): what the browser may send to the onboarding server action, and the pure helpers it uses.
// The action (app/actions/onboarding.ts) re-validates everything here; the API validates again (POST /v1/tenants, /v1/teams, /v1/invites).
import { z } from "zod"
import { slugify } from "./slug"

const validTimezone = (v: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v })
    return true
  } catch {
    return false
  }
}

const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n]+$/)

export const onboardingInput = z
  .object({
    company: line(120),
    timezone: z.string().refine(validTimezone),
    deadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    departments: z.array(line(80)).max(20).refine((d) => new Set(d.map((x) => x.toLowerCase())).size === d.length),
    invites: z
      .array(z.object({ email: z.string().trim().toLowerCase(), roleKey: z.string() }))
      .max(20)
      .transform((rows) => rows.filter((r) => r.email !== ""))
      .pipe(z.array(z.object({ email: z.email(), roleKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })).max(20)),
  })
  .strict()

export type OnboardingInput = z.infer<typeof onboardingInput>

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** Workspace addresses to try, in order: the plain slug, then the slug with a random suffix (a taken address is a 409 slug_taken). */
export function slugCandidates(company: string, rand: () => string = () => Math.random().toString(36).slice(2, 6)): string[] {
  let base = slugify(company).slice(0, 34).replace(/-+$/g, "")
  if (!SLUG.test(base)) base = "company"
  const out = [base]
  for (let i = 0; i < 3; i++) out.push(`${base}-${rand().replace(/[^a-z0-9]/g, "x").slice(0, 4).padEnd(4, "0")}`)
  return out
}

/** Currency and locale of the country whose timezone was chosen (onboarding-defaults.json countries); empty when the data has none. */
export function currencyAndLocale(countries: { timezone: string; currency?: string; locale?: string; [k: string]: unknown }[], timezone: string): { currency?: string; locale?: string } {
  const c = countries.find((x) => x.timezone === timezone) ?? countries[0]
  return { ...(c?.currency ? { currency: c.currency } : {}), ...(c?.locale ? { locale: c.locale } : {}) }
}
