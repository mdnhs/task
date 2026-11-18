"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Icon } from "@/components/icon"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group od-toaster"
      icons={{
        success: (
          <Icon name="check-circle" className="size-4" size={24} />
        ),
        info: (
          <Icon name="info" className="size-4" size={24} />
        ),
        warning: (
          <Icon name="warning" className="size-4" size={24} />
        ),
        error: (
          <Icon name="error" className="size-4" size={24} />
        ),
        loading: (
          <Icon name="spinner" className="size-4 animate-spin" size={24} />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--ink)",
          "--normal-border": "transparent",
          "--border-radius": "var(--r-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "od-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
