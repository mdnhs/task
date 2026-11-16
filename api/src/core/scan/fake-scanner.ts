import type { Readable } from "node:stream"
import type { MalwareScanner, ScanResult } from "./scanner"

const EICAR = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"

/**
 * Test scanner. `result` unset = auto: reads the stream and flags the EICAR test string as infected, anything else
 * clean. Set `result` to force a verdict. `scanned` counts completed scans.
 */
export type FakeScanner = MalwareScanner & { result?: ScanResult; scanned: number }

export function fakeScanner(result?: ScanResult): FakeScanner {
  const f: FakeScanner = {
    result,
    scanned: 0,
    async scan(stream: Readable) {
      const parts: Buffer[] = []
      for await (const c of stream) parts.push(c as Buffer)
      f.scanned++
      if (f.result) return f.result
      return Buffer.concat(parts).includes(EICAR) ? { clean: false, signature: "Eicar-Signature" } : { clean: true }
    },
  }
  return f
}
