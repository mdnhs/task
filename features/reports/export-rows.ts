// FR-M1-31 (I27): there is ONE export row builder, `@opsdesk/domain/report-export`. The API's export job turns its tables into the PDF, Excel and CSV files, and this module is a thin
// re-export so the web can never drift from it (the old browser-side builders and their own CSV quoting are gone). The parity test (t67.test.ts) fails if a name stops being the same
// function. Every cell, in every format, goes through the domain's `exportText` (formula-safe: a leading = + - @ tab or CR is quoted).
export * from "@opsdesk/domain/report-export"
