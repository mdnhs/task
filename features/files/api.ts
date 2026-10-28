import { getData } from "@/lib/data"
import type { ClientFile, EmployeeDoc } from "./types"

export async function getFiles() {
  const [{ documents }, { clients }] = await Promise.all([
    getData<{ documents: EmployeeDoc[] }>("files/employee-docs.json"),
    getData<{ clients: ClientFile[] }>("files/client-files.json"),
  ])
  return { documents, clients }
}
