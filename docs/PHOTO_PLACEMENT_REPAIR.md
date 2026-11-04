# Bounded photo placement repair

This implementation starts from `main` at `d02cac93cf007321cded2a52e31bbdc96a6f88e3`. It repairs small geometry errors while retaining the photo estimate's relative layout and the user's edits. It does **not** establish improved recognition or similarity to a real photograph. Verification uses local mock responses and sanitized geometry; no new paid model request or real-photo transmission is part of this work.

The historical live observations remain in [PHOTO_EVALUATION.md](PHOTO_EVALUATION.md). The original reproduction script is preserved verbatim in [baselines/replay-photo-placement-d02cac93.ts.txt](baselines/replay-photo-placement-d02cac93.ts.txt), with its recorded results in [baselines/photo-placement-d02cac93.json](baselines/photo-placement-d02cac93.json). The three baseline failures were independently rerun on the actual Mac repository before implementation: keyboard/mat and wrist-rest scenes each had one collision pair; the laptop scene had one support issue and one collision pair. The baseline `--expect-clear` invocation failed as expected. Private original photos/responses were not used as test inputs or transmitted.

## What the diagnosis established, and what changed

| Finding at the baseline                                                   | Implementation and limit                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A keyboard said to be on a mat still named the desk as its support.       | `supportId` now explicitly means the direct support. A uniquely identifiable thin mat may replace a model support estimate; an ambiguous mat, user choice or locked support is not replaced.                 |
| A wrist rest overlapped its keyboard.                                     | A separate bounded X/Z search can clear small gaps. The height-only fitter retains its role and never becomes a distant free-space search.                                                                   |
| Slight laptop overhang prevented even a tiny height correction.           | Template contact patches distinguish the laptop base and stand platform. A code-owned, tested edge allowance accepts the sanitized case without enlarging either object.                                     |
| Fixing support could remove several collision entries.                    | UI groups one collision pair once and shows overlaps associated with a support problem together. The final validator still checks every actual collision. Group counts are not a photo-quality score.        |
| A custom support's small remote bump could lift an entire inferred plane. | Custom support uses actual horizontal box faces, with no broad `nearbyTop` plane. Multiple faces share one consistent choice across review and manual placement.                                             |
| Model support was effectively treated like an explicit user instruction.  | Model/geometry/user provenance is distinct. Model and geometric height correction have a `0.12` scene-unit default limit; an explicit support choice may authorize a larger move, unless position is locked. |
| More objects took longer in one live request.                             | The prompt requests concise template-based output without dropping independent objects or supports. This has no measured live latency or recognition result yet.                                             |

## Common contact and support policy

`geometry.ts` owns template contact profiles. `spatial.ts` uses them for preview height fitting, review validation, **Place on surface**, free placement and desk attachment checks. Shape rendering and collision checking still use the actual component boxes.

The rendered desk cap's thickness changes from `0.035` to `0.047`, making its broad real top face exactly `2.4835`, the contact profile's height. Overall template bounds and existing fitted heights stay the same; the support plane no longer borrows a higher level from the decorative trim alone.

| Item / surface                           | Policy                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desk                                     | A code-owned broad tabletop face, shared with the rendered cap and prompt dimensions.                                                                                                                                                                                                                                                                                                                                 |
| Monitor                                  | Its small foot is the contact area; the display's full width is not its foot. A light bar can use the monitor's top.                                                                                                                                                                                                                                                                                                  |
| Monitor riser / laptop stand             | The two feet contact the desk; the upper platform supports the child.                                                                                                                                                                                                                                                                                                                                                 |
| Thin mat                                 | Partial contact is allowed only when a verifiable solid surface beneath the mat contains the child's entire contact base. A tiny mat overlap cannot support an object mostly outside the desk. Automatic direct-support inference is stricter: exactly one mat must contain the child's contact base and itself rest on the selected surface. Thick or tilted custom mats do not acquire this thin-covering behavior. |
| Template laptop on template laptop stand | At most **5% of the support's full width/depth per edge**, in the support's local axes. The contact center must remain inside the platform. Boundary tests cover acceptance, excessive overhang and actual penetration. This is an MVP visual-placement allowance, not a physical stability certification.                                                                                                            |
| Light bar                                | The central mounting contact is distinct from the bar's full visible width. The complete bar geometry still participates in collisions.                                                                                                                                                                                                                                                                               |
| Custom shape                             | Only verifiable horizontal box faces can be support surfaces. A missing or unsuitable face remains a review problem. Template overhang allowances are not inherited by a custom replacement shape.                                                                                                                                                                                                                    |

