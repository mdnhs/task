import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google"

import "./globals.css"
import "./opsdesk.css"
import "./styles/shell.css"
import "./styles/kit.css"
import "./styles/dashboard.css"
import "./styles/tasks.css"
import "./styles/reports.css"
import "./styles/attention.css"
import "./styles/staff-rosters.css"
import "./styles/recruitment.css"
import "./styles/files.css"
import "./styles/payroll.css"
import "./styles/orders.css"
import "./styles/settings.css"
import "./styles/account.css"
import "./styles/billing.css"
import "./styles/audit.css"
import "./styles/auth.css"
import "./styles/platform.css"
import "./styles/whatsapp.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils";

const geist = Plus_Jakarta_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
