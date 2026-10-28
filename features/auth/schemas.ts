import { z } from "zod"

// Fix-it messages: say what is wrong and how to correct it.
export const emailSchema = z.string().trim().email("Enter a valid email like name@company.com")

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Enter your password (at least 8 characters)"),
})

export const mfaSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app")

export const orgSchema = z.object({
  company: z.string().trim().min(2, "Enter your company name (at least 2 characters)").max(80, "Keep the company name under 80 characters"),
  country: z.string().min(1, "Choose a country"),
  timezone: z.string().min(1, "Choose a timezone"),
})

export const PASSWORD_RULES = [
  { id: "len", label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { id: "case", label: "Upper and lower case letters", test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: "num", label: "A number", test: (p: string) => /\d/.test(p) },
  { id: "sym", label: "A symbol such as ! or ?", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const

export function passwordScore(p: string): number {
  return PASSWORD_RULES.filter((r) => r.test(p)).length
}

export const ownerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name"),
  email: emailSchema,
  password: z.string().refine((p) => passwordScore(p) === PASSWORD_RULES.length, "Password needs to meet every rule listed below"),
})

/** "Northgate Facility Services" -> "northgate-facility-services" (subdomain preview). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

