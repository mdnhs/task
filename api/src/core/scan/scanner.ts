import type { Readable } from "node:stream"

export type ScanResult = { clean: true } | { clean: false; signature: string }

/** Malware scanner. Consumes the stream completely; must never answer `clean` unless the scanner said so. */
export type MalwareScanner = {
  scan(stream: Readable): Promise<ScanResult>
}

/** Used when CLAMD_HOST is not configured: scans fail (files stay pending), they are never waved through. */
export function unconfiguredScanner(): MalwareScanner {
  return {
    scan: async (stream) => {
      stream.destroy()
      throw new Error("malware scanner is not configured (set CLAMD_HOST)")
    },
  }
}
