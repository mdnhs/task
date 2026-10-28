import { getData } from "@/lib/data"
import type { PayrollDirectory, PayrollIssue } from "./types"

export async function getPayroll() {
  const [{ issues }, directory] = await Promise.all([
    getData<{ issues: PayrollIssue[] }>("payroll/issues.json"),
    getData<PayrollDirectory>("payroll/directory.json"),
  ])
  return { issues, directory }
}
