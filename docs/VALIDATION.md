# Initial validation record — View/Edit and Mac hardware, 2026-10-29 KST

> This is the original implementation record before the independent review of `2de1813`. Its 167-unit/API and 70-browser results and Mac-validation limits describe that checkpoint. See [PR #4 review fixes](PR4_REVIEW_FIXES.md) for the later four regressions, 188-test checks, 82-case browser run, the separate user-reported Mac baseline and current CI status.

**Final integrated verification status: local checks passed.** The expanded browser suite completed **70/70 in 6.6 minutes, with zero retries**, after both application causes from the first 65/67 run were corrected. The repository stayed frozen during that full run. The final production smoke, formatting and diff checks passed. TypeScript, all 167 unit/API tests and the production build passed. Native compilation and physical Mac detection remain unverified; hosted CI has no executed steps.

## Scope and repository baseline

The latest authenticated `origin/main` checked at the start was `e1802011768fe6a9f35c7570038c2cb508ac20d5`. `AGENTS.md`, README and current source were read. Work is isolated on `feat/hackathon-macos-inspector-20261029`. Earlier checkouts, branches and uncommitted files were preserved. The prior unfinished View/Edit, hardware and spatial work was copied into the new checkout, reviewed and completed rather than treated as already validated.

No reset, force push, deletion of another worktree, main merge, public deployment or repository visibility change is part of this work. Commits and the review PR are managed separately from these local tests.

## Environment and test boundaries

Checks use Linux, Node.js 24.22.1, locked npm dependencies, Playwright 1.64.1 and an isolated Chromium 153.0.8010.0 binary with software WebGL through the existing executable override. The isolated fallback browser is a temporary test tool, not an added production dependency; the normal Playwright-managed browser was not used for these runs. Local socket/browser operations needed the execution environment's approved access.

Browser tests operate real WebGL canvas pointer events, localStorage, Web Locks and HTTP requests. Hardware service/API/UI scenarios use explicit fixtures or probe doubles. **They do not establish that the Swift program compiles or that it recognizes the user's Mac hardware.** Actual CoreGraphics/AppKit and IOKit source is implemented, but real macOS compilation, permissions, display/USB enumeration and hot-plug behavior are unverified here. Bluetooth live detection is explicitly unavailable.

Every application/test server has an empty `MODEL_API_KEY`. Meta transports and photo responses are fixtures. No paid Meta request or real photo-quality evaluation was performed. Hardware observations are kept separate from user reports and never used as an automatic “working” result.

## Completed local checkpoints

| Check                                                         | Observed result                                              | Interpretation                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` after the application fixes                   | Passed: TypeScript, **167 unit/API tests**, production build | Current combined code check; native hardware was not executed                                                                                                 |
| Untouched original main browser suite                         | **49 passed, 1 failed**, 50 cases, 6.1 minutes, no retries   | Original Undo test read storage before its asynchronous write finished                                                                                        |
| That original failing test, one isolated diagnostic rerun     | **1 passed**, no retries, 4.506-second test duration         | Separate result; the first baseline remains 49/50                                                                                                             |
| Four new default-scene drag cases against unchanged main      | **4 failed** at actual movement assertions                   | Reproduces keyboard/mouse/SSD/chair getting stuck on coverings                                                                                                |
| Fixed spatial browser suite                                   | **15 passed**, no retries, 2.3 minutes                       | Includes the same four default drags, live endpoints, fast blockers, attachments, cancellation, Undo/Redo and persistence                                     |
| Spatial unit suite                                            | **36 passed**                                                | Includes real footprints, thick/tilted mats, overhead lift blockers and path replay                                                                           |
| Earlier View/Edit and input-focused browser checkpoint        | **6 passed**                                                 | Fixed panel, preserved drafts, user reports/diagnosis, mobile space and input/queue coverage                                                                  |
| Earlier hardware browser checkpoint                           | **8 passed**                                                 | Consent, matching, duplicates, export, absence semantics, reconnect, two tabs, and pending-request Stop with fixtures                                         |
| First combined browser run                                    | **65 passed, 2 failed**, 67 cases, 7.7 minutes, no retries   | Exposed the accepted-input publication race and a conflict notice intercepting Undo; both are recorded below                                                  |
| Deterministic input-publication regressions before correction | **2 failed / 2**, no retries                                 | The real text and numeric components restored an old prop after save completion                                                                               |
| Input/monitor focused run after correction                    | **5 passed**, 33.4 seconds, no retries                       | Both deterministic fixtures, input semantics, queued edits, and the full monitor shape workflow with stronger field/history assertions                        |
| Storage/mode focused run after notice correction              | **14 passed**, 1.7 minutes, no retries                       | Original stale-Undo case unchanged; new desktop/mobile notice placement and resolution checks                                                                 |
| Final full combined browser suite                             | **70 passed**, 6.6 minutes, zero retries                     | Adds two deterministic input tests and one notice-layout case to the first combined suite; repository frozen during execution                                 |
| Latest production smoke after both fixes                      | **Passed**                                                   | WebGL, CSP and invalid API input rejection; no runtime errors                                                                                                 |
| Final formatting / diff check                                 | **Passed**                                                   | Record checks against the final combined source and documentation                                                                                             |
| Native Mac build and physical hardware                        | **Not run successfully in this environment**                 | Linux cannot compile against Apple's SDK; hosted native job has no completed execution steps; follow [MACOS_HARDWARE.md](MACOS_HARDWARE.md) on the actual Mac |
| Live Meta API                                                 | **Not run**                                                  | Requires separate approval; fixture success is not a live-account claim                                                                                       |

## Hosted CI status

GitHub Actions is separate from the local results above. At code head `7e1c9e3`, [run 40824252822](https://github.com/junjunjunbong/DeskTwin/actions/runs/40824252822) reports both `verify` and `native-compile` as completed failures. The direct job-step endpoints returned empty lists for `native-compile` job `123283520955` and `verify` job `123283521267`; no execution steps or job logs were available. The annotations endpoint was inaccessible through the available API, so the exact reason is **unknown**. The earlier billing/spending-limit history is not proof of this run's cause. No account billing settings were changed.

The workflow's `native-compile` job targets `macos-15` and runs only `npm run hardware:build` against the real SDK. It does not start detection or scan the CI host. With no completed job steps, this run supplies no evidence that the helper compiled. The `verify` job retains unit/API, browser and production checks; its hosted test results are likewise unavailable. Any later CI result must be recorded with its run URL and commit, rather than inferred from local passes.

## Baseline failures and test corrections

The earlier Mac report mentioned five failures and two retried passes among 50 tests. That exact set was not reproduced in this Linux run, and the original Mac traces were not available. The current unchanged baseline's single failure is specifically `position changes and deletes can be undone`: immediately after Undo, it read seven devices, while the later failure snapshot already showed eight and enabled Redo.

The storage layer queues writes and acquires an asynchronous Web Lock. A completed click is not a completed write. Updated assertions wait for the exact saved position, device/connection count, approved source or full workspace before continuing; the original expected values remain. They do not replace state assertions with a delay or enable retries. The new held-lock mode test also demonstrates that a save remains pending until the lock is released.

The default drag regression is a different application defect. The old snap pass lowered moving objects to a desk/floor while omitting their mat/rug. The new support transition checks every lift, translation and settling segment against normal solids. No collision flag is disabled and no existing starting position is changed. See [BASELINE_REGRESSIONS.md](BASELINE_REGRESSIONS.md) for measured movement and reproduction.

### First combined run and application corrections

The first integrated run finished **65/67, with two failures in 7.7 minutes and no retries**. Those failures are retained here instead of being reclassified as passing after focused reruns.

The monitor shape test exposed a pre-existing input race. A successful save could resolve before React published its accepted prop; the input's `finally` block then restored an older draft, and blur could save that stale value. In the failing trace, y `1.8` had already become saved y `0.3` before the intentional invalid edit, with an extra history event. There was no reload/HMR in that test. The fix retains a successful draft until parent publication and requires a new dirty edit before another commit. A deliberate return to an old value, newer typed drafts, rejection rollback and exceptions remain supported. Two deterministic fixture tests both failed on the old component, then passed with the correction. The focused five-case run passed in 33.4 seconds, without retries. The original monitor workflow now asserts all four intended edits and exactly four new history entries as well as its previous checks.

The stale-Undo test was blocked by the centered fixed storage-conflict alert's `Load latest saved workspace` button intercepting the Undo pointer target. Notices now stay within the fixed details area or active modal, and the collapsed mobile panel identifies the conflict and exposes its resolution when expanded. The original stale-Undo test was not changed. A new desktop/mobile case verifies notice bounds, reachable controls and preserved canvas space. All 14 focused storage/mode cases passed in 1.7 minutes, without retries.

The final 70-case run includes these three new cases and keeps the existing state and collision assertions. See [BASELINE_REGRESSIONS.md](BASELINE_REGRESSIONS.md) for the trace findings and before/after evidence.

An initial parallel spatial run was interrupted because UI and spatial runners shared Playwright's temporary report directory, producing `browserContext.close ENOENT` for a trace file. The isolated spatial rerun passed all 15 cases. This runner-artifact collision is recorded separately from application assertions. Parallel runners must use separate ports, `--output` and `PLAYWRIGHT_HTML_OUTPUT_DIR`.

## Behaviors covered by the implementation and checkpoint tests

- **View/Edit:** separate desktop scene/detail columns, a summary without a selection, fixed device/scene inspectors, no editing labels over the pointer, in-panel deletion, and a collapsible mobile detail area. Incomplete text/numeric drafts survive mode changes. Storage and action notices stay in the details area or active modal; mobile conflict resolution remains reachable.
- **Recorded relationships:** independent ON/OFF, Bluetooth records, counterpart emphasis, both recorded port labels and provenance. Actual pointer movement updates renderer endpoints before the single persisted command.
- **Collision and support:** ordinary solids and fast swept path tests remain; mats use actual horizontal geometry, and desk attachments move/cancel/undo together.
- **Hardware lifecycle:** no read before consent, per-tab sessions, start/stop, stale/unavailable/denied states, incomplete native snapshot rejection, stable versus session identity and explicit matching. Fixture tests cannot validate real native permission behavior.
- **Data protection:** approval before matching or adding, no name-based automatic merge, preserved manual evidence, normal Undo/Redo and stale-tab save rejection. Portable import/export drops local bindings while preserving approved labels and provenance. Model context additionally excludes OS-derived records, incident links and stored history.
- **Existing flows:** photo selection and separate transmission consent, preview review/approval, manual devices/connections, legacy v1/v2 reading and user-confirmed monitor troubleshooting retain their existing implementations. Input commits preserve accepted values across asynchronous saves and React publication. The final 70-case integration run exercises these combined behaviors.

## Reproduce locally

```bash
npm ci
npx playwright install chromium
MODEL_API_KEY='' npm run check
DESKTWIN_TEST_PORT=5187 DESKTWIN_TEST_API_PORT=4337 npm run test:e2e
MODEL_API_KEY='' npm run test:production
npm run format:check
git diff --check
```

This work used `DESKTWIN_CHROMIUM_EXECUTABLE=/tmp/desktwin-browser/runtime/chromium`. Omit that override with the normal Playwright browser. Test servers own their ports, bind to loopback and explicitly blank the Meta key. Do not reuse or stop another checkout's server. For concurrent test processes, put report directories outside each other's `--output` tree.

Mac-only validation requires macOS 12 or later and Xcode Command Line Tools:

```bash
npm ci
# Run only if Command Line Tools are missing:
xcode-select --install
npm run hardware:build
MODEL_API_KEY='' npm run dev
```

Open `http://127.0.0.1:5173`, choose **Open Mac hardware**, review the local metadata notice, check consent and press **Start detection**. Complete the display/USB hot-plug, stable/unstable identity, bridge interruption and privacy checklist in [MACOS_HARDWARE.md](MACOS_HARDWARE.md). Record the actual Mac model/OS/architecture and results without serial numbers. Do not label that checklist completed from fixture tests.

## Review images and remaining limits

The final test-run captures are copied into `docs/screenshots` and reviewed separately from native hardware validation:

- `workspace-overview-desktop.png`: the new fixed overview beside the sample voxel desk, with detection stopped. This is the README image; the sample devices are not actual OS observations.
- `workspace-edit-desktop.png` and `workspace-edit-mobile.png`: fixed editing controls and the collapsible narrow-screen layout.
- `hardware-overview-fixture.png`: a fixture-driven hardware overview used to inspect UI/source/status presentation. **Its device observations are synthetic test fixtures, not detections from a Mac.**
- `hardware-unavailable-linux.png`: the actual unsupported-platform response from the Linux bridge. It demonstrates truthful unavailable/stopped handling; it does not validate native macOS enumeration.

These five captures have been copied and visually reviewed. The desktop and mobile editing images use the mode tests' sample input values. Desktop and collapsed/expanded mobile storage-notice captures were also inspected during the focused regression, and the final notice case passed again in the 70-case suite. Earlier connection/spatial images retained below document the prior release. No fixture screenshot establishes physical hardware recognition.

Remaining product boundaries: polling can miss a short reconnect; serial-less identity needs review; OS recognition does not verify function; physical HDMI routing and display-to-dock parentage are unknown; Bluetooth detection is unavailable. Geometry is approximate scene-coordinate editing with conservative collision checks, not measured reconstruction or a gravity/balance simulation. Safari, Firefox, physical touch and the user's Mac have not been verified in this Linux session.

---

# Historical validation retained for reference

The following is the prior 2026-10-28 release record, preserved verbatim apart from heading depth. Its counts, screenshots, paths and limitations describe that earlier snapshot. They must not be presented as results of the current branch or substituted for the current checks above.

## Validation record - scene editing and connections, 2026-10-28 KST

### Repository state and preserved work

The private repository was accessed with authenticated read/write permission. `AGENTS.md` was read before implementation. Both `main` and `feat/spatial-scene-editing` pointed to `13b55f7c261d73e3d0b5b3a9448613fe176651dd` at the initial check and the later recheck. The previous photo editor PR was already merged; the spatial branch had no PR or additional remote commits.

An unfinished local spatial-editor worktree was found with staged, unstaged and untracked files, and an existing development server. It was preserved in place. Its Git index was not treated as the remote baseline. A separate checkout was reconstructed from the exact authenticated main tree and commit, then the recovered working files were copied and reviewed. This work uses `feat/scene-connections-editing-20261028` and separate development/test ports. No reset, force push, original-worktree deletion, main merge, public deployment, or repository visibility change was performed.

Code was published in separate fast-forward commits:

| Commit    | Scope                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `3abcbad` | Shared voxel geometry, collision/support rules, attachments, legacy migration, photo placement/matching and compact API context        |
| `8efe314` | Recovered direct scene/shape editing, transactional browser persistence, committed inputs, isolated test servers and regression suites |
| `41b9ce8` | Independent connection visibility, device/counterpart emphasis, recorded port/source details and real connection drag tests            |
| `d8f8c20` | Explicit ambiguous photo record choices, stale photo preview and exact decimal-entry regression coverage                               |

Each feature snapshot passed `npm run check` before it was committed. UI changes were also exercised in Chromium. Documentation and review images are committed separately after the complete checks below.

### Environment and API boundary

Checks ran in a Linux workspace with Node.js 24.22.1, the unchanged locked npm dependencies, Playwright 1.64.1, and an already-available isolated Chromium 153.0.8010.0 executable. Browser rendering used software WebGL through the existing `DESKTWIN_CHROMIUM_EXECUTABLE` override. No production browser dependency was added.

Application/test servers had an explicitly empty `MODEL_API_KEY`. Unit/API provider transports were mocked. Browser photo responses used fixtures and synthetic image data. **No live Meta request was made, no paid API credit was spent by these checks, and no real desk photo was analyzed.** API keys remain server-only; photo selection and unsaved edits retain their separate transmission-consent boundary.

The connected/cloud browser could not reach this workspace's loopback server, so direct interaction was verified through the repository's real local Chromium E2E runner. Those tests send actual mouse down/move/up events to the WebGL canvas; they do not call an application move function in place of dragging. Initial sandboxed API/browser startup attempts were blocked by local socket/IPC restrictions. The same isolated commands passed with the execution environment's approved local-server access.

### Completed checks

| Check                                                   | Result                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                         | Passed: strict TypeScript, all unit/API tests and production build                                                      |
| Unit and HTTP/API tests                                 | **109 passed**, 8 files                                                                                                 |
| Full `npm run test:e2e`                                 | **50 passed**, 7 files, 5.4 minutes                                                                                     |
| Recovered editing/storage focused browser suite         | **21 passed** before its integration commit                                                                             |
| Connection focused browser suite                        | **4 passed** initially; the final suite also passed the new attached-desk/connection drag case                          |
| Photo matching/approval focused browser suite           | **3 passed**                                                                                                            |
| `npm run test:production`                               | Passed: real WebGL, UI interaction, CSP, invalid API input rejection and missing-asset response; no page runtime errors |
| `npm run format:check`                                  | Passed                                                                                                                  |
| `git diff --check`                                      | Passed                                                                                                                  |
| Live Meta authentication/model availability/recognition | **Not run**                                                                                                             |

Hosted GitHub Actions results are reported separately in the PR. Local results above do not establish hosted CI success.

The complete browser suite contains:

| File                         | Cases | Principal coverage                                                                                                                                                                                              |
| ---------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/connections.spec.ts`  |     5 | Toggle in all main modes, Bluetooth, preserved records, reversed endpoint ports, counterpart emphasis, furniture selection, device drag and attached-desk drag with live endpoints, mobile toggle               |
| `tests/inputs.spec.ts`       |     1 | Spaces, incomplete numeric text, invalid input, Escape, queued commits, exact `0.` then `5` entry saved as `0.5` after reload                                                                                   |
| `tests/queued-edits.spec.ts` |     1 | Different queued axes/colors/parts survive; stale structural shape replacement is rejected                                                                                                                      |
| `tests/scene.spec.ts`        |    10 | Consent, isolated preview, record matching, required ambiguous choice, atomic approval, existing reports/links, v1 JSON, import/export, hostile/late/canceled responses, narrow layout                          |
| `tests/spatial.spec.ts`      |    11 | Thin-obstacle and curved real drags, attached desk movement/cancel, surface/detach, rotation and scale collision, custom shapes, color/range input races                                                        |
| `tests/storage.spec.ts`      |     9 | Actual two-tab saves and Web Locks, open photo preview versus newer tab save, stale Undo, invalid external data, unsupported-lock rejection, quota failure, queued replacement, truthful dialog/diagnosis saves |
| `tests/workspace.spec.ts`    |    13 | Existing device/connection/chat/diagnosis flows, legacy display names, mobile, privacy/consent, import/export and Undo                                                                                          |

### Material behaviors verified

#### Connection display

The independent switch shows or hides recorded relationship lines without writing storage or deleting records. Edit mode remains draggable with lines on. Device selection emphasizes incident lines and counterpart geometry while keeping unrelated lines visible. Selecting furniture retains all lines. Endpoint details display both entered ports and the connection's source, in the correct direction for the selected device.

Actual mouse drags change rendered line endpoints before pointer release while the saved workspace remains unchanged. Pointer release creates one saved action. Dragging a desk moves its attached device and line endpoint together; the opposite stationary endpoint stays fixed. One Undo/Redo restores the whole moved group and preserves connection records.

#### Collision, surface contact and shape editing

Renderer and solver share the same box parts. Tests cover swept translation through thin obstacles, rotation/scale sweeps, empty space under desks, rotated-box empty corners, ordinary surface contact, and movement out of existing imported overlaps. Invalid numeric transforms keep the saved state. Pointer cancellation restores the initial transforms without saving.

A reproduced contact defect was fixed: reducing a resting monitor's height scale to `0.5` no longer lowers its offset feet into the desk. Supported dimension edits retain the actual bottom and a small existing support gap. Explicit height/part-position changes remain deliberate, collision-checked edits. Template conversion and bounded custom parts survive JSON round trips without changing device operation reports.

#### Four reported regressions

- **Photo approval overwriting another tab:** a real preview in tab B becomes stale after tab A saves through Settings; approval is disabled, the exact newer save remains, and explicit reload keeps the original user connection ports/notes.
- **Photo duplicates when sample devices have user links:** those sample IDs remain eligible for matching. When a differently named candidate omits its ID and may duplicate an existing same-kind record, approval requires an explicit existing-record or separate-new-device choice. Choosing an existing record retains its identity, status and all connections.
- **v1 device/decor ID collisions:** migration keeps user device IDs and connection endpoints; only generated decor IDs receive unique suffixes. Migration is read-only until an explicit save.
- **Spaces and decimal entry:** local input drafts accept internal/trailing spaces and intermediate `0.`; Enter/blur validates and commits once. The browser test explicitly types `0.` followed by `5`, reloads, and checks `0.5`, not `1.5`.

### Reproduce

Install the locked dependencies and a normal Playwright Chromium, then run:

```bash
npm ci
npx playwright install chromium
MODEL_API_KEY='' npm run check
DESKTWIN_TEST_PORT=5187 DESKTWIN_TEST_API_PORT=4337 npm run test:e2e
MODEL_API_KEY='' npm run test:production
npm run format:check
git diff --check
```

This environment additionally set `DESKTWIN_CHROMIUM_EXECUTABLE=/tmp/desktwin-headless/chromium`. It can be omitted with a normal Playwright installation. `test:e2e` owns a blank-key server and refuses to reuse another developer's server. The optional test ports let it coexist with an existing checkout. The production smoke test allocates its own fresh port and also empties the key.

### Review images

The current connection screenshots were captured during the passing browser tests and visually inspected:

- `screenshots/connections-overview-desktop.png`: the full voxel workspace, selected dock, emphasized counterparts and both recorded port values.
- `screenshots/connections-inspector-mobile.png`: reachable ON/OFF switch while the mobile placement inspector is open at 390 x 844.
- `screenshots/connections-drag-desktop.png`: actual drag fixture with two custom devices and a relationship line.

The recovered `spatial-editor-desktop.png` and `spatial-editor-mobile.png` images document the earlier spatial-editing checkpoint before the independent switch. They show attachment and box editing and are labelled accordingly in `SCENE_EDITOR.md`. No screenshot is evidence of live hardware status or live Meta recognition.

### Remaining limits and unverified integrations

- Geometry is an editable approximation in scene units. Whole-object rotation is yaw; individual box parts support XYZ rotation. This is not measured photo-to-mesh reconstruction.
- Surface placement supports the floor and desks. A desk uses its largest flat box as a support surface; unusual multilevel shapes may require manual adjustment. Attachments are one level and gravity/balance are not simulated.
- Collision checks cover editable objects and the floor. Fixed wall/window meshes remain illustrative. Numeric sweeps are conservative and may reject a very tight maneuver. Existing saved overlaps are not silently repaired on load.
- Safe writes require Web Locks on HTTPS or localhost. Tabs running this version coordinate with each other; legacy scripts that bypass the lock are outside that protocol. Unsupported browsers can still export but cannot write unsafely.
- Connection lines visualize records, not detected electrical connectivity or physical routing. Multiple parallel connections between one device pair are not supported by the existing graph model. Toggle state is view-only and resets on reload.
- The default Playwright-managed Chromium, Safari, Firefox, physical mobile touch, low-end GPU performance and exhaustive accessibility/security audits were not validated here.
- Real Meta authentication, strict-output compatibility, latency, billing and photo quality remain unverified. Passing mock tests does not prove a live integration works. Browser cancellation cannot retract an already-transmitted image or guarantee upstream cancellation.
