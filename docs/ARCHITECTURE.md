# Architecture

## Guided setup and recorded checks

`DeskSetupPanel` combines device evidence review, optional consented Mac matching, targeted connection questions, exact replacement review, and monitor handoff. `deskSetup.ts` only suggests a connection from a clear two-device report; missing or ambiguous information remains a question. Photo descriptions carry into setup in memory after scene approval, never as automatically confirmed topology.

`diagnosis.ts` derives a bounded monitor-to-computer route from recorded connections and builds a deterministic check plan. It records route confirmation, distinct failed/skipped answers, and user-confirmed compatibility before a dock-bypass test. The workspace stores up to 30 schema-validated sessions. Queued saves preserve earlier answers and reject route changes; recording a working status is a separate guarded user-confirmed command.

`useAssistant` retains an explicit conversation target. The server validates it and derives eligible check summaries from privacy-filtered current state. OS-only targets are blocked locally; generated prompts never interpolate hardware names. Pending requests are invalidated on import/reset/reload. `connectionView.ts` and `DeskCanvas.focusPath` highlight only explicitly named existing path devices/edges, while the connection visibility toggle remains independent. Automated checks use local rules and injected transports; the separately authorized live conversation smoke test is recorded in [PHOTO_REVIEW.md](PHOTO_REVIEW.md).

React owns the validated workspace and contextual controls. Three.js renders that workspace. Model responses and browser interactions never become an independent source of device facts.

## View, Edit and the fixed inspector

The main interface has two modes: **View** for inspecting records and **Edit** for placement and shape controls. Internal renderer mode names remain implementation details. A desktop grid gives the scene and the right detail dock separate space. A narrow viewport places the dock below the scene with an explicit collapse/expand control.

Without a selection, `WorkspaceOverview` shows counts, user reports, devices needing attention and an independent OS-recognition summary. Selecting a device opens `DeviceInspector` in the same dock. Selecting furniture opens `SceneObjectInspector`. Other existing panels reuse the dock rather than covering the desk. Add-device/photo review dialogs retain their explicit confirmation flows; device/object deletion is confirmed inside the inspector.

The selected inspector stays mounted through View/Edit switches. Its local name/model and numeric drafts survive a mode switch; the hidden editor is not saved just because the view changes. Save actions await the storage transaction and pending forms stay disabled until it finishes. In Edit, scene labels are hidden so clicking or dragging does not raise a popup over the pointer. The geometry, camera and saved workspace are unchanged by mode switches.

## Connection views

`showConnections` is transient React state, separate from View/Edit and the persisted workspace. The header switch changes visibility only. The **View connections** action enables the switch; ordinary mode changes preserve it. `connectionView.ts` derives visible edges and selection emphasis from the recorded graph. It does not infer edges or modify operating status.

With visibility on, every recorded edge remains present, including Bluetooth and Unknown connector types. Selecting a device emphasizes incident edges and counterpart objects while muting other edges. A selected furniture or prop ID does not filter the device graph. Hiding lines retains the graph and counterpart selection information.

The renderer draws dashed relationship arcs between geometry anchors. Anchors are illustrative centers, not measured physical ports. Every live spatial preview updates object transforms, relationship endpoints and counterpart outlines together. Connection geometry belongs to its own group and is excluded from object picking. A screen-reader list describes the lines that the renderer actually emitted, including their current emphasis; its endpoint metadata permits checking that unsaved drag frames track the moving geometry.

The selected-device inspector uses the saved graph to show counterpart names, connectors, both entered ports, source and notes. It maps ports according to the selected endpoint. These displays never establish live connectivity, successful operation or physical cable routes. Connection visibility is neither a persisted preference nor an Undo action.

## Shared geometry and placement

`src/domain/geometry.ts` is a pure procedural catalog of voxel boxes. The renderer, collision solver and template-to-parts editor consume the same records, including per-part rotations. Decorative screen planes and point lights remain application-owned template decoration.

`src/domain/spatial.ts` transforms boxes into world-space parallelepipeds. Broad bounds reject distant pairs; separating-axis checks test the actual part volumes. Continuous swept checks stop translation through thin obstacles. Rotation and scale use conservative bounds over small segments, including attached objects orbiting a desk pivot. Parts inside one object may overlap by design. Saved overlaps can escape without deepening or creating contacts.

