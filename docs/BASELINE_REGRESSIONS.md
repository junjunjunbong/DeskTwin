# Baseline drag, persistence and integrated regression investigation — 2026-10-29 KST

## Exact baseline and separation

The baseline is authenticated `origin/main` at `e1802011768fe6a9f35c7570038c2cb508ac20d5`. Its source and original 50 browser tests were run in an isolated checkout. The new mat/rug cases were run in a second unchanged-main checkout, without replacing the original 50 tests. The implementation was exercised in the separate feature checkout.

This run used Linux, Node.js 24.22.1, Playwright 1.64.1 and Chromium 153.0.8010.0 with software WebGL. All servers were loopback-only with an explicitly empty Meta key. Physical Mac hardware, Safari and real mobile touch were not available.

## Original 50-test suite

The current unchanged baseline completed with **49 passes and one failure in 6.1 minutes, without retries**. The failed test was `tests/workspace.spec.ts` → `position changes and deletes can be undone`.

The test moved a Dock, deleted it, clicked Undo and immediately read `localStorage`. It expected eight devices but read seven. The trace records Undo click completion at `359002.513ms`, the subsequent read starting at `359004.473ms`, and the seven-device result at `359010.404ms`. The later failure screenshot/accessibility snapshot already shows eight devices and an enabled Redo control.

`useWorkspace.enqueue()` waits for the prior queue operation and then `navigator.locks.request()` before writing. Playwright's click completion does not await this application transaction. The result demonstrates a read-before-commit race; the later restored UI is not evidence of lost Undo data.

The identical original test was rerun **once**, unchanged, with `--retries=0` and separate output. It passed: one expected case, no unexpected/flaky/skipped cases, 4.506-second test duration. This diagnostic rerun remains separate from the first full suite's 49/50 result.

The previous Mac run's five failures and two retried passes were not identically reproduced. Without its traces, the other failures cannot be assigned this cause.

## Actual default mat/rug defect

A direct solver reproduction attempts `+0.1` x movement in each untouched example object with auto surface snapping and swept collision enabled:

| Object       | Baseline solver result                   |
| ------------ | ---------------------------------------- |
| Keyboard     | `Keyboard would intersect Desk mat.`     |
| Mouse        | `Mouse would intersect Desk mat.`        |
| External SSD | `External SSD would intersect Desk mat.` |
| Desk chair   | `Desk chair would intersect Floor rug.`  |

The objects begin above their coverings. Auto-snap considers only desks and the floor, lowers the moving object into the omitted mat/rug, and then the normal collision detector rejects that introduced intersection.

The actual WebGL tests project a world-space point through the default camera and send real mouse down/move/up events. They request `+0.24` x movement without moving any initial object. All four unchanged-main cases fail the movement assertion:

| Object       | Requested x movement | Baseline actual x movement |
| ------------ | -------------------: | -------------------------: |
| Keyboard     |                 0.24 |                   0.008462 |
| Mouse        |                 0.24 |                   0.015393 |
| External SSD |                 0.24 |                   0.012355 |
| Desk chair   |                 0.24 |                   0.002510 |

The SSD pointer target uses its visible left end because the mug occludes its center from the default camera. This is an actual visible part of the object, not an injected application move command. Movement/storage expectations are the same across before/after runs.

## Correction and after-run

The correction treats thin horizontal mat parts as support. It chooses any needed clearance, then performs an upward movement, translation and settling movement through the existing swept solid solver. The renderer stores the validated intermediate path so saving replays it exactly as one Undo step.

All four default-object cases pass in the feature branch. The full focused spatial browser file passes **15/15, no retries, in 2.3 minutes**. It additionally checks a fast thin blocker, a curved path, desk-attached motion, cancellation, surface/attachment changes, transform collisions, shape edits, persistence, JSON round trips and input regressions. Connections update during the gesture, intermediate frames do not save, and Undo/Redo restores the expected workspace.

The spatial unit file passes **36/36**. Coverage includes thick/tilted custom mats, direct downward collision, clearance blocked by an overhead object, rotated footprint empty corners, support during dimension changes and exact saved path replay. Existing layouts and initial example coordinates are not rewritten. Collision checking is not globally disabled.

## First integrated run: two application failures

The first combined 67-case browser run completed with **65 passes and two failures in 7.7 minutes, without retries**. These were real application defects, separate from the earlier read-before-commit assertion and the test-runner output collision. Both failures remain part of the validation record after the focused fixes.

