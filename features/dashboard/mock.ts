// MOCK: no backend until B8 to B11 (rosters and employee files feed the Coverage & Files card). Read from the static seed only, and shown on a demo deployment only (ENABLE_MOCK_MODULES=1, I16).
import { getData } from "@/lib/data"
import type { CoverageData } from "./types"

export const getCoverage = () => getData<CoverageData>("dashboard/coverage.json")