A live pointer drag applies the pure solver to every segment and renders only valid candidates. It records at most 512 safe waypoints. Release emits one command, which revalidates the path against current state and creates one history/Undo entry. A curved path is not replaced by a straight shortcut. Cancel, capture loss, workspace change or mode change restores the entire group. A rejected save never leaves an unsaved drag result displayed.

Desk attachment stores a parent ID alongside world placement. A desk transform computes its children's new offsets/yaw and support contact, retaining their own size. Child edits remain independent within the desk footprint. Explicit detach keeps world placement; deleting a desk detaches children without deleting them. Only desks can be parents, and desks cannot themselves attach.

Surface placement uses the actual object bottom and the largest flat desk box, or floor height zero. Nearby automatic snapping preserves the current level. An explicit surface action may relocate vertically, but validates its final shape. This is not a gravity or balance simulation. Fixed wall/window scenery is not an editable collider.

Thin horizontal mats are additional support layers. The solver uses each mat part's projected footprint and height, rather than treating empty corners of a rotated bounding box as a surface. A horizontal drag over a nearby covering may lift, translate and settle. All three segments use the normal swept solid checks; the returned waypoints are replayed on save. Thick or tilted mats remain solid obstacles. An overhead obstacle can block the lift. Explicit floor/desk placement also considers a thin covering on that surface. This fixes the default keyboard, mouse, SSD and chair becoming stuck without rewriting their initial positions.

Dimension and template edits can preserve an existing resting contact. Before collision validation, the solver compares the old and new geometry bottoms and adjusts the object origin to retain the previous bottom and small support gap. This correction applies only when the old object rests on an eligible surface, no explicit height change was requested, and the new origin remains within saved position bounds. Part size/rotation edits use it when they do not also change part position. Intentional floating height and explicit placement edits remain under user control. Other objects are still collision-checked; preserving contact does not authorize intersection with them.

## Commands, transactions and storage

`workspace.ts` remains the schema and command boundary. Placement, scale and custom shape changes call the spatial solver. Invalid edits reject the whole command, including attached children. New objects use bounded free placement. Names, appearance, reported connections and operating-state edits retain their separate semantics.

`useWorkspace.ts` serializes all saves through a per-origin Web Lock. Inside the lock it compares the latest raw localStorage document with the tab's expected document, computes and validates the next state, writes, then updates React state and Undo/Redo. Failed writes preserve the prior saved state and history. A stale tab keeps its own view and exposes explicit reload/export controls. Prepared replacements check their rendered or supplied baseline again after queued same-tab operations. If Web Locks are unavailable, writes fail with an explicit message rather than falling back to an unprotected write; export remains available. The protocol coordinates current application tabs on HTTPS or localhost, not legacy clients or unrelated scripts. See `STORAGE.md`.

`queuedCommand.ts` merges explicit position, scale, color and part-field edits into the latest same-tab state. Whole-array shape replacements and drag paths prepared against an intervening change are rejected for review. Text/decimal inputs retain incomplete drafts, and range inputs retain the latest gesture while a save waits for its lock. DOM range-step and color normalization do not round the saved model or generate extra stale writes.

The storage key is still `desktwin.workspace.v1`; the document schema remains version 2. The value is plain workspace JSON without a revision envelope. Optional additions include `attachment`, `shapeMode`, device `parts`, box `rotation`, local `hardwareBinding` and durable `hardwareOrigin` provenance. Portable export/import uses this format but deliberately removes installation-specific hardware bindings. Imported OS provenance is retained/normalized, so renaming or unlinking an OS-derived device cannot silently opt its data into model transfer. Old v1/v2 documents retain their meaning. v1 migration permits legacy presentation keys and the scene coordinate range used by old dragging, preserves IDs and reports, and renames only generated furniture IDs on a collision. Loading/migration does not write storage. Older applications need not understand these new optional fields.

Undo stores 20 snapshots in memory. Saved change history contains at most 100 events. Reloading another tab's version clears local Undo/Redo, preventing stale history from restoring over newer data. JSON export retains the approved scene, device names/models and provenance, but no hardware binding, live observation, photo bytes, chat transcript or API key. Imports require explicit fresh OS matching.

