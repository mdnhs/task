# Icons

One icon set for the whole app: Hugeicons, free stroke-rounded pack (`@hugeicons/react` + `@hugeicons/core-free-icons`, both exact-pinned). Replaces the old in-house SVG sprite and `lucide-react`.

## Rules

1. One component: `components/icon.tsx`, `<Icon name="roster" />`. Only that file imports `@hugeicons/core-free-icons`. No inline SVG for UI icons.
2. `name` is the typed union `IconName`. A new icon = one named import + one line in the map in `components/icon.tsx` + one line in the table below. Named imports only, so the bundle carries just the glyphs used.
3. Names stored as strings (shell/platform navigation JSON, search quick actions, dashboard adapters) go through `iconName(str)`; unknown names show the neutral `more` icon and log once in development. `components/icon.test.ts` fails if a name used in code or JSON is not in the map.
4. Size: omit `size` and the `.ico` class gives 20px; context rules (`.btn .ico{width:18px}` ...) refine it. Or pass a token (`size="lg"`: xs 12, sm 14, md 16, lg 18, xl 20, 2xl 24) or a pixel number. Tailwind `size-*` classes win over `.ico` (it lives in `@layer base`).
5. Stroke: one weight, 1.7 (`ICON_STROKE`), set per glyph; `.ico` contexts may override (logo mark 2.2). Colour is `currentColor`; never hard-code a colour.
6. Accessibility: `aria-hidden` by default. If the icon is the only content of a control, label the control (`aria-label` on the button/link), not the icon. Pass `aria-label` to the Icon only for a standalone meaningful icon.
7. No `lucide-react`, no `#i-` sprite references: `components/icon.test.ts` fails if either reappears.
8. Pick icons for meaning (roster = calendar, report = document, bell = notification, gear = settings, box = package), the same meaning always gets the same name.

## Sprite icons (old `<Icon name>` from `components/icons.tsx`)

| Old sprite name | New name | Hugeicons export | Files using it |
|---|---|---|---|
| `grid` | `grid` | `DashboardSquare01Icon` | 7 |
| `task` | `task` | `Task01Icon` | 39 |
| `report` | `report` | `File02Icon` | 32 |
| `flag` | `flag` | `Flag02Icon` | 12 |
| `roster` | `roster` | `Calendar03Icon` | 25 |
| `clock` | `clock` | `Clock01Icon` | 13 |
| `userplus` | `userplus` | `UserAdd01Icon` | 5 |
| `folder` | `folder` | `Folder01Icon` | 14 |
| `wallet` | `wallet` | `Wallet01Icon` | 9 |
| `box` | `box` | `PackageIcon` | 3 |
| `gear` | `gear` | `Settings02Icon` | 5 |
| `history` | `history` | `Time01Icon` | 12 |
| `help` | `help` | `HelpCircleIcon` | 5 |
| `logout` | `logout` | `Logout01Icon` | 0 |
| `search` | `search` | `Search01Icon` | 7 |
| `sliders` | `sliders` | `SlidersHorizontalIcon` | 3 |
| `mail` | `mail` | `Mail01Icon` | 2 |
| `bell` | `bell` | `Notification01Icon` | 4 |
| `plus` | `plus` | `Add01Icon` | 16 |
| `arrow` | `arrow` | `ArrowUpRight01Icon` | 9 |
| `lock` | `lock` | `SquareLock02Icon` | 26 |
| `phone` | `phone` | `SmartPhone01Icon` | 10 |
| `menu` | `menu` | `Menu01Icon` | 4 |
| `chat` | `chat` | `Message01Icon` | 3 |
| `badge` | `badge` | `IdentityCardIcon` | 9 |
| `brand` | `brand` | `Tick02Icon` | 3 |
| `building` | `building` | `Building03Icon` | 3 |
| `receipt` | `receipt` | `Invoice01Icon` | 5 |
| `layers` | `layers` | `Layers01Icon` | 3 |
| `shield` | `shield` | `ShieldCheckIcon` | 5 |
| `users` | `users` | `UserGroupIcon` | 10 |
| `download` | `download` | `Download01Icon` | 10 |
| `copy` | `copy` | `Copy01Icon` | 2 |
| `trash` | `trash` | `Delete02Icon` | 0 |
| `unlock` | `unlock` | `SquareUnlock01Icon` | 2 |
| `eye` | `eye` | `ViewIcon` | 1 |
| `eye-off` | `eye-off` | `ViewOffIcon` | 1 |
| `more` | `more` | `MoreHorizontalIcon` | 2 |

Counts are files that contain the quoted name (TSX/TS/JSON), so a few include look-alike words.

## lucide-react icons (old import name to new `<Icon name>`)

