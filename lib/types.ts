// Types shared by more than one feature. Feature-only types live in features/<feature>/types.ts.

export type Tone = "ok" | "warn" | "bad" | "info" | "mute"
export type Status = { tone: Tone; label: string }

export type Dept = "all" | "Security" | "Cleaning"