## Read-only macOS hardware bridge

`native/HardwareProbe.swift` uses CoreGraphics/AppKit for online displays and IOKit for registered USB devices. It emits a bounded metadata snapshot; Bluetooth is explicitly unavailable. The fixed executable is built by `npm run hardware:build` and invoked by `server/hardware.ts`. Neither HTTP inputs nor model/workspace data can select an executable, command, native argument or code to run.

The bridge shares the existing loopback-only API. Hardware endpoints require exact local origin/host checks, a custom header, and a per-tab unpredictable token for start/stop/snapshot operations. A capability check does not scan hardware. Start requires explicit local metadata consent. Browser polling runs about every five seconds while enabled, and a 20-second idle lease requires another explicit start. Stop revokes that capability's ability to start; late responses and reordered starts cannot silently re-enable detection. There is no system settings change, screenshot, keystroke collection or hardware control.

Native snapshots and tokens stay outside the persisted workspace. Category failures, permission denial, stale/unavailable bridge and stopped detection are unknown presence, not disconnection. `hardwareState.ts` permits **Not detected** only after the relevant category succeeds for a missing approved persistent identity in the same installation scope. Serial-less session identities require matching again after removal, a failed category, or a new session. Native reads reject incomplete/invalidated enumeration, rather than turning a partial list into false absence.

Names never merge observations. A unique usable serial plus vendor/model context is HMACed inside the native process using a local installation key. Raw serials do not leave the helper. Duplicate/sentinel/placeholder identifiers fall back to session identity. OS USB parent relations are shown with an IOKit source and never inserted into the user's recorded cable graph. Display-to-dock routing is not inferred.

`HardwarePanel` requires an explicit existing-record or separate-new-record choice, then review and approval. `hardwareMatchCommand` rechecks that the observation is current, prevents duplicate bindings and issues an ordinary workspace command. Existing record content is preserved; a new OS-derived record has unknown user-reported status and a user-chosen template/free placement. Match removal has an in-panel confirmation and uses the same Undo/Redo and stale-tab protections as other edits.

## Hardware privacy and model context

`workspacePrivacy.ts` has two separate projections. `portableWorkspace()` removes `hardwareBinding` but preserves approved record labels and `hardwareOrigin`. `modelWorkspace()` also removes OS-derived devices/objects, incident connections and dangling attachments; it clears change history that might contain an earlier OS-derived name. Both browser and server paths apply the model projection. The chat client includes only prior Meta-mode conversation entries; local-demo responses may name hardware and are not forwarded automatically.

A record created from an OS observation keeps `hardwareOrigin: 'macos'` after a rename or unlink. Existing manually created records merely linked to an observation remain manual records; only their saved manual information enters existing Meta consent flows. Observations and bindings never do. There is no hardware-to-model sharing option in this implementation. A user-written message/photo description is still intentional input under its separate transmission consent.

See [MACOS_HARDWARE.md](MACOS_HARDWARE.md) for the precise API fields, endpoints, macOS build instructions and required physical-device validation. Real macOS compilation and hot-plug behavior remain unverified in this Linux environment.

## Photo proposals and identity

Photo selection and preprocessing are local. `photoInput.ts` tries native decoding, with a lazy `photoDecode.worker.ts` pure-JavaScript fallback for HEIC/HEIF. The worker decodes only a bounded primary image and is terminated by its caller. Production CSP permits same-origin workers without allowing script evaluation or a remote conversion service. Separate consent and an explicit send action permit sending the resized image, privacy-filtered setup records and optional description through the local API. The provider context summarizes custom geometry as counts and scene dimensions rather than sending all box arrays. The server key stays in the environment and the outbound authorization header.

`sceneProposal.ts` accepts a strict visual-only schema. A response selects known templates or supplies at most 32 bounded boxes per object, with optional nullable support references and normalized image regions; arbitrary code, URLs, shaders, connections and operating-state fields are rejected. The provider may not describe more than 32 objects. Dedicated accessory templates and computed template dimensions help keep separately editable physical items out of descriptive notes alone.

