# Page fidelity: evidence, reconstruction and acceptance

Adapted from the original page-recreation references/fidelity-contract.md. This is a resource for the same task skill, not a separate skill or a universal automatic reconstruction promise. Operational checks below require actual adapter capabilities; no browser scripts are bundled.

## Keep two goals separate

First preserve the original composition, typography, cropping, responsive layout, interactions and movement. Do not rebrand, unify easing, shorten animation or replace scroll storytelling with tabs. Only after the baseline is verified should you extract reusable components, repeated data, content budgets and design tokens. Verify again after templating.

Use permitted original source/runtime when possible. Missing evidence is not evidence of static behavior. Model defaults are not facts about the source page.

## Per-section evidence contract

Assign stable semantic keys to hero, navigation, card groups and scroll narratives; original and local selectors may differ but must pair one to one.

- Composition: section order, container widths, grid/gaps, line breaks, baselines, object-fit/position, crops, layers and masks, not just the first viewport.
- Responsive: desktop/tablet/narrow layouts and both sides of actual breakpoints, DPR, font readiness, color scheme and reduced-motion mode.
- Resources: full URL including query, request/response identity, MIME, SHA-256, local mapping, provenance/permission and failure/unvisited states. Fonts, media, wasm and textures are dependencies too.
- Motion: targets, triggers, scroll container/start/end, duration/delay/endDelay, easing including per-keyframe easing, offsets, iterations/direction/fill/playbackRate, stagger/overlap, exit/interruption/re-entry.
- Trajectory: same trigger and absolute time or scroll progress, sampling interval, position/transform/opacity/clipping. Verify speed through change over time, not intuition.
- Runtime performance: load/font/first-frame readiness, real frame intervals/jank, scroll inertia and input feedback latency. Seeked samples cannot establish FPS.
- Template behavior: text budgets, image proportions/focal points, repeated-component data, insertion/removal/reordering and stable motion target keys.

Every claim must identify its evidence level: `observed`, `source`, `inferred`, `replacement`, `unknown`. A generic reveal or fitted spring is inferred/replacement unless supported by original evidence.

## Bounded comparison plan

Use real observed selectors, not invented ones. Match viewport, DPR, locale, color scheme, reduced motion, browser version and relevant page state. Use 1–40 uniquely matched semantic targets and 3–60 increasing sample times beginning at zero, at most 60 seconds. Choose sampling to cover the actual motion rather than treating defaults as adequate. Record initial, scroll and hover states from clean contexts; preserve unreachable/unsupported states as unknown.

CSS/WAAPI document-timeline metadata and seeked keyframes can expose layout/motion differences. They do not capture actual JS trigger ordering, JS-created stagger, scroll-scrub mapping, interruption, input latency or FPS. Animations completed before observation may be missed. Closed shadow roots, embedded frames, pseudo-element visual frames, JS/rAF, GSAP, Canvas/WebGL, video and audio require additional actual observations. No measurable animation means motion is unknown, not passed.

A geometric tolerance such as 0.5 CSS pixels is a scoped diagnostic, not permission to hide visually important differences. Never crop edges or auto-align to hide whole-page offsets. Static screenshot matches and matching sample endpoints do not prove behavior between samples.

## Acceptance is itemized, never a weighted score

1. Compare original screenshots, geometry, fonts and crops across multiple viewports and key states.
2. Trigger real motion and verify timing/curves, not just initial/final frames.
3. Disconnect the source and check local resources, routes, console and runtime.
4. Lengthen titles, change image proportions, add/delete/reorder repeated cards; layout and motion must remain valid after reload.
5. Mark unsupported source/server/WebGL functionality and unverified states individually. Do not replace them with static imagery or generic motion then say complete.

A scoped match is only a match within the stated plan. Missing targets/samples, unsupported behavior or expected-but-unobserved motion remains `needs-review`. Counts of assets, canvases, screenshots or successful commands never certify fidelity. Consequential clicks need explicit authorization; allowlists alone are not a sandbox because even same-origin navigation, hover and scroll can execute state-changing page code.
