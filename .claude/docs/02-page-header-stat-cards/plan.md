# 02 Page header + stat cards – plan
Files: `components/page-header.tsx`, rewrite `components/section-cards.tsx`.
1. `PageHeader` (title, subtitle, actions) – date string static for prototype (or `Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London'})`).
2. `SectionCards`: data array of 4 items `{title, value, suffix?, note, tone, highlighted}`; grid `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3`.
3. Highlighted card: `bg-gradient-to-br from-[#1E9B45] to-[#146B30]` + subtle diagonal pattern.
4. Arrow button: 32px circle, white/outlined on white cards, translucent white on green card.