For a support with several actual faces, an already valid resting face is preferred; otherwise the nearest suitable face is considered. Selecting the same support ID must not teleport an already supported object onto another shelf level. A support relationship never exempts actual component-level SAT penetration. The existing swept collision checks for manual edits remain active.

## Preview state and user edits

`SceneReviewCandidate` keeps a seed with the original placement, scale and support reference. The seed is captured before fitting and preserved through inclusion, exclusion and saved-record rebinding. Review metadata contains:

- Support provenance: `model`, `geometry` or `user`.
- Independent position, rotation, size and support locks.
- Automatic position/support adjustments, including their original and reviewed values and a reason.
- Original draft and the bounded repair's status, search counters and unresolved issues.

Editing position, rotation or scale locks the corresponding values automatically. Choosing support records a user choice and locks that relation. Unlocking a value does not move it. Automatic fitting does not change scale or yaw even if their locks are off.

Changing a support fits only the affected candidate and its support descendants, in dependency order. Editing a supporting object's height, scale or custom geometry also refits only its affected descendants. The preview-specific inspector path validates the edited shape, updates dependent heights, then reports remaining support/SAT problems, so the ordinary editor cannot reject an intermediate parent/child intersection before propagation. Unrelated candidates stay unchanged. A locked child's position is retained and a review issue explains the conflict. Undo preserves user-edited support geometry and the dependent contact heights. Large model height changes remain explicit `height-budget` issues after refresh and at final validation.

Only the existing explicit desk attachments carry children horizontally. A preview support relation does not create a new X/Z carry rule; if an edited support moves out from under a child, the remaining footprint problem needs review. Parent carry cannot silently overwrite a different candidate's locked transform.

Excluding or restoring a matched desk also respects its children's independent position and rotation locks. Restoring a pending attachment does not erase those locks. Rebinding a candidate to a saved device updates adjustment references while retaining the original model seed. A preview **Place on surface** action on a supporting parent prepares the parent placement, propagates affected child heights, then checks the resulting scene. Ordinary editor snapping still rejects actual SAT intersections. A locked child stays in place and blocks application when the new support intersects it.

This graph and these locks are **preview-only**. Applying retains the existing Workspace format and existing desk-carry attachment behavior; it does not introduce a persistent support graph. Saved device identity, user reports, connections, excluded matched records and unrelated retained geometry remain protected.

## Limited placement search

`photoPlacement.ts::repairPhotoLayout()` is a pure, deterministic function separate from `fitSceneProposalForReview()`. The first version changes only small X/Z offsets, with the common height fitter used to maintain contact. It does not rescale, rotate, horizontally move desks/major supports, move position-locked candidates or relocate unrelated retained records.

| Default                      | Limit                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| X displacement               | 3% of the relevant desk's world-X AABB extent, measured from the original seed |
| Z displacement               | 5% of the relevant desk's world-Z AABB extent, measured from the original seed |
| Search sweeps                | 8                                                                              |
| Candidate evaluations        | 128                                                                            |
| Model/geometry height change | 0.12 scene units; no iterative partial lift beyond the limit                   |

Candidate offsets come from colliding pairs and are verified with the actual part-level SAT checks. Stable IDs determine iteration order. The score considers unresolved support/retained issues, unique collision pairs, penetration and squared X/Z displacement from the seed. A candidate cannot add a new collision pair, worsen existing penetration, reverse the established ordering of an interacting pair or exceed its seed bounds. Unrelated decoration does not become an ordering anchor.

Every call reconstructs unlocked movable X/Z coordinates from the same immutable seed before using the bounded budget. Consequently, repeated calls with the same seed and user constraints return the same layout even when the previous search exhausted its budget. User position locks, current size/yaw, chosen supports and retained records remain inputs to that calculation. There is no continuation that gradually walks an object farther with every click.

Unsolvable scenes return an editable draft and unresolved reasons. There is no distant free-space fallback or geometry enlargement. Final validation, not a repair score, authorizes application.

`buildSceneDraft()` uses the inexpensive validation/height path on the server. Browser `buildScenePreview()` and an explicit **Fit small gaps** action run the bounded search. The same expensive search is not performed once on the server and again in the browser.

## Review controls

The existing hero-desk layout, object editing, inclusion/restoration, manual addition and saved-record choice stay in place. The added controls are:

