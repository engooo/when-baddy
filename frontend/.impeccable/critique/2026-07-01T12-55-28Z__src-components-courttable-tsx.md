---
target: src/components/CourtTable.tsx
total_score: 20
p0_count: 2
p1_count: 2
timestamp: 2026-07-01T12-55-28Z
slug: src-components-courttable-tsx
---
Method: dual-agent (A: Explore-1 · B: Explore-2)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading state is clear, but data freshness signal is too subtle and filter updates provide little explicit state feedback. |
| 2 | Match System / Real World | 2 | Venue abbreviations and mixed pricing labels increase interpretation burden for first-time users. |
| 3 | User Control and Freedom | 3 | Controls are rich, but key filtering actions are gated behind modal interaction on mobile. |
| 4 | Consistency and Standards | 2 | Labeling and interaction semantics are inconsistent across time buckets, pricing, and venue identity cues. |
| 5 | Error Prevention | 2 | Ambiguous states (unknown price, disabled/past contexts) are not explicitly explained before misinterpretation occurs. |
| 6 | Recognition Rather Than Recall | 1 | Users must remember venue abbreviation mappings and internal state meanings instead of recognizing them directly. |
| 7 | Flexibility and Efficiency | 2 | Quick filters help, but power-user shortcuts and preference persistence are missing. |
| 8 | Aesthetic and Minimalist Design | 2 | Information density is useful but visual and interaction layers compete for attention on smaller screens. |
| 9 | Error Recovery | 2 | Recovery affordances are limited when users hit ambiguous states or failed data expectations. |
| 10 | Help and Documentation | 1 | No visible legend/help for abbreviations and pricing semantics in the primary view. |
| **Total** |  | **20/40** | **Needs Significant Improvement** |

## Anti-Patterns Verdict

**LLM assessment:** Not generic AI slop, but there are product-UX friction points that feel over-complex for urgent mobile booking decisions. The strongest concern is cognitive overhead from abbreviations, mode-specific behavior differences, and inconsistent semantic cues.

**Deterministic scan:**
- CLI detector on target file returned 0 findings.
- Browser overlay pass in the live page surfaced 5 anti-pattern classes in runtime context, including low-contrast instances, line-length concerns, single-font overuse, cramped padding, and glow/grid style artifacts.
- This indicates runtime/page-level issues not captured by source-file-only scanning.

**Visual overlays:** Overlay injection succeeded and findings are visible in the [Human] browser tab with impeccable console groups.

## Overall Impression

The interface is functionally capable and domain-aware, but it currently trades too much user cognition for compactness. It needs clearer semantics and stronger first-glance affordances, especially for mobile urgent use.

## What's Working

- Strong domain logic and time-slot rendering depth support realistic court discovery workflows.
- Availability color scale communicates relative scarcity effectively for scan-based decisions.
- Expandable venue-level detail is a useful progressive-disclosure mechanism for advanced users.

## Priority Issues

- **[P0] What:** Venue identity relies on cryptic abbreviations without persistent in-context legend.
  - **Why it matters:** First-time and infrequent users cannot quickly map options, increasing mistakes and abandonment.
  - **Fix:** Add always-visible venue legend near sport/date controls and improve badge aria-labels to full venue names.
  - **Suggested command:** /impeccable clarify

- **[P0] What:** Pricing semantics are inconsistent (value, open, or absent states).
  - **Why it matters:** Users lose trust in slot quality and hesitate to click through to booking.
  - **Fix:** Normalize display states: explicit known price, explicit unknown placeholder, never blank for actionable slots.
  - **Suggested command:** /impeccable polish

- **[P1] What:** Core filters are modal-gated on mobile.
  - **Why it matters:** Users need one extra layer of interaction before they can even understand available controls.
  - **Fix:** Surface highest-frequency filters inline and reserve modal for advanced controls.
  - **Suggested command:** /impeccable layout

- **[P1] What:** Date-navigation options are redundant and mentally expensive.
  - **Why it matters:** Multiple mechanisms for one task increase friction during urgent use.
  - **Fix:** Keep one primary date mechanism with one secondary fallback; tighten labels and discoverability.
  - **Suggested command:** /impeccable distill

- **[P2] What:** Mobile touch and hover affordances are asymmetrical.
  - **Why it matters:** Critical explanatory cues are easier on desktop hover than on touch, creating mobile inequity.
  - **Fix:** Promote key hints to always-visible or tap-revealed micro-labels on touch devices.
  - **Suggested command:** /impeccable adapt

## Persona Red Flags

- **Power user:** Missing quick preference persistence (favorite venues/times) and fast repeat-flow actions.
- **First-timer:** Venue codes and mixed status/price semantics force interpretation before action.
- **Mobile urgent user:** Filter/date discoverability and touch-first hinting are weaker than needed for rapid booking.

## Minor Observations

- Current-hour and slot semantics vary across mode/time-bucket contexts.
- Table information hierarchy is strong on desktop but visually compressed on narrow screens.
- Bottom legend placement reduces discoverability when users do not scroll through the full table.

## Questions to Consider

- Which matters more for your users: maximum density, or faster first-time comprehension?
- Should venue identity be compact-first (badges) or confidence-first (explicit names with secondary badges)?
- Would you accept a slightly taller top control area to reduce downstream interaction errors?
