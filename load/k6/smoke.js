// Smoke profile: 5 VUs for 1 minute, the same mix and thresholds. Usable in the e2e stack: npm run load:smoke
import { makeOptions } from "./scenarios.js"

export { mix, pool } from "./scenarios.js"
export { default } from "./scenarios.js"
export const options = makeOptions([
  { duration: "10s", target: 5 },
  { duration: "40s", target: 5 },
  { duration: "10s", target: 0 },
])
