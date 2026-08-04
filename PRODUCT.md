# PRODUCT.md

## Register

product

## Platform

web

## Purpose

A focused tool for engineers and tech leads: paste a GitHub PR URL, generate AI review comments, preview and deselect findings, then post selected inline comments plus a PR summary to GitHub.

## Users

Solo engineers and engineering managers reviewing their own or teammates' PRs, typically at a desk in the evening, shipping a review under time pressure.

## Positioning

Task-first PR review console — not a marketing site, not a full GitHub clone. One primary flow: generate → curate → post.

## Brand personality

Calm precision with editorial review language (severity/status accents) and restrained glass depth. Feels like a modern code-review tool at night, not a neon dashboard.

## Visual direction (locked)

- Hybrid of **Editorial Diff** + **Signal Glass**
- Dark graphite surfaces, translucent elevated panels, soft focus/CTA glow
- Semantic accents: lime (valid/success), amber (warn), rose (danger)
- Typography: DM Sans (UI) + JetBrains Mono (paths/code)
- Motion: **expressive** stage transitions, generate pulse, checklist stagger, success micro-motion; respect `prefers-reduced-motion`

## Anti-references

- Purple-on-white / purple-indigo gradient SaaS themes
- Cream/sand paper backgrounds
- Side-stripe accent cards, hero-metric stat strips
- Full decorative glassmorphism / planet wallpaper
- Bounce/elastic easing, page-load choreography that blocks the task

## Accessibility

WCAG AA contrast targets; visible focus rings; reduced-motion alternatives for all animations.

## Versioning

Product version tracks meaningful capability changes (semver-style). Current release: **1.2.0**.

| Version | Date | Summary |
|---------|------|---------|
| **1.2.0** | 2026-08-04 | Browser review history (IndexedDB): save on generate, posted/not-posted status, post or delete from History. Responsive app header/footer. |
| **1.1.0** | 2026-08-04 | UI craft revamp (Editorial Diff + Signal Glass, expressive motion). Preview-before-post flow. Professional EM review tone, suggested code in comments, PR-level summary after post. OpenRouter instead of OpenAI SDK. |
| **1.0.0** | — | Initial release: paste PR URL → AI review → post inline GitHub comments (with fallback issue comment). |

### Change log notes

- **1.2.0** — History is local to the browser only (no server sync). Cap: 200 newest entries.
- **1.1.0** — Generate and post are separate API steps (`/api/review-pr/generate`, `/api/review-pr/post`). Visual direction locked in this document.
- Bump this table when shipping user-visible product changes; keep entries short and outcome-focused.
