"use server"

import { getSession } from "@/lib/session"

import { getSearchData } from "./api"
import type { SearchConfig, SearchItem } from "./types"

/**
 * Lazily loaded on the first open of the search (never in the page's RSC payload, so no page carries other modules' text).
 * Reads the session and filters the index, quick actions and popular searches by role on the server.
 */
export async function searchIndex(): Promise<{ items: SearchItem[]; config: SearchConfig }> {
  const session = await getSession()
  if (!session.signedIn) return { items: [], config: { popular: [], actions: [] } }
  return getSearchData(session.role)
}