| lucide | New name | Hugeicons export | Files importing it |
|---|---|---|---|
| `AlarmClock` | `alarm` | `AlarmClockIcon` | 2 |
| `AlertTriangle` | `warning` | `Alert02Icon` | 1 |
| `ArrowLeftRight` | `swap` | `ArrowDataTransferHorizontalIcon` | 1 |
| `ArrowRightLeft` | `swap` | `ArrowDataTransferHorizontalIcon` | 2 |
| `ArrowUp` | `arrow-up` | `ArrowUp02Icon` | 1 |
| `BadgeCheck` | `verified` | `CheckmarkBadge01Icon` | 2 |
| `Ban` | `ban` | `BanIcon` | 1 |
| `Banknote` | `cash` | `BanknoteIcon` | 1 |
| `Bell` | `bell` | `Notification01Icon` | 1 |
| `BellRing` | `bell-ring` | `Notification03Icon` | 1 |
| `Blocks` | `blocks` | `BlocksIcon` | 1 |
| `Bookmark` | `bookmark` | `Bookmark01Icon` | 1 |
| `Building2` | `building` | `Building03Icon` | 3 |
| `CalendarCheck` | `calendar-check` | `CalendarCheck01Icon` | 1 |
| `CalendarClock` | `calendar-clock` | `CalendarClockIcon` | 6 |
| `CalendarDays` | `calendar` | `Calendar03Icon` | 1 |
| `CalendarIcon` | `calendar` | `Calendar03Icon` | 2 |
| `CalendarPlus` | `calendar-plus` | `CalendarAdd01Icon` | 2 |
| `Camera` | `camera` | `Camera01Icon` | 1 |
| `Check` | `check` | `Tick02Icon` | 5 |
| `CheckCheck` | `check-all` | `TickDouble02Icon` | 1 |
| `CheckIcon` | `check` | `Tick02Icon` | 4 |
| `ChevronDown` | `chevron-down` | `ArrowDown01Icon` | 1 |
| `ChevronDownIcon` | `chevron-down` | `ArrowDown01Icon` | 3 |
| `ChevronLeft` | `chevron-left` | `ArrowLeft01Icon` | 3 |
| `ChevronLeftIcon` | `chevron-left` | `ArrowLeft01Icon` | 4 |
| `ChevronRight` | `chevron-right` | `ArrowRight01Icon` | 4 |
| `ChevronRightIcon` | `chevron-right` | `ArrowRight01Icon` | 6 |
| `ChevronUpIcon` | `chevron-up` | `ArrowUp01Icon` | 2 |
| `ChevronsUpDown` | `chevrons-updown` | `UnfoldMoreIcon` | 1 |
| `CircleCheckIcon` | `check-circle` | `CheckmarkCircle02Icon` | 1 |
| `CircleHelp` | `help` | `HelpCircleIcon` | 1 |
| `ClipboardList` | `clipboard-list` | `ClipboardListIcon` | 3 |
| `Clock` | `clock` | `Clock01Icon` | 1 |
| `Copy` | `copy` | `Copy01Icon` | 1 |
| `CreditCard` | `card` | `CreditCardIcon` | 1 |
| `FileCheck2` | `file-check` | `FileValidationIcon` | 1 |
| `FileText` | `report` | `File02Icon` | 2 |
| `Files` | `files` | `Files01Icon` | 1 |
| `Gauge` | `gauge` | `DashboardSpeed01Icon` | 1 |
| `HandHelping` | `hand` | `HandHelpingIcon` | 2 |
| `Hourglass` | `hourglass` | `HourglassIcon` | 1 |
| `ImageIcon` | `image` | `Image01Icon` | 1 |
| `ImagePlus` | `image-plus` | `ImageAdd01Icon` | 1 |
| `Info` | `info` | `InformationCircleIcon` | 2 |
| `InfoIcon` | `info` | `InformationCircleIcon` | 1 |
| `KeyRound` | `key` | `Key01Icon` | 1 |
| `Layers` | `layers` | `Layers01Icon` | 1 |
| `Link2` | `link` | `Link01Icon` | 1 |
| `ListChecks` | `list-checks` | `CheckListIcon` | 3 |
| `ListPlus` | `list-plus` | `ListPlusIcon` | 1 |
| `Loader2Icon` | `spinner` | `Loading03Icon` | 1 |
| `LogOut` | `logout` | `Logout01Icon` | 1 |
| `MapPin` | `pin` | `Location01Icon` | 4 |
| `Mic` | `mic` | `Mic01Icon` | 1 |
| `Monitor` | `monitor` | `MonitorIcon` | 1 |
| `MonitorSmartphone` | `devices` | `MonitorSmartphoneIcon` | 1 |
| `Moon` | `moon` | `Moon02Icon` | 1 |
| `MoreHorizontalIcon` | `more` | `MoreHorizontalIcon` | 2 |
| `NotebookPen` | `note-pen` | `NoteEditIcon` | 1 |
| `OctagonXIcon` | `error` | `OctagonXIcon` | 1 |
| `Package` | `box` | `PackageIcon` | 1 |
| `Palette` | `palette` | `PaletteIcon` | 1 |
| `PanelLeftIcon` | `panel-left` | `SidebarLeftIcon` | 1 |
| `Paperclip` | `paperclip` | `Attachment01Icon` | 1 |
| `Pause` | `pause` | `PauseIcon` | 1 |
| `PenLine` | `edit` | `PencilEdit02Icon` | 1 |
| `Phone` | `call` | `Call02Icon` | 1 |
| `Plane` | `plane` | `Airplane01Icon` | 1 |
| `Play` | `play` | `PlayIcon` | 1 |
| `Plus` | `plus` | `Add01Icon` | 4 |
| `Radar` | `radar` | `Radar01Icon` | 1 |
| `Repeat` | `repeat` | `RepeatIcon` | 2 |
| `Repeat2` | `repeat` | `RepeatIcon` | 1 |
| `RotateCcw` | `reset` | `Undo02Icon` | 2 |
| `Save` | `save` | `SaveIcon` | 1 |
| `SearchIcon` | `search` | `Search01Icon` | 1 |
| `Send` | `send` | `SentIcon` | 1 |
| `Settings` | `gear` | `Settings02Icon` | 1 |
| `ShieldCheck` | `shield` | `ShieldCheckIcon` | 4 |
| `Siren` | `siren` | `SirenIcon` | 1 |
| `SlidersHorizontal` | `sliders` | `SlidersHorizontalIcon` | 1 |
| `Smartphone` | `phone` | `SmartPhone01Icon` | 1 |
| `Sparkles` | `sparkles` | `SparklesIcon` | 1 |
| `Square` | `stop` | `StopIcon` | 1 |
| `StickyNote` | `sticky-note` | `StickyNote01Icon` | 1 |
| `Tag` | `tag` | `Tag01Icon` | 1 |
| `Target` | `target` | `Target01Icon` | 1 |
| `Trash2` | `trash` | `Delete02Icon` | 5 |
| `TriangleAlert` | `warning` | `Alert02Icon` | 2 |
| `TriangleAlertIcon` | `warning` | `Alert02Icon` | 1 |
| `Truck` | `truck` | `DeliveryTruck01Icon` | 1 |
| `Upload` | `upload` | `Upload01Icon` | 1 |
| `UserCog` | `user-cog` | `UserSettings01Icon` | 1 |
| `UserPlus` | `userplus` | `UserAdd01Icon` | 2 |
| `UserRound` | `user` | `User02Icon` | 1 |
| `Users` | `users` | `UserGroupIcon` | 3 |
| `Wrench` | `wrench` | `Wrench01Icon` | 1 |
| `X` | `close` | `Cancel01Icon` | 12 |
| `XIcon` | `close` | `Cancel01Icon` | 2 |
| `Zap` | `zap` | `ZapIcon` | 1 |

