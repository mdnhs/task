import { Icon } from "./icons"

/**
 * A Google Drive link that follows the device policy (FR-M1-50..52, CR-02, CR-06).
 * `allowed` is decided on the server per request (canUse("drive", currentDevice)); features never import each other, so it arrives as a prop.
 * On an untrusted device there is no link, no preview and no download: only the note.
 */
export function DriveLink({ allowed, href, label, className }: { allowed: boolean; href: string; label?: string; className?: string }) {
  if (!allowed)
    return (
      <span className={`drive-locked${className ? ` ${className}` : ""}`}>
        <Icon name="lock" />
        Available on your work PC
      </span>
    )
  return (
    <a className={`drive-link${className ? ` ${className}` : ""}`} href={href} target="_blank" rel="noopener noreferrer">
      <Icon name="folder" />
      {label ?? href}
    </a>
  )
}
