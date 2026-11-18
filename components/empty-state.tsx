import { Icon, type IconName } from "@/components/icon"

// `icon` is an icon name from components/icon.tsx (e.g. "task", "folder").
export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: React.ReactNode }) {
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
