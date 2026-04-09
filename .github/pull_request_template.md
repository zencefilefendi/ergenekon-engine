## What changed?

<!-- Short description of what this PR does -->

## Why?

<!-- Motivation / problem being solved -->

## How I tested it

- [ ] `npm run build` passes with zero errors
- [ ] `npx tsx demo/replay-demo.ts` shows BYTE-FOR-BYTE identical replay
- [ ] `npm run demo:fullstack` starts all 4 services without errors
- [ ] New interceptor (if any) has `uninstall*` function
- [ ] Recording logic does NOT call `Date.now()` or `Math.random()` directly

## Breaking changes?

<!-- Yes/No + description -->

## Checklist

- [ ] TypeScript strict mode — no `any` without comment
- [ ] Re-entrancy guard used for all new `session.record()` calls
- [ ] Zero overhead when no session is active
- [ ] Per-package README updated (if public API changed)
