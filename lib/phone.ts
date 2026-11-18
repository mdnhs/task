// Phone numbers for the WhatsApp UI (pure). A number is a country dial code plus the national digits; only the last 3 digits are ever shown.
export type PhoneCountry = { code: string; name: string; dial: string }
export type PhoneValue = { country: string; national: string }
export const PHONE_DEFAULT_COUNTRY = "IE"

export const digitsOnly = (s: string): string => s.replace(/\D/g, "")
/** The national part as digits: spaces, dashes and one leading 0 (the trunk prefix) removed. */
export const nationalDigits = (s: string): string => digitsOnly(s).replace(/^0/, "")
export const validNational = (digits: string): boolean => digits.length >= 7 && digits.length <= 12
/** "+353871234567": the E.164 form (dial code + national digits, at most 15 digits in all). */
export const e164 = (dial: string, national: string): string => `+${dial}${nationalDigits(national)}`
export const validE164 = (dial: string, national: string): boolean => {
  const n = nationalDigits(national)
  return validNational(n) && dial.length + n.length <= 15
}
/** "+353 ••• ••• 567": only the last 3 digits are shown, and the number of bullets never reveals the length. */
export const maskPhone = (dial: string, national: string): string => `+${dial} ••• ••• ${nationalDigits(national).slice(-3)}`
/** For lists and the log, where only the last 3 digits are known. */
export const maskLast3 = (last3: string | null): string => (last3 ? `••• ${last3}` : "No number")
