import { getData } from "@/lib/data"

import type { AssistantData } from "./types"

export const getAssistant = () => getData<AssistantData>("assistant/assistant.json")

/** Fills `{firstName}`, `{deadline}`, `{tz}` placeholders in every string, so the mock copy carries no tenant values. */
export function fillAssistant(data: AssistantData, vars: { firstName: string; deadline: string; tz: string }): AssistantData {
  const fill = (s: string) => s.replace(/\{(firstName|deadline|tz)\}/g, (_, k: keyof typeof vars) => vars[k])
  return {
    ...data,
    title: fill(data.title),
    subtitle: fill(data.subtitle),
    greeting: fill(data.greeting),
    suggestions: data.suggestions.map(fill),
    replies: data.replies.map((r) => ({ ...r, text: fill(r.text) })),
    fallback: fill(data.fallback),
    imageReply: fill(data.imageReply),
  }
}
