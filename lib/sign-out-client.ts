// The browser side of sign-out, shared by the account menu and the MFA gate card. The server action (app/actions/session.ts) revokes the session and clears
// the cookies, then redirects; a soft redirect can leave a gated page showing (or never arrive when the API call is slow or refused), so this always ends
// with a FULL navigation to /sign-in, whatever the action did. Pure, so it is tested with fakes.
export const SIGN_IN_PATH = "/sign-in"

export async function runSignOut(o: { clear(): void; action(): Promise<void>; assign(to: string): void; waitMs?: number }): Promise<void> {
  try {
    o.clear()
  } catch {
    /* blocked storage must not keep the person signed in */
  }
  try {
    await Promise.race([o.action(), new Promise<void>((resolve) => setTimeout(resolve, o.waitMs ?? 8000))])
  } catch {
    /* the action clears the cookies even when revoking fails; the navigation below happens either way */
  }
  o.assign(SIGN_IN_PATH)
}
