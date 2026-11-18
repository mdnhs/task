import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { loadSource } from "./source"

// Regression (found by the T6.9 real-stack run): T6.8 deleted public/data/tasks/{tasks,projects,templates}.json and the seed refused with bad_source.
test("the seed's whole source loads from public/data plus its own fixtures (no Docker)", () => {
  const src = loadSource(fileURLToPath(new URL("../../../../public/data/", import.meta.url)))
  expect(src.tasks.length).toBe(61)
  expect(src.projects.length).toBe(2)
  expect(src.templates.length).toBe(3)
  expect(src.loaded).toEqual(expect.arrayContaining(["tasks/tasks.json", "tasks/projects.json", "tasks/templates.json"]))
})