### Accepted input reverted before React published the new value

`monitor template parts can be extended, rotated, undone and reloaded without changing reports` expected an invalid position edit to restore the previously entered y value `1.8`, but the input showed `0.3`. The trace establishes that the stored part already contained y `0.3` before the invalid `-1` attempt. Its size x `0.42`, position x `0.7` and rotation z `30` were present. The history contained seven events after template customization, Add box and four intended edits; six were expected. The rollback itself restored the value that had actually been saved.

`CommitTextInput` and `CommitNumberInput` unconditionally restored their drafts from the latest prop when a save promise resolved. React could publish the accepted workspace after that promise resolved. The restore therefore read the previous value, and a following blur could submit it as an extra edit. The same code is present in baseline `e180201`. The failing test's trace contains no HMR or reload during its edit sequence.

A deterministic browser fixture separates command completion from publication of the accepted parent prop. Before the correction, **both tests failed (2/2)**: numeric `1.8` reverted to `0.3`, and `First name` reverted to `Original name`. This fixture uses the real input components, with explicit test-only save controls; it does not change a production route or command path.

The correction commits only a dirty draft, so Enter and the subsequent unchanged blur are one edit. A successful draft stays visible until the accepted prop arrives. A deliberate return to the old prop remains a new edit even while publication is pending. Rejected commands and exceptions still restore the accepted value, and newer typed drafts are preserved. All production callbacks return their asynchronous command result rather than silently discarding failures.

The existing monitor test now also verifies all four edited values and exactly four added history events. Its collision rejection, user-source/report preservation, template restore, Undo, JSON round trip and reload assertions remain. The focused run passed **5/5 in 33.4 seconds, without retries**: both deterministic fixtures, the existing input behavior test, queued-field editing, and the complete monitor workflow. No per-field sleep or forced pass was added.

### A conflict notice intercepted the canvas Undo control

`stale undo cannot restore an older snapshot over another tab and invalid external data is kept` timed out while clicking Undo. Playwright reported that the `Load latest saved workspace` button inside the centered fixed storage-conflict alert intercepted the pointer. Undo was visible and enabled; the overlay prevented the test from reaching the storage guard.

Storage-conflict notices and transient messages now occupy the fixed details area, or the active modal that owns the user action. The mobile collapsed panel announces the saved-workspace conflict and offers an expansion control. The application retains the same stale-save rejection and explicit Load latest action.

The original stale-Undo test remains unchanged. A new browser regression checks that notices lie outside the desktop canvas, that a canvas control remains clickable, and that mobile collapse/expansion keeps the notice and resolution action reachable while preserving scene space. The focused storage/mode run passed **14/14 in 1.7 minutes, without retries**. No forced click, bypass of hit testing or weakened persistence assertion was used.

### Final combined verification

The latest `npm run check` passed TypeScript, **167 unit/API tests**, and the production build. The expanded browser suite completed **70/70 in 6.6 minutes, with zero retries**, while the repository remained frozen. The production smoke after both fixes **passed**, including WebGL, CSP and invalid API input rejection with no runtime errors. Final formatting/diff checks are recorded in [VALIDATION.md](VALIDATION.md). This full-suite result is separate from both the first 65/67 run and the focused passes.

## Async assertion corrections

Updated UI tests poll the exact expected persisted field or complete saved workspace, or wait for a success state that the UI emits after the transaction. The original source/status/connection/Undo expectations remain. There are no arbitrary sleeps, skipped failures or retries added to make an expected result pass.

A separate mode test holds the actual Web Lock while clicking Save. It verifies that storage remains unchanged, controls remain pending/disabled across View/Edit, and exactly one edit commits after releasing the lock. This makes the asynchronous completion contract observable.

## Test runner output collision

The first parallel spatial attempt and a UI run initially wrote to the same Playwright output directory. One runner removed another runner's temporary trace, producing `browserContext.close ENOENT`. That spatial attempt was stopped and rerun with its own ports, `--output` directory and `PLAYWRIGHT_HTML_OUTPUT_DIR`. The isolated 15-case run passed.

That artifact error is a runner coordination issue, distinct from both the baseline Undo assertion and the four real blocked-drag assertions. Use isolated report trees for parallel browser processes.

## Limits

These results establish behavior in the stated Linux Chromium environment. They do not validate native macOS compilation, real display/USB changes, OS permission prompts, Safari or physical mobile interaction. The final integrated suite and hosted CI are recorded separately in [VALIDATION.md](VALIDATION.md).
