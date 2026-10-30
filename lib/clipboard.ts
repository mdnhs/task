// Copy text with a fallback (no React, safe to import anywhere; only call it in the browser).
// The async Clipboard API is missing on insecure origins and can reject without permission; the hidden-textarea
// + execCommand("copy") path still works there. Resolves true when the text reached the clipboard.

type ClipNav = { clipboard?: { writeText(text: string): Promise<void> } }
type FallbackEl = { value: string; style: Record<string, string> | CSSStyleDeclaration; setAttribute(k: string, v: string): void; select(): void; remove(): void }
type ClipDoc = { createElement(tag: "textarea"): FallbackEl; body: { appendChild(el: never): unknown } | null; execCommand(cmd: "copy"): boolean }

function fallback(text: string, doc: ClipDoc | null): boolean {
  if (!doc?.body) return false
  const el = doc.createElement("textarea")
  try {
    el.value = text
    el.setAttribute("readonly", "")
    Object.assign(el.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" })
    doc.body.appendChild(el as never)
    el.select()
    return doc.execCommand("copy") === true
  } catch {
    return false
  } finally {
    el.remove()
  }
}

export async function copyText(
  text: string,
  nav: ClipNav | null = typeof navigator === "undefined" ? null : navigator,
  doc: ClipDoc | null = typeof document === "undefined" ? null : (document as unknown as ClipDoc),
): Promise<boolean> {
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the textarea path.
    }
  }
  return fallback(text, doc)
}
