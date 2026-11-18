import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"

import { SecretInput } from "./secret-input"

const root = path.join(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

describe("SecretInput markup", () => {
  const html = renderToStaticMarkup(createElement(SecretInput, { id: "k", name: "apiKey", autoComplete: "off", value: "", onChange: () => {} }))
  test("is masked by default and keeps its name and autocomplete", () => {
    expect(html).toContain('type="password"')
    expect(html).toContain('name="apiKey"')
    expect(html).toMatch(/autocomplete="off"/i)
  })
  test("toggle is a non-submitting, labelled, pressed=false button after the input", () => {
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Show secret"')
    expect(html).toContain('aria-pressed="false"')
    expect(html.indexOf("<input")).toBeLessThan(html.indexOf("<button"))
  })
  test("password wording and no value attribute leaks when empty", () => {
    const h = renderToStaticMarkup(createElement(SecretInput, { noun: "password", value: "", onChange: () => {} }))
    expect(h).toContain('aria-label="Show password"')
    expect(h).toContain('value=""')
  })
  test("disabled field disables the toggle too", () => {
    expect(renderToStaticMarkup(createElement(SecretInput, { disabled: true, value: "", onChange: () => {} }))).toMatch(/<button[^>]*disabled/)
  })
})

describe("SecretInput behaviour (source contract)", () => {
  const src = read("components/secret-input.tsx")
  test("re-masks on blur out of the wrapper and on form submit; state is local only", () => {
    expect(src).toContain("onBlur")
    expect(src).toContain("relatedTarget")
    expect(src).toContain('addEventListener("submit"')
    expect(src).not.toMatch(/localStorage|sessionStorage|console\.|location\.|history\./)
  })
  test("only the type switches between password and text", () => {
    expect(src).toContain('type={shown ? "text" : "password"}')
  })
})

describe("secret padding", () => {
  const css = read("app/styles/kit.css")
  test("the input reserves room for the icon so text never runs under it", () => {
    expect(css).toMatch(/\.od-field \.od-secret input\{padding-right:48px\}/)
    expect(css).toMatch(/\.od-secret-btn\{[^}]*right:6px[^}]*width:34px/)
  })
})

describe("no secret input is a plain password Input", () => {
  test.each([
    "features/platform/components/live-settings.tsx",
    "features/auth/components/sign-in-form.tsx",
    "features/auth/components/sign-up-wizard.tsx",
    "features/auth/components/reset-password.tsx",
    "features/account/components/totp-setup.tsx",
    "features/account/components/security-panel.tsx",
  ])("%s", (f) => {
    expect(read(f)).not.toMatch(/<Input[^>]*type="password"/)
  })
  test("platform settings never bind a stored secret into a field", () => {
    const src = read("features/platform/components/live-settings.tsx")
    // fields are bound to local draft state only; stored data contributes only the last-4 hint
    expect(src).not.toMatch(/value=\{(email|storage|billing)\./)
    expect(src).toMatch(/useState\(\{ apiKey: "", /)
    expect(src).toMatch(/secretAccessKey: "" \}\)/)
    expect(src).toMatch(/secretKey: "", webhookSecret: ""/)
  })
})