- **Show original estimate / Show reviewed layout**: read-only comparison with editing and apply disabled while showing the original.
- **Undo automatic adjustments**: restore automatic changes while retaining locked user edits and the effects of user-chosen supports.
- **Fit small gaps**: rerun the bounded repair with the current constraints.
- **Keep my edits**: explicit position, rotation, size and support locks.
- Per-object support provenance and automatic adjustment reasons.
- Unique collision-pair groups and support-first issue descriptions, without asserting that support correction necessarily removes penetration.

Invalid proposals still open in preview. Apply requires explicit confirmation, valid current review metadata and a final independent placement check. Existing stale-workspace and storage-conflict guards remain in force.

## Prompt, cancellation and timing

The existing proposal schema remains compatible with frozen responses. `supportId` is the direct surface immediately below an item, illustrated as `keyboard → mat → desk → floor`. Template `supportTop` values come from the same contact profiles as application geometry. The prompt prefers named templates, short notes and a brief message, while preserving separately editable visible objects and their supports.

The current photo provider deadline is **120 seconds** and the browser photo request timeout is **125 seconds**; chat retains its 35-second provider deadline. Browser abort closes the local response connection; the server passes an AbortSignal through `callMetaScene()`/`requestMeta()` to provider fetch and body reading. Normal request-body completion is not interpreted as cancellation. Late responses are discarded and their bodies canceled. Timeout or cancellation releases the local concurrency slot even if a fake fetch/stream ignores its signal or stalls its cancellation handshake.

The photo response includes an optional transport envelope, separate from scene data: `providerMs`, `validationMs`, `totalMs`, `responseBytes` and `objectCount`. The UI distinguishes analyzing from local fitting. **View processing times** separates photo preparation, model response, response validation, local fitting, and analysis-to-preview data readiness. The UI validates optional timing metadata and falls back to observed request time for old or malformed envelopes. Measurements stay in memory. Optional server measurement callbacks receive only aggregate counters and outcomes. The change does not log photographs, keys, provider text or private workspace content.

`providerMs` includes waiting for and reading the provider response. `validationMs` measures local response parsing/validation. These counters are not model-internal progress or a promise of completion. Propagating abort and freeing a local slot cannot guarantee that an external provider has stopped computation or billing. The local bounded search is synchronous; cancellation is checked before entering it, not during each candidate evaluation.

## Verification

All acceptance commands run on the user's Mac in an isolated checkout with an explicitly empty `MODEL_API_KEY`. The original repository's ignored artifacts are kept outside the test checkout. The test commands are:

```sh
MODEL_API_KEY='' npm run check
npm run format:check
MODEL_API_KEY='' npm run test:e2e -- --retries=0
MODEL_API_KEY='' npm run test:production
node --import tsx scripts/replay-photo-placement.ts
node --import tsx scripts/replay-photo-placement.ts --baseline
```

The integrated implementation is committed at `c352e3c01096524195be2ac0ab91edae0afdb5bb`. Verification results:

| Check                                      | Result                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                            | Typecheck, **376 unit/API tests across 22 suites**, and production build passed.                                                                                                                         |
| Changed photo-review browser tests         | **14/14 Chromium tests passed with zero retries**. This includes processing-time compatibility, compare/undo/reapply, independent locks, parent support placement, and 390-pixel mobile controls.        |
| Full `npm run test:e2e -- --retries=0`     | **121/121 Chromium tests passed, zero retries, 10.4 minutes**. Existing editing, storage, hardware-fixture, privacy, connection, proxy and workflow coverage all remained active.                        |
| `npm run test:production`                  | Passed against the production build: WebGL rendering, restrictive CSP, invalid-input rejection and local rotated-HEIC conversion to a 32 × 64 JPEG. Zero photo requests and no photo in browser storage. |
| `npm run format:check`, `git diff --check` | Passed.                                                                                                                                                                                                  |
| Current replay and `--expect-clear`        | All three sanitized cases passed with unchanged scales/yaw and bounded displacement.                                                                                                                     |
| Historical baseline                        | Original script preserved byte-for-byte; independently rerun baseline failures match the stored JSON record.                                                                                             |
| Existing local test artifacts              | All **99 original artifact files** retained matching hashes. No private original response/photo was used as a test input.                                                                                |

