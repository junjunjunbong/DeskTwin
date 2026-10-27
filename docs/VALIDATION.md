# Validation record - scene editing and connections, 2026-10-28 KST

## Repository state and preserved work

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

## Environment and API boundary

Checks ran in a Linux workspace with Node.js 24.22.1, the unchanged locked npm dependencies, Playwright 1.64.1, and an already-available isolated Chromium 153.0.8010.0 executable. Browser rendering used software WebGL through the existing `DESKTWIN_CHROMIUM_EXECUTABLE` override. No production browser dependency was added.

Application/test servers had an explicitly empty `MODEL_API_KEY`. Unit/API provider transports were mocked. Browser photo responses used fixtures and synthetic image data. **No live Meta request was made, no paid API credit was spent by these checks, and no real desk photo was analyzed.** API keys remain server-only; photo selection and unsaved edits retain their separate transmission-consent boundary.

The connected/cloud browser could not reach this workspace's loopback server, so direct interaction was verified through the repository's real local Chromium E2E runner. Those tests send actual mouse down/move/up events to the WebGL canvas; they do not call an application move function in place of dragging. Initial sandboxed API/browser startup attempts were blocked by local socket/IPC restrictions. The same isolated commands passed with the execution environment's approved local-server access.

## Completed checks

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

## Material behaviors verified

### Connection display

The independent switch shows or hides recorded relationship lines without writing storage or deleting records. Edit mode remains draggable with lines on. Device selection emphasizes incident lines and counterpart geometry while keeping unrelated lines visible. Selecting furniture retains all lines. Endpoint details display both entered ports and the connection's source, in the correct direction for the selected device.

Actual mouse drags change rendered line endpoints before pointer release while the saved workspace remains unchanged. Pointer release creates one saved action. Dragging a desk moves its attached device and line endpoint together; the opposite stationary endpoint stays fixed. One Undo/Redo restores the whole moved group and preserves connection records.

### Collision, surface contact and shape editing

Renderer and solver share the same box parts. Tests cover swept translation through thin obstacles, rotation/scale sweeps, empty space under desks, rotated-box empty corners, ordinary surface contact, and movement out of existing imported overlaps. Invalid numeric transforms keep the saved state. Pointer cancellation restores the initial transforms without saving.

A reproduced contact defect was fixed: reducing a resting monitor's height scale to `0.5` no longer lowers its offset feet into the desk. Supported dimension edits retain the actual bottom and a small existing support gap. Explicit height/part-position changes remain deliberate, collision-checked edits. Template conversion and bounded custom parts survive JSON round trips without changing device operation reports.

### Four reported regressions

- **Photo approval overwriting another tab:** a real preview in tab B becomes stale after tab A saves through Settings; approval is disabled, the exact newer save remains, and explicit reload keeps the original user connection ports/notes.
- **Photo duplicates when sample devices have user links:** those sample IDs remain eligible for matching. When a differently named candidate omits its ID and may duplicate an existing same-kind record, approval requires an explicit existing-record or separate-new-device choice. Choosing an existing record retains its identity, status and all connections.
- **v1 device/decor ID collisions:** migration keeps user device IDs and connection endpoints; only generated decor IDs receive unique suffixes. Migration is read-only until an explicit save.
- **Spaces and decimal entry:** local input drafts accept internal/trailing spaces and intermediate `0.`; Enter/blur validates and commits once. The browser test explicitly types `0.` followed by `5`, reloads, and checks `0.5`, not `1.5`.

## Reproduce

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

## Review images

The current connection screenshots were captured during the passing browser tests and visually inspected:

- `screenshots/connections-overview-desktop.png`: the full voxel workspace, selected dock, emphasized counterparts and both recorded port values.
- `screenshots/connections-inspector-mobile.png`: reachable ON/OFF switch while the mobile placement inspector is open at 390 x 844.
- `screenshots/connections-drag-desktop.png`: actual drag fixture with two custom devices and a relationship line.

The recovered `spatial-editor-desktop.png` and `spatial-editor-mobile.png` images document the earlier spatial-editing checkpoint before the independent switch. They show attachment and box editing and are labelled accordingly in `SCENE_EDITOR.md`. No screenshot is evidence of live hardware status or live Meta recognition.

## Remaining limits and unverified integrations

- Geometry is an editable approximation in scene units. Whole-object rotation is yaw; individual box parts support XYZ rotation. This is not measured photo-to-mesh reconstruction.
- Surface placement supports the floor and desks. A desk uses its largest flat box as a support surface; unusual multilevel shapes may require manual adjustment. Attachments are one level and gravity/balance are not simulated.
- Collision checks cover editable objects and the floor. Fixed wall/window meshes remain illustrative. Numeric sweeps are conservative and may reject a very tight maneuver. Existing saved overlaps are not silently repaired on load.
- Safe writes require Web Locks on HTTPS or localhost. Tabs running this version coordinate with each other; legacy scripts that bypass the lock are outside that protocol. Unsupported browsers can still export but cannot write unsafely.
- Connection lines visualize records, not detected electrical connectivity or physical routing. Multiple parallel connections between one device pair are not supported by the existing graph model. Toggle state is view-only and resets on reload.
- The default Playwright-managed Chromium, Safari, Firefox, physical mobile touch, low-end GPU performance and exhaustive accessibility/security audits were not validated here.
- Real Meta authentication, strict-output compatibility, latency, billing and photo quality remain unverified. Passing mock tests does not prove a live integration works. Browser cancellation cannot retract an already-transmitted image or guarantee upstream cancellation.
