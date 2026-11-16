import type { Db } from "./db/client"
import type { Env } from "./env"

export type { Db }

export type Clock = { now(): Date }
export type Mailer = { send(msg: { to: string; subject: string; text: string }): Promise<void> }
// Placeholder: replaced by the Better Auth type (T1.1).
export type Auth = unknown
export type Deps = { env: Env; db: Db; auth: Auth; clock: Clock; mailer: Mailer }