Draft creation retains existing user evidence, matches compatible existing device IDs or conservative stable-ID/unique-name candidates, and fits supports before supported candidates. The review fitter preserves horizontal arrangement rather than silently searching for a different floor position. Unresolved supports and collisions become actionable preview issues. A sample device referenced by a user connection is retained and is eligible for matching. Matching is visible and reversible in the preview. Existing devices preserve identity, model, reported status and cable endpoints. New photo devices start with unknown operating status. Repeated matching names/IDs reuse existing props.

If a new device candidate has no reliable match but a same-type retained device exists, its observation carries `needsRecordChoice`. The review dialog keeps approval disabled until the user chooses an existing record or explicitly keeps a separate new device. Matching decisions are preview metadata rather than additional hardware claims. The review does not silently resolve ambiguous identity from a photo.

`sceneReview.ts` manages reversible inclusion, manual additions and rebindings. Excluding a matched observation restores its saved record. Reference-image regions and inclusion state live outside the saved workspace. The preview uses shared commands and geometry checks, but its temporary edits do not write storage or saved history. Approval passes review metadata through ScenePreview, PhotoPanel and App for domain validation of included candidates, unresolved matching and supports. It also verifies the original base, protected reports/connections and new/worsened collisions, then commits one snapshot. Cross-tab or queued same-tab changes can reject approval; failures keep the review open.

## Evidence model

Device identity, visual appearance, reported cable topology and operating state are separate claims. No field means independently verified hardware operation. Manual geometric edits mark visual provenance as user-reported, not device operation as verified. Attaching an object to a desk does not create a cable edge. Photo connection descriptions guide visual identification but do not automatically become saved topology.

A connection is one undirected edge per device pair. Multiple parallel cables between the same devices remain unsupported. USB-C records a connector, not negotiated speed, video capability or successful operation. The server has no workspace database or hardware actuation. Its optional native helper has read-only OS metadata access after consent. OS recognition and USB hierarchy remain separate from this recorded connection graph.

## Main files

| File                                   | Responsibility                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `src/domain/workspace.ts`              | Schema, migration, immutable commands, evidence and sample data               |
| `src/domain/hardware.ts`               | Validated observation, category, session and binding contracts                |
| `src/domain/hardwareState.ts`          | Presence semantics and explicit observation-to-record commands                |
| `src/domain/useHardware.ts`            | Opt-in polling, stop/cancel handling and bridge state                         |
| `src/domain/workspacePrivacy.ts`       | Distinct portable export and model-context privacy projections                |
| `src/components/WorkspaceOverview.tsx` | Device, connection, user-report and OS-recognition summaries                  |
| `src/components/HardwarePanel.tsx`     | Local consent, sources, observed hierarchy and reviewed matching              |
| `server/hardware.ts`                   | Per-tab capabilities, bounded probe calls and reliable identity lifecycle     |
| `native/HardwareProbe.swift`           | Actual read-only CoreGraphics/AppKit and IOKit metadata queries               |
| `src/domain/connectionView.ts`         | Recorded-edge visibility and selected-device/counterpart emphasis             |
| `src/domain/geometry.ts`               | Shared template/custom box geometry                                           |
| `src/domain/spatial.ts`                | Collision sweeps, support surfaces, attachment transforms, proposal placement |
| `src/domain/sceneProposal.ts`          | Strict photo schema, matching, isolated draft and approval validation         |
| `src/domain/useWorkspace.ts`           | Locked browser persistence, stale-write checks and Undo/Redo                  |
| `src/domain/queuedCommand.ts`          | Granular queued edits and stale structural/drag rejection                     |
| `src/scene/deskScene.ts`               | Three renderer, ray picking, constrained live drag and relationship arcs      |
| `src/components/DeskCanvas.tsx`        | React scene lifecycle, counterpart markers and accessible connection summary  |
| `src/components/DeviceInspector.tsx`   | Device reports, editable geometry and recorded endpoint details               |
| `src/components/PlacementControls.tsx` | Explicit surface and attachment actions                                       |
| `src/components/ShapeEditor.tsx`       | Template conversion/restoration and part edits                                |
| `src/components/TransformEditor.tsx`   | Placement/scale/color and selected part controls                              |
| `src/components/CommitInput.tsx`       | Local text/decimal drafts and deliberate commits                              |
| `src/components/RangeInput.tsx`        | Local slider draft and accepted-value restoration after asynchronous saving   |
| `src/components/ScenePreview.tsx`      | Unsaved review, record selection and approval/discard                         |
| `src/components/PhotoPanel.tsx`        | Image processing, separate consent and cancelable requests                    |
| `server/meta.ts`                       | Server-only bounded provider transport and semantic response validation       |
| `server/app.ts`                        | Loopback API, origin checks, request bounds and production static serving     |

