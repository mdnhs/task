import type { Persona } from "./stack-env"

export const AUTH_DIR = new URL("./.auth/", import.meta.url).pathname
export const statePath = (p: Persona): string => `${AUTH_DIR}${p}.json`
