# Architecture

## Data flow

React owns controls and workspace state. Three.js owns the rendered scene. Both consume the same validated workspace; the renderer is not a second source of device or connection facts.

1. Manual forms and drag interactions produce a workspace command. The command clones and validates the workspace before the browser saves it.
2. Offline conversation produces clearly labelled deterministic examples. Meta conversation, when enabled, goes through the local API and returns validated proposals for separate confirmation.
3. Photo selection is processed locally. Separate consent permits sending the resized image, setup records, and optional description through the local API to Meta.
4. A strict visual scene response becomes an isolated, editable preview. User confirmation validates the preview against its original base and saves one workspace snapshot.

Geometry and pixel textures are procedural. Device models use `Device.kind`; furniture and decor use `SceneObject.kind`, with bounded box compositions for generic substitutes. Their placement, scale, and color come from saved data. Room shell, floor, and window geometry remain fixed examples. Rendering is invalidation-driven: a frame is redrawn after camera, selection, workspace, or viewport changes. Renderer resources are disposed on unmount.

## Files

| Path                                 | Responsibility                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/domain/workspace.ts`            | Workspace v2 schema, v1 migration, validated commands, evidence fields, procedural example seed    |
| `src/domain/sceneProposal.ts`        | Strict visual response schema, deterministic draft construction, stale/evidence checks on approval |
| `src/domain/useWorkspace.ts`         | Browser persistence, import validation, snapshot Undo/Redo                                         |
| `src/scene/deskScene.ts`             | Procedural 3D templates, picking, dragging, transforms, illustrative cable curves                  |
| `src/components/DeskCanvas.tsx`      | React/Three lifecycle and accessible object labels                                                 |
| `src/components/TransformEditor.tsx` | Shared transform controls and bounded generic box editing                                          |
| `src/components/ScenePreview.tsx`    | Unsaved scene preview, local adjustments, explicit approval/discard                                |
| `src/components/PhotoPanel.tsx`      | Local image processing, separate consent, user context, cancelable requests                        |
| `src/domain/demoAssistant.ts`        | Limited, clearly labelled offline examples                                                         |
| `src/domain/useAssistant.ts`         | Conversation provider opt-in, bounded history, error states                                        |
| `src/domain/diagnosis.ts`            | Pure state machine for safe user-guided monitor checks                                             |
| `server/meta.ts`                     | Server-only Meta transport, separate chat/photo contracts, semantic response validation            |
| `server/app.ts`                      | Local HTTP API, origin checks, request bounds, production static serving                           |

## Evidence model

Device identity, visual appearance, reported connection topology, and operating state are separate claims. No field means independently verified hardware operation. The schema deliberately has no `verified` operating state.

Photo responses contain only visual information. They cannot create or update connection records or operating status. New photo devices start with photo-inferred identity and unknown status. Matching an existing non-demo device changes only visual fields. User-provided description helps identify visible objects; free-text connection claims are not automatically converted into topology.

A manual transform changes `visual.source` without changing device identity source or operating state. Original estimate notes remain available. Example devices with user reports attached are retained during draft construction so replacing samples does not delete reported evidence.

A connection is one undirected edge per device pair. Updating a pair replaces the existing record. Multiple parallel cables between the same devices are not yet representable. USB-C records a connector, not Thunderbolt, DisplayPort Alt Mode, negotiated speed, charging power, or successful operation.

## Versioning and transaction boundaries

Workspace v2 adds non-device `objects`, device height, and visual properties. `parseWorkspace()` migrates v1 documents in memory while preserving existing IDs, user records, history, and preferences. The storage key remains `desktwin.workspace.v1`; it can contain a v2 document after the user saves a change. Migration alone does not write storage. A literal v1 fixture checks compatibility.

A manual mutation clones and validates the complete workspace. Invalid imports leave the saved workspace unchanged. Removing a device removes its incident edges. Removing a non-device object does not alter topology.

Photo drafts live outside the persistence hook. Preview edits and cancellation do not touch the saved workspace or Undo stack. Applying a preview rejects a stale base and rejects changes to preserved device reports or connections. It replaces the workspace once and adds one history event, regardless of the number of preview adjustments.

Undo stores up to 20 previous workspace snapshots in memory. Change history persists up to 100 events. The server has no workspace database and returns suggestions only. No provider output is evaluated as code, shell commands, HTML, shaders, or arbitrary remote URLs.

## Current limits

- One workspace per browser origin, with responsive controls and contextual panels.
- 40 devices, 60 non-device objects, 100 connections, and 100 history entries.
- Up to 16 bounded boxes per generic object; named templates use application-owned geometry.
- Photo input: PNG/JPEG/WebP up to 8 MB, re-encoded JPEG with longest side at most 1280 pixels.
- Photo response: 1-32 visual objects; optional user description up to 2,000 characters.
- Chat response: at most 8 proposals; input message up to 2,000 characters; last 12 messages sent to Meta.
- Meta output token caps: 4,096 for chat and 12,000 for photo scenes. The upstream timeout is 35 seconds, with no automatic retry loop.
- Local limit: 20 POST requests/minute and two concurrent provider calls. This is not a financial spending cap.
- Position and scale are bounded scene coordinates. Rotation is yaw only. There is no physical measurement, collision solver, support constraint, or desk-child parenting.
- Repeated analysis preserves non-demo props and currently has no object-ID matching for them. Duplicate props can result.
- No OS discovery, live link negotiation, autonomous cable diagnosis, native packaging, or cloud authentication.

See `SCENE_EDITOR.md` for the full editor contract and `VALIDATION.md` for completed checks. Mocked transport tests do not establish live Meta compatibility or photo interpretation accuracy.

## Extending

Keep any future OS collector read-only and give its observations a separate evidence type with timestamps and provenance. Do not repurpose `user-reported` or `photo-inferred` for OS evidence.

New templates must consume validated scene data. Any future object matching or parenting feature should define how it preserves user edits and reported device links before adding automatic updates. Additional provider integrations need separate request validation, consent wording, and tests rather than arbitrary browser-supplied endpoints.
