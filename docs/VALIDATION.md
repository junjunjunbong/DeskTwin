# Validation record — 2026-10-27

## Scope

This record covers the first runnable hero-desk MVP on `feat/hero-desk-mvp`. Tests run on the authorized macOS development machine with Node.js 26 and headless Chromium. No live Meta API requests were made. No user photos or real hardware observations were used.

## Automated results

| Check                           | Result                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| TypeScript strict typecheck     | Passed                                                              |
| Unit and HTTP/API tests         | 33 passed                                                           |
| Chromium end-to-end flows       | 11 passed                                                           |
| Production build                | Passed                                                              |
| Production server browser smoke | Passed: real WebGL canvas, controls, CSP, invalid request rejection |
| Production dependency audit     | 0 known vulnerabilities reported at check time                      |

Tests cover graph invariants, malformed imports, persistence, undo, explicit conversation confirmation, consent-gated photos, photo source preservation, user-guided checks, provider error handling, invalid model references, rate limits and bounded inputs. Model network calls are mocked; this validates integration contracts, not model performance.

A separate browser exercise also confirmed real canvas drag-and-drop: the selected dock moved from `(0.15, 0.05)` to `(0.81, -0.07)` and the new position persisted in the workspace. This is an additional manual browser exercise, not an extra counted end-to-end test.

## Screenshots

- `screenshots/hero-desktop.png`: actual development app, 1448 × 1086.
- `screenshots/hero-mobile.png`: narrow viewport, 390 × 844.
- `screenshots/hero-production.png`: actual production build, 1448 × 1086.

The visual goal is the selected first concept's large voxel desk, slim navigation, quiet floating controls and lower composer. The implementation uses original simplified geometry, not a pixel-identical reproduction of the generated image.

## Fixed during this implementation

- A modern browser's `scrollIntoView` return value was inadvertently returned by a React effect. Wrapped the effect body to ensure it returns no value; added page-error assertions to all browser tests.
- Duplicate device identities, dangling/self edges and invalid positions are rejected before persistence.
- Photograph proposals cannot change cable topology or operating state.
- Offline examples do not claim to be LLM output or independently verified hardware.
- Model-provided unknown device IDs are rejected; provider errors do not silently become fake successful live answers.

## Not yet validated

- Real Meta account authentication, billing and availability of the configured model.
- Live structured-output compatibility, visual recognition accuracy and diagnosis quality.
- Safari/Firefox and touch dragging on physical mobile devices.
- Prolonged use, low-end GPU performance, a full accessibility audit, screen-reader/WebGL parity and an independent security audit.
- OS-level connection detection: not implemented.
- Public hosting or multi-user isolation: not implemented or tested.

## Manual live acceptance checklist

Use an authorized key and a small budget, then enable Meta explicitly. First send a minimal device-connection description, confirm that the resulting proposal references existing IDs, and reject it once before accepting it. Then use a non-sensitive desk photo, confirm that nothing uploads before consent, and evaluate candidate identity/placement manually. Compare at least several desk photos and ambiguous cable descriptions before claiming product-level accuracy. Do not present a local demo or mocked integration test as a successful live-model demonstration.