## Development and browser-test servers

Development defaults to the UI at `127.0.0.1:5173` and the API at `127.0.0.1:4318`. `DESKTWIN_WEB_PORT` changes the Vite port, and `PORT` changes both the API listen port and Vite's API proxy target. Vite uses `strictPort`, so it does not silently switch to another port when the requested one is occupied.

Playwright starts and owns its development server with `MODEL_API_KEY` explicitly blank. It sets `reuseExistingServer: false`; an unrelated developer server cannot be silently reused with an unknown API key. `DESKTWIN_TEST_PORT` and `DESKTWIN_TEST_API_PORT` select the test UI/API ports and are passed to the child server as `DESKTWIN_WEB_PORT` and `PORT`. Their defaults remain 5173/4318. Set both when another checkout is running. The production smoke test likewise starts its own blank-key process on a separate reserved port. Provider responses in tests are mocked; these checks do not validate a live Meta account.

GitHub Actions additionally defines a `native-compile` job on `macos-15`. It compiles the fixed Swift source against the hosted macOS SDK without starting detection. A successful SDK build would not establish correct recognition on the user's Mac. Hosted job outcomes, including scheduling failures, belong in the validation record separately from local checks.

## Automatic photo-view fitting

`photoProjection.ts` estimates a separate source camera from reliable model-proposed reference corners or, without them, from at least four spread object regions and current template geometry. The latter is approximate view inference, not calibrated camera recovery. `photoFitting.ts` uses complete outlines, conservative partial-region coverage and visible contact anchors to refine an in-memory layout under seed-relative bounds and independent contact/SAT checks. The normal orthographic hero camera is unchanged.

`PhotoAlignmentPanel` attempts matching once after the local source image loads. Its product flow has no coordinate, corner-marking, calibration-object or field-of-view inputs. Comparison and retry are local; undo is not automatically re-applied. Regions, camera estimates and stable per-proposal fit snapshots stay in review metadata. `sceneReview.ts` protects later locks and saved-record identity through undo, exclusion and rebinding. Model semantic validation does not run the costly search. See [implementation and verification](PHOTO_REFERENCE_FITTING.md).

## Bounds and unverified integrations

Saved scenes contain up to 40 devices, 60 other objects, 128 boxes per custom shape, and 100 connections/history entries. HTTP request bodies are bounded at 8 MB. Photo input accepts PNG/JPEG/WebP/HEIC/HEIF up to 8 MiB, re-encoded locally to JPEG with a longest side of 1280 pixels. User description and chat input allow 2,000 characters. Provider output limits remain 4,096 chat / 12,000 photo tokens, with a 35-second provider timeout and no automatic retry loop. The photo UI aborts its request at 40 seconds. The local 20 POSTs/minute and two concurrent provider calls are not a financial spending cap.

Separately authorized live calls established response validation for one sample conversation and two responses to the same photo; another photo call timed out. The revised photo layout still failed apply validation, and its successful response required a test-only 90-second deadline. See [PHOTO_EVALUATION.md](PHOTO_EVALUATION.md). These samples do not establish general quality, latency or reliability; mocked transport tests do not add live-account evidence. Read-only display/USB discovery is implemented through actual macOS APIs, but Swift compilation, macOS permission behavior and real hot-plug operation have not been validated here. Bluetooth discovery, live link negotiation, multi-user authentication, cloud storage and a packaged native desktop application are not implemented.

See `SCENE_EDITOR.md` for exact editing limits and `VALIDATION.md` for test evidence. New templates must continue to share validated geometry with collision checks; new evidence sources must remain separate from user reports and image inference.
