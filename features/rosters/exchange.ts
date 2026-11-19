import type { ApiExchange, ExchangeStatus, WeekAccess } from "./types"

// Open shifts and swaps (B8 Tasks 21, 22): what the roster page and My roster OFFER on the API's exchanges (the approver matrix R8-11 below); the API decides every one of them again and answers
// 403/404/409/422, so a button shown by mistake is a short refusal, never a change. The claim and swap REQUEST rules (located, eligible, published, upcoming) are the API's alone.

/**
 * R8-11 as buttons. Who DECIDES a claim or swap: an office role always; a supervisor on a draft week, and on a published week only when the location delegates swap approval; staff never.
 * Who RECOMMENDS: a supervisor on a published week who cannot decide (office is asked; the exchange moves requested to recommended once). Who CLAIMS an open shift: anyone, on a published week,
 * before it starts: the API checks that the person is located at the site and eligible. A decided or cancelled exchange offers nothing; an expired one (the shift has started) can still be rejected,
 * not approved. Nobody decides or recommends one they are a party to (`party`, from `isParty` with the page's `me`): the API's 403 self_decision, so nothing is offered.
 */
export function exchangeActions(p: { level: WeekAccess["level"]; weekStatus: "draft" | "published"; delegated: boolean; status: ExchangeStatus; expired: boolean; party?: boolean }) {
  const open = !p.party && (p.status === "requested" || p.status === "recommended")
  const decide = open && (p.level === "office" || (p.level === "supervisor" && (p.weekStatus === "draft" || p.delegated)))
  return {
    approve: decide && !p.expired,
    reject: decide,
    recommend: open && p.status === "requested" && p.level === "supervisor" && p.weekStatus === "published" && !decide,
  }
}

/** An open shift can be claimed: published week, still open, and not started (the shift's own wall time is compared by the API; this only hides what is certainly past, by date). */
export const canClaim = (weekStatus: "draft" | "published", personId: string | null, date: string, today: string): boolean => weekStatus === "published" && personId === null && date >= today.slice(0, 10)

/** The caller (`me`, empty when unknown) asked for it or is the colleague asked: the API's party to it (the person on a swapped shift is its `fromUserId`). */
export const isParty = (x: ApiExchange, me: string): boolean => !!me && (x.fromUserId === me || x.toUserId === me)

/** Open exchanges of one shift, claims and swaps apart. */
export const openExchanges = (list: ApiExchange[], shiftId: string, kind: ApiExchange["kind"]): ApiExchange[] => list.filter((x) => x.shiftId === shiftId && x.kind === kind && (x.status === "requested" || x.status === "recommended"))
