import type { Logger } from "pino"
import type { Db } from "./db/client"
import type { Env } from "./env"
import type { Auth } from "./modules/auth/auth"

export type { Db }

export type Clock = { now(): Date }
export type Mailer = { send(msg: { to: string; subject: string; text: string }): Promise<void> }
export type { Auth }
export type Deps = { env: Env; db: Db; auth: Auth; clock: Clock; mailer: Mailer; logger: Logger }
