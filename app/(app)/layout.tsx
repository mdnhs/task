import { AiAssistant, getAssistant } from "@/features/assistant"
import { AppShell, getNavigation, getUser } from "@/features/shell"

// Every signed-in page shares the shell (sidebar, topbar, AI assistant).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [navigation, user, assistant] = await Promise.all([getNavigation(), getUser(), getAssistant()])

  return (
    <AppShell navigation={navigation} user={user} assistant={<AiAssistant data={assistant} />}>
      {children}
    </AppShell>
  )
}
