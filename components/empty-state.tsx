import { Icon } from "@/components/icons"

// `icon` is a sprite name from components/icons.tsx (e.g. "task", "folder").
export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="od-empty">
      <span className="od-empty-ico" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}
