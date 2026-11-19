import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Add01Icon,
  Airplane01Icon,
  AlarmClockIcon,
  Alert02Icon,
  Archive02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  BanIcon,
  BanknoteIcon,
  BlocksIcon,
  Bookmark01Icon,
  BubbleChatIcon,
  Building03Icon,
  Calendar03Icon,
  CalendarAdd01Icon,
  CalendarCheck01Icon,
  CalendarClockIcon,
  Call02Icon,
  Camera01Icon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkBadge01Icon,
  CheckmarkCircle02Icon,
  ClipboardListIcon,
  Clock01Icon,
  Copy01Icon,
  CreditCardIcon,
  DashboardSpeed01Icon,
  DragDropVerticalIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  DeliveryTruck01Icon,
  Download01Icon,
  File02Icon,
  FileValidationIcon,
  Files01Icon,
  Flag02Icon,
  Folder01Icon,
  HandHelpingIcon,
  HelpCircleIcon,
  HourglassIcon,
  IdentityCardIcon,
  Image01Icon,
  ImageAdd01Icon,
  InformationCircleIcon,
  Invoice01Icon,
  Key01Icon,
  Layers01Icon,
  Link01Icon,
  ListPlusIcon,
  Loading03Icon,
  Location01Icon,
  Logout01Icon,
  Mail01Icon,
  Menu01Icon,
  Message01Icon,
  Mic01Icon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  Moon02Icon,
  MoreHorizontalIcon,
  NoteEditIcon,
  Notification01Icon,
  Notification03Icon,
  OctagonXIcon,
  PackageIcon,
  PaletteIcon,
  PauseIcon,
  PencilEdit02Icon,
  PlayIcon,
  Radar01Icon,
  RepeatIcon,
  SaveIcon,
  Search01Icon,
  SentIcon,
  Settings02Icon,
  ShieldCheckIcon,
  SidebarLeftIcon,
  SirenIcon,
  SlidersHorizontalIcon,
  SmartPhone01Icon,
  SparklesIcon,
  SquareLock02Icon,
  SquareUnlock01Icon,
  StickyNote01Icon,
  StopIcon,
  Tag01Icon,
  Target01Icon,
  Task01Icon,
  Tick02Icon,
  TickDouble02Icon,
  Time01Icon,
  Undo02Icon,
  UnfoldMoreIcon,
  Upload01Icon,
  User02Icon,
  UserAdd01Icon,
  UserGroupIcon,
  UserSettings01Icon,
  ViewIcon,
  ViewOffIcon,
  Wallet01Icon,
  Wrench01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"

/**
 * The one icon component of the app (Hugeicons, free stroke-rounded pack).
 * Names, the Hugeicons glyph behind each and the rules: .claude/docs/00-design-system/icons.md.
 * Only the icons listed below are imported, so the bundle carries just these glyphs.
 */
