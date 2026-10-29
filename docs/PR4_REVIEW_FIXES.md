# PR #4 review fixes: verification record

This record distinguishes reproducible Linux regression evidence from the user's independent Mac report. The frozen baseline matched the content of PR #4 revision `2de1813`. No paid Meta calls, actual Mac scans, hardware control, account billing changes or public deployment were performed for these revisions.

The user reported a successful native helper build and successful production-mode detection on their Mac at that baseline. Repository documentation records that qualitative result only. Detected counts, names, identifiers and snapshots are not included. `native/HardwareProbe.swift` and `scripts/build-hardware.mjs` are unchanged in these fixes; the revised development proxy and hardware backend still need a new Mac check.

## Four issues and their regression evidence

| Issue                                                | Before                                                                                                                                                                                          | Fix and focused result                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-origin development POSTs returned 403           | Real browser → Vite → API baseline run: 2 failed and 2 passed. Hardware Start and consented fixture chat failed; rejection checks and the direct API control established the proxy distinction. | Preserve the browser Host with `changeOrigin: false`. Keep exact Origin/Host, custom-header and token checks. The real proxy harness passed 4/4 in 16.3 seconds with zero retries. Hardware observations and the provider transport were injected fixtures. The chat harness used a non-credential test key and a local `fetchImpl` with no network fallback. |
| Duplicate identifier lost identity confidence        | Three focused baseline regressions failed: one → two observations made an old binding `Not detected`; two → one restored a persistent identity; another tab retained a trusted cached result.   | Add explicit ambiguity evidence and an append-only local quarantine. Known-colliding observations stay session-only, and the earlier binding requires an explicit match. Hardware/domain/API tests passed 63/63. A new browser flow covering one → two → one → zero and explicit replacement approval passed 1/1 in 24.7 seconds, zero retries.               |
| Unsaved device details disappeared during navigation | A frozen-baseline browser reproduction lost an edited name after Home navigation.                                                                                                               | Keep drafts by device in application memory across mode, Home, selection and panel changes. Review stale saved records, retain rejected saves, and check `expectedDetails` inside queued command application. All five focused draft browser cases passed.                                                                                                    |
| View allowed immediate connection deletion           | A frozen-baseline browser reproduction showed ordinary Remove changing the saved connection count immediately in View.                                                                          | View offers **Edit connections**. Add/remove actions require Edit; removal has inline Confirm/Cancel. Assistant connection proposals also require Edit and explicit approval. The focused mode/connection coverage passed after correcting one new test selector, as described below.                                                                         |

The two focused UI baseline reproductions both failed as intended. The combined focused UI run contained 13 cases: 12 passed and one new test failed because an exact accessible-label selector did not select the intended combobox. The selector was changed to the semantic combobox role; a two-case targeted rerun exited successfully with passing Playwright results. Assertions about saved connections, confirmation and mode behavior were retained. This was a test-selection correction, not suppression of an application failure.

Independent review also found a persistence-recovery edge in the initial quarantine implementation: if saving a newly observed collision failed, another tab could retain a trusted cached result and a later singleton could regain the original identity. A new test reproduced the failure. The final implementation retains observed ambiguity and invalidates caches before awaiting persistence, retries the complete known union on recovery, and does not publish results until that union is saved. The passing 63-test hardware/domain/API total includes this regression.

## Trust and data boundaries

The quarantine stores empty owner-only markers under `local-data/hardware-identity-collisions/<installation scope>/`. Names contain only category plus the existing opaque matching key. No raw native fingerprint, serial, detected name, snapshot or user workspace is written to it. The ledger is bounded, strictly validated, local-only, ignored by Git and absent from portable workspace JSON and model context. Existing saved bindings are not changed without user confirmation.

A successful same-installation scan can still report **Not detected** for an unambiguous approved identity. Known ambiguity produces **Match again**; stopped detection, an unavailable bridge, a failed category and unsafe trust storage remain unknown. These states do not alter user-reported operating status or invent cable routes.

