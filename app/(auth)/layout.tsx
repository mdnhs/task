import { IconSprite } from "@/components/icons"
import { getSession } from "@/lib/session"

// Auth pages have no AppShell: a centred card on --panel, branded with the tenant's own logo.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await getSession()
  return (
    <main className="auth">
      <IconSprite />
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-mark" style={{ background: tenant.brand }} aria-hidden="true">{tenant.initials}</span>
          <span className="auth-logo-name">{tenant.name}</span>
        </div>
        {children}
      </div>
    </main>
  )
}
