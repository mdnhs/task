import type { Dept } from "@/lib/types"

export type NavItemData = {
  href: string
  icon: string
  label: string
  badge?: { text: string; alert?: boolean }
  lock?: boolean
  // Shown on the Coming soon page until the feature is built.
  description?: string
  srs?: string
}
export type NavigationData = {
  menu: NavItemData[]
  general: NavItemData[]
  departments: { dep: Dept; label: string }[]
}
export type UserData = { name: string; role: string; email: string; initials: string; unreadNotifications: number }