Successfully written collision evidence survives an ordinary bridge restart. If every write of newly observed evidence fails and the process terminates before a successful retry, the unwritten in-memory evidence cannot survive. A subsequent singleton can then be treated as persistent if no marker was ever saved. No durable pre-scan journal is implemented for that combined failure. This is distinct from the tested normal restart and recoverable-write-failure cases. See [Mac hardware details](MACOS_HARDWARE.md) and [privacy boundaries](PRIVACY.md).

## Integrated validation

Linux, Node.js 24.22.1, locked npm dependencies and Playwright 1.64.1 were used with the existing isolated Chromium 153.0.8010.0 executable override and software WebGL. The source tree stayed unchanged during the full run at code head `8c62f54`. The run registered 82 tests, exited with status 0 and wrote a final Playwright `passed` result with no failed tests; no tests were skipped or retried. The list reporter stopped emitting case lines after case 28, so its text log is incomplete; the successful process completion and final result are recorded separately. In the installed Playwright version, that end-of-run failed-test list also includes registered tests that did not run or were unexpectedly skipped. Its empty result therefore confirms completion; missing stdout is not treated as a substitute for executed tests. The cause of the truncated list output is unproven, and no extra test retries were used to fill it.

| Gate                                                 | Status                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Final `npm run check` / complete unit and API total  | **Passed: 188 unit/API tests**, TypeScript and production build                                       |
| Complete browser suite                               | **Passed: all 82 Chromium cases**, zero retries                                                       |
| Remote GitHub Actions                                | At code head `8c62f54`, both jobs failed before execution; see the run details below                  |
| New actual-Mac development and revised-backend check | Not performed by this Linux environment; manual verification remains required                         |
| Production browser smoke                             | **Passed:** WebGL, interaction, CSP, invalid API input and missing-asset rejection; no runtime errors |
| Formatting and diff                                  | **Passed**, including the review documentation                                                        |
| Live paid Meta requests                              | Not performed                                                                                         |

Focused hardware/API tests initially hit sandbox `EPERM` when binding loopback listeners; the exact suite then passed with loopback permission. This environment restriction is separate from an application failure. All browser runs used isolated loopback ports and outputs outside the repository. The ordinary test server used an empty Meta key; the proxy harness used a fake test credential and an injected local transport with no network fallback. No existing developer server or saved user workspace was reset.

Relevant regression sources: [real proxy harness](../tests/proxy.spec.ts), [hardware service tests](../server/hardware.test.ts), [presence and approval tests](../src/domain/hardwareState.test.ts), [hardware browser flow](../tests/hardware.spec.ts), [device draft browser flows](../tests/device-drafts.spec.ts), and [mode and connection browser flows](../tests/connections.spec.ts).

## Hosted CI and manual verification

At the source revision `8c62f54`, [Actions run 40843555751](https://github.com/junjunjunbong/DeskTwin/actions/runs/40843555751) reports `verify` and `native-compile` as completed failures. Both direct job-step endpoints returned empty lists. This does not establish any executed hosted unit, browser or native-build check. The user identified a billing or spending-limit failure in the earlier reviewed run; the exact annotation for this new run is not available through the connected API. Account settings and workflow checks were not changed. Any later documentation-head result is reported on the PR separately.

The same branch and existing PR #4 were updated with fast-forward commits. Main remains unchanged at the checked `e180201` baseline. Other worktrees and branches were preserved; no reset, force push, merge, billing change or public deployment was used.

The [Mac runbook](MACOS_HARDWARE.md) provides the exact local build, development and production commands. Its checklist includes explicit local consent before a scan, display/USB hot-plug, Stop/Start, bridge interruption, privacy checks and identity limitations. This revision's identifier-collision reproductions use synthetic data only; no actual collision on the user's Mac was observed by this environment.

## Browser review images

These screenshots use the example workspace and synthetic edited names. Hardware detection is stopped; they contain no actual Mac observations.

Home keeps each device's unfinished details reachable in the fixed right panel:

![Unsaved device drafts remain after Home navigation](screenshots/review-unsaved-drafts-home.png)

Connection removal is reviewed inside the Edit inspector. The saved relationship remains until explicit confirmation:

![Inline connection removal confirmation in Edit](screenshots/review-connection-confirmation.png)
