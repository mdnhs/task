import { getData } from "@/lib/data"

import type { AssistantData } from "./types"

export const getAssistant = () => getData<AssistantData>("assistant/assistant.json")
