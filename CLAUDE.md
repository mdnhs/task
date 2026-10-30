@AGENTS.md

# Product
Modular multi-tenant **SaaS** ("AI Business OS", modules M0–M9; see SRS). Phase 1 = M0 platform + M1 tasks and shift reports for the first client.
Billing goes through Stripe now, behind a provider-agnostic billing module so more payment methods can be added later (FR-M0-14).
Never hard-code tenant-specific values (company, departments, deadline, timezone, branding).

# Architecture: read first
- `.claude/docs/architecture.md`: feature-based structure. Code lives in `features/<feature>/{components,api.ts,types.ts,index.ts}`.
  Shared code goes in `components/` (incl. shadcn `ui/`), `hooks/` and `lib/`. Features don't import each other; import a feature only via its `index.ts`.
- Every page and component needs an exact-match loading skeleton: `features/<feature>/components/skeletons.tsx` + `loading.tsx` per route,
  built with `Sk` (`components/sk.tsx`). See `architecture.md` → Skeletons. Update the skeleton whenever its component changes.

# UI work: read first
- `.claude/docs/00-design-system/ui-rules.md`: OpsDesk theme rules (borderless, radius, tokens, no shadcn defaults)
- Motion: tokens + rules in `ui-rules.md` → Motion. CSS first; `motion/react` only for sliding indicators (layoutId), list enter/exit, drag reorder, count-up. No GSAP.
  Once-only animations (progress fill etc.) that start off screen wait until scrolled into view. Use `components/reveal-observer.tsx` (`REVEAL` selector) + a CSS hold rule (ui-rules.md rule 20).
- `.claude/docs/00-design-system/brief.md`: design tokens and hard rules
- `.claude/docs/README.md`: index of per-feature docs
- Mock data lives in `public/data/<feature>/*.json`, read by `features/<feature>/api.ts` via `lib/data.ts`
- `.claude/docs/requirements/SRS.md`: the main spec (AI Business OS, by the BA). Check it before building any feature; Appendix A has build status and the Phase 1 plan.
  `SRS-v1.2-built.md` is the old OpsDesk spec, kept as the record of what was built (old IDs like `FR-TASK-14` in code comments point there).