## Nearest match, owner may change

Hugeicons free has an equivalent for every glyph; these are the ones where the look or the exact meaning is only close:

- `brand` (Tick02Icon): Hugeicons has no logo-check mark; the plain tick is the nearest (the in-house mark was a tick with a short bar).
- `badge` (IdentityCardIcon): Sprite was an ID badge with a face; IdentityCard is the closest card glyph.
- `history` (Time01Icon): Sprite was a clock with a back arrow; Time01 is a plain clock face.
- `swap` (ArrowDataTransferHorizontalIcon): ArrowDataTransferHorizontal is the two-way arrow pair used for lucide ArrowLeftRight/ArrowRightLeft.
- `gauge` (DashboardSpeed01Icon): DashboardSpeed01 is the speedometer glyph.
- `hand` (HandHelpingIcon): HandHelping (offering hand) matches the open-shift take meaning.
- `reset` (Undo02Icon): Undo02 (curved back arrow) replaces lucide RotateCcw (re-record).
- `radar` (Radar01Icon): Radar01 for the clock-in zone.
- `note-pen` (NoteEditIcon): NoteEdit (note with pencil).
- `bell-ring` (Notification03Icon): Notification03 (bell with waves).
- `devices` (MonitorSmartphoneIcon): MonitorSmartphone is exported as is.
- `verified` (CheckmarkBadge01Icon): CheckmarkBadge01 (scalloped badge with tick).
- `chevrons-updown` (UnfoldMoreIcon): UnfoldMore (two opposed chevrons).
- `call` (Call02Icon): Call02 (handset) replaces lucide Phone; the sprite 'phone' stays a smartphone.
- `files` (Files01Icon): Files01 (stacked documents).
- `arrow` (ArrowUpRight01Icon): ArrowUpRight01 is a thinner diagonal arrow than the old one.

To change one, edit its import and map line in `components/icon.tsx` and its row here.
