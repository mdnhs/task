import type { Env } from "./env"

export type Clock = { now(): Date }
export type Mailer = { send(msg: { to: string; subject: string; text: string }): Promise<void> }
// Placeholders: replaced by the real Drizzle Db (T0.3) and Better Auth (T1.1) types.
export type Db = { execute(query: unknown): Promise<unknown> }
export type Auth = unknown
export type Deps = { env: Env; db: Db; auth: Auth; clock: Clock; mailer: Mailer }
