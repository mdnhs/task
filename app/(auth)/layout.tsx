// Auth pages have no AppShell and no company yet (nobody is signed in): a centred card on --panel with the product mark.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-mark" aria-hidden="true">OD</span>
          <span className="auth-logo-name">OpsDesk</span>
        </div>
        {children}
      </div>
    </main>
  )
}
