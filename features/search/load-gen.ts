// Generation counter for in-flight index loads. Each load takes a ticket; a sign-out or company switch (reset) bumps the generation, so a load that
// started before it and resolves later fails its ticket check and never commits the old company's index. Two overlapping loads: only the latest commits.
export type LoadGate = { begin: () => () => boolean; invalidate: () => void }

export function createLoadGate(): LoadGate {
  let gen = 0
  return {
    begin() {
      const mine = ++gen
      return () => mine === gen
    },
    invalidate() {
      gen++
    },
  }
}