The 390-pixel mobile review screenshot was also inspected directly. The primary 3D scene, comparison actions and object review remained visible without horizontal overflow. Checks before the first two implementation commits passed with 345 and 349 tests respectively; the integrated commit passed with 376. No paid request or real-photo transmission was used for these gates.

The replay command now asserts **current acceptance** for all three sanitized cases, unchanged scale/yaw and bounded movement. `--expect-clear` remains an alias for current acceptance. `--baseline` prints the historical diagnostic record; old failure counts are not requirements of current code.

Meaningful regressions cover small/large overhang, true penetration, partial mat consistency, custom remote bumps and multiple faces, model height limits, user locks, affected descendants, retained records, deterministic results, exhausted-budget idempotence, unrelated decoration and unresolved-preview behavior. Browser tests exercise compare/undo/reapply, locks, grouped errors and a 390-pixel viewport. Real local HTTP tests use fake providers to test normal body completion, disconnect propagation, timeout during body reading, stuck cancellation, late responses and slot accounting.

### Sanitized placement acceptance

These counts describe three isolated geometry fixtures, not a full real-photo response. One collision pair may produce two per-object issue entries.

| Fixture                    | Independently reproduced baseline        | Current accepted result                                                                                                                                                        |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desk, mat, keyboard        | One keyboard/mat collision pair          | Direct support changes from desk to mat; X/Z, scale and yaw stay unchanged; zero issues.                                                                                       |
| Desk, keyboard, wrist rest | One keyboard/wrist-rest collision pair   | Keyboard Z changes `0.4 → 0.3645`; wrist-rest Z changes `0.7 → 0.7355`; scale and yaw stay unchanged; zero issues. The bounded search evaluates 12 candidates across 2 sweeps. |
| Desk, stand, laptop        | One support issue and one collision pair | Laptop Y changes `2.8128 → 2.81575`; X/Z, both objects' scales and yaw stay unchanged; zero issues.                                                                            |

### Regression coverage

| Contract                                                                                                      | Evidence                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Actual support faces, monitor feet, light-bar mount, phantom remote bumps, custom shape fallback              | `geometry.test.ts`, `spatial.test.ts`                                                                    |
| Small laptop overhang, width/depth boundaries, excessive overhang and real penetration                        | `spatial.test.ts`, `photoPlacement.test.ts`                                                              |
| Consistent partial-mat contact, underlying desk edge and all placement entry points                           | `spatial.test.ts`                                                                                        |
| Seed-relative bounds, 8/128 budget, determinism, repeated execution and unrelated decoration                  | `photoPlacement.test.ts`                                                                                 |
| Parent/child propagation, independent locks, retained records, excluded/pending attachments, record rebinding | `photoPlacement.test.ts`, `sceneReview.test.ts`, `sceneReviewLocks.test.ts`                              |
| Undo, stale state, ambiguity and independent final revalidation                                               | `photoPlacement.test.ts`, `sceneReview.test.ts`, `photo-review.spec.ts`, existing workflow/storage tests |
| Normal body completion, disconnect, delayed fetch/body, timeout and slot recovery                             | `photoTransport.test.ts` over real local HTTP with fake provider transport                               |
| Compare, undo, reapply, mobile controls, timing compatibility and parent Place on surface                     | `photo-review.spec.ts`                                                                                   |

Existing height-only X/Z preservation assertions remain in place. No test is skipped or removed to accept the change. One existing free-placement expectation now accepts either the desk or its mat when the shared contact policy accepts that surface; exact resting height, no new SAT collision and saved-record preservation are still checked. A separate blocked-mat case requires the search to continue to the desk.

## Remaining limits and next decisions

- There is no new real-photo benchmark. The original full 19-object private response was not replayed in this task; the three sanitized sub-scenes are not a substitute for it. Recognition, relative size, occlusion and visual resemblance remain model estimates.
- The 5% stand allowance, 0.12 height limit and desk-relative movement bounds are explicit product policies. Future photo evaluation may justify tuning them; synthetic acceptance alone does not justify relaxing them.
- The bounded search is conservative and incomplete. Complex crowded scenes, excessive overhang, ambiguous coverings, tilted support faces and locked conflicts can require manual review.
- General contact unions, physically stable center-of-mass simulation and arbitrary tilted support reconstruction are not implemented.
- Photo calibration, user image anchors, a persistent support graph, schema replacement and streaming remain outside this change.
- Actual provider latency/completion/cancellation billing and Safari/Firefox behavior need separately authorized testing. No such live result is claimed here.
