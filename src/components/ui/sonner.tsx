import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "#0f0f12",
          "--normal-text": "#FAFAFA",
          "--normal-border": "#2a2a30",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "!shadow-[0_8px_32px_rgb(0_0_0/0.6),0_0_0_1px_rgb(223_225_4/0.08)] !backdrop-blur-sm !transition-all",
          success: "!shadow-[0_8px_32px_rgb(0_0_0/0.6),0_0_0_1px_rgb(34_197_94/0.35)]",
          error: "!shadow-[0_8px_32px_rgb(0_0_0/0.6),0_0_0_1px_rgb(239_68_68/0.4)]",
          warning: "!shadow-[0_8px_32px_rgb(0_0_0/0.6),0_0_0_1px_rgb(245_158_11/0.35)]",
          info: "!shadow-[0_8px_32px_rgb(0_0_0/0.6),0_0_0_1px_rgb(223_225_4/0.3)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
