import { AssertionError } from "node:assert"

/** Median of a list of timings (ms). */
export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** The `p`-quantile (nearest rank) of a list of timings (ms). */
export const quantile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]
}

/**
 * Speed assertions run on shared CI machines: a single noisy neighbour can fail a correct run. `fn` measures AND asserts; if it fails on an assertion (a timing bound, never a thrown
 * error of another kind) it runs once more, and the second result stands. A real regression is slow every time and still fails.
 */
export async function retryTimingOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const assertion = e instanceof AssertionError || (e instanceof Error && (e.name === "AssertionError" || /^expected /.test(e.message)))
    if (!assertion) throw e
    return fn()
  }
}