const ICONS = {
  grid: DashboardSquare01Icon,
  task: Task01Icon,
  report: File02Icon,
  flag: Flag02Icon,
  roster: Calendar03Icon,
  clock: Clock01Icon,
  userplus: UserAdd01Icon,
  folder: Folder01Icon,
  wallet: Wallet01Icon,
  box: PackageIcon,
  gear: Settings02Icon,
  history: Time01Icon,
  help: HelpCircleIcon,
  logout: Logout01Icon,
  search: Search01Icon,
  sliders: SlidersHorizontalIcon,
  mail: Mail01Icon,
  bell: Notification01Icon,
  plus: Add01Icon,
  arrow: ArrowUpRight01Icon,
  lock: SquareLock02Icon,
  unlock: SquareUnlock01Icon,
  phone: SmartPhone01Icon,
  menu: Menu01Icon,
  chat: Message01Icon,
  badge: IdentityCardIcon,
  brand: Tick02Icon,
  building: Building03Icon,
  receipt: Invoice01Icon,
  layers: Layers01Icon,
  shield: ShieldCheckIcon,
  users: UserGroupIcon,
  download: Download01Icon,
  copy: Copy01Icon,
  trash: Delete02Icon,
  archive: Archive02Icon,
  eye: ViewIcon,
  "eye-off": ViewOffIcon,
  more: MoreHorizontalIcon,
  alarm: AlarmClockIcon,
  warning: Alert02Icon,
  swap: ArrowDataTransferHorizontalIcon,
  "arrow-up": ArrowUp02Icon,
  verified: CheckmarkBadge01Icon,
  ban: BanIcon,
  cash: BanknoteIcon,
  "bell-ring": Notification03Icon,
  blocks: BlocksIcon,
  bookmark: Bookmark01Icon,
  "bubble-chat": BubbleChatIcon,
  calendar: Calendar03Icon,
  "calendar-check": CalendarCheck01Icon,
  "calendar-clock": CalendarClockIcon,
  "calendar-plus": CalendarAdd01Icon,
  camera: Camera01Icon,
  check: Tick02Icon,
  "check-all": TickDouble02Icon,
  "chevron-down": ArrowDown01Icon,
  "chevron-left": ArrowLeft01Icon,
  "chevron-right": ArrowRight01Icon,
  "chevron-up": ArrowUp01Icon,
  "chevrons-updown": UnfoldMoreIcon,
  "check-circle": CheckmarkCircle02Icon,
  "clipboard-list": ClipboardListIcon,
  "file-check": FileValidationIcon,
  files: Files01Icon,
  gauge: DashboardSpeed01Icon,
  grip: DragDropVerticalIcon,
  hand: HandHelpingIcon,
  hourglass: HourglassIcon,
  image: Image01Icon,
  "image-plus": ImageAdd01Icon,
  info: InformationCircleIcon,
  key: Key01Icon,
  link: Link01Icon,
  "list-checks": CheckListIcon,
  "list-plus": ListPlusIcon,
  spinner: Loading03Icon,
  pin: Location01Icon,
  mic: Mic01Icon,
  monitor: MonitorIcon,
  devices: MonitorSmartphoneIcon,
  moon: Moon02Icon,
  "note-pen": NoteEditIcon,
  error: OctagonXIcon,
  palette: PaletteIcon,
  "panel-left": SidebarLeftIcon,
  paperclip: Attachment01Icon,
  pause: PauseIcon,
  edit: PencilEdit02Icon,
  call: Call02Icon,
  plane: Airplane01Icon,
  play: PlayIcon,
  radar: Radar01Icon,
  repeat: RepeatIcon,
  reset: Undo02Icon,
  save: SaveIcon,
  send: SentIcon,
  siren: SirenIcon,
  sparkles: SparklesIcon,
  stop: StopIcon,
  "sticky-note": StickyNote01Icon,
  tag: Tag01Icon,
  target: Target01Icon,
  truck: DeliveryTruck01Icon,
  upload: Upload01Icon,
  "user-cog": UserSettings01Icon,
  user: User02Icon,
  wrench: Wrench01Icon,
  close: Cancel01Icon,
  zap: ZapIcon,
  card: CreditCardIcon,
} as const satisfies Record<string, IconSvgElement>

export type IconName = keyof typeof ICONS

/** Pixel sizes of the icon scale. Without `size` the `.ico` class sets the size (20px, see app/opsdesk.css) and context rules such as `.btn .ico` refine it. */
export const ICON_SIZES = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, "2xl": 24 } as const
export type IconSize = keyof typeof ICON_SIZES

/** One stroke weight for every icon (the sprite's 1.7); `.ico` contexts may override it, e.g. the logo mark. */
export const ICON_STROKE = 1.7

/** Shown when a name stored in config or JSON is not in the map. */
export const FALLBACK_ICON: IconName = "more"

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

const warned = new Set<string>()

/** Maps a string from config or JSON data to a known icon name; unknown names fall back to a neutral icon and log once in development. */
export function iconName(name: string | undefined | null): IconName {
  if (name && isIconName(name)) return name
  if (process.env.NODE_ENV !== "production" && !warned.has(String(name))) {
    warned.add(String(name))
    console.warn(`[Icon] unknown icon name "${name}", showing "${FALLBACK_ICON}"`)
  }
  return FALLBACK_ICON
}

export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "ref" | "name" | "size" | "strokeWidth"> & {
  name: IconName
  /** A token (`"lg"`) or a pixel number. Omit to size by the `.ico` class and its context rules. */
  size?: IconSize | number
  strokeWidth?: number
}

/**
 * Decorative by default (`aria-hidden`). When the icon is the only content of a control, give the control an
 * `aria-label` instead and keep the icon hidden; pass `aria-label` + `role="img"` only for a standalone meaningful icon.
 */
export function Icon({ name, size, strokeWidth = ICON_STROKE, className, ...rest }: IconProps) {
  const px = size === undefined ? undefined : typeof size === "number" ? size : ICON_SIZES[size]
  const labelled = rest["aria-label"] !== undefined || rest["aria-labelledby"] !== undefined
  return (
    <HugeiconsIcon
      icon={ICONS[iconName(name)]}
      size={px}
      strokeWidth={strokeWidth}
      className={[px === undefined ? "ico" : "", className].filter(Boolean).join(" ") || undefined}
      aria-hidden={labelled ? undefined : true}
      {...rest}
    />
  )
}

/** Every name in the map, for tests and docs. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[]
