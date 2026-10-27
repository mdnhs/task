import { readFile } from "node:fs/promises"
import path from "node:path"

// Mock "API": every feature reads its JSON from public/data/<feature>/<name>.json.
// Each feature wraps this in its own api.ts; swap this one function for a real fetch() when a backend exists.
export async function getData<T>(file: string): Promise<T> {
  const raw = await readFile(path.join(process.cwd(), "public", "data", file), "utf-8")
  return JSON.parse(raw) as T
}
