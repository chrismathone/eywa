"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { EyIcon } from "@/components/icons/aywa-icons"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <EyIcon name="success" size={16} className="size-4" />
        ),
        info: (
          <EyIcon name="info" size={16} className="size-4" />
        ),
        warning: (
          <EyIcon name="alert" size={16} className="size-4" />
        ),
        error: (
          <EyIcon name="error" size={16} className="size-4" />
        ),
        loading: (
          <span className="inline-flex size-4 animate-spin">
            <EyIcon name="loader" size={16} />
          </span>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
