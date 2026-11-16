import type { Logger } from "pino"
import type { Db } from "./db/client"
import type { PushSender } from "./core/push/push"
import type { MalwareScanner } from "./core/scan/scanner"
import type { Storage } from "./core/storage/storage"
import type { Queue } from "./core/queue/queue"
import type { Env } from "./env"
import type { Auth } from "./modules/auth/auth"

export type { Db }

export type Clock = { now(): Date }
export type Mailer = {
  send(msg: { to: string; subject: string; text: string }): Promise<void>
  /** Drop cached provider config (called after the platform admin changes email settings). */
  invalidate?(): void
}
export type { Auth }
export type Deps = { env: Env; db: Db; auth: Auth; clock: Clock; mailer: Mailer; logger: Logger; queue: Queue; push: PushSender; storage: Storage; scanner: MalwareScanner }
