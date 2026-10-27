# Architecture

## Data flow

```text
Browser UI
  ├── Three.js scene ← validated Workspace
  ├── forms / drag / manual connection → command → validate → localStorage
  ├── offline conversation → deterministic demo proposals → user confirmation
  ├── Meta conversation (opt-in) → local API → Meta → schema validation
  └── image (explicit opt-in) → downsample/re-encode → local API → Meta
                                                       ↓
                                     candidate proposal → user confirmation
```

React renders app controls; Three.js owns the scene. The room and decor are procedural example models. Devices are generated from `Device.kind` and positioned from the saved placement. Rendering is invalidation-driven; a frame is redrawn only after camera, selection, workspace or viewport changes. The scene's resources are disposed on unmount.

## Files

| Path                            | Responsibility                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/domain/workspace.ts`       | Versioned schema, commands, proposal validation, demo seed             |
| `src/domain/useWorkspace.ts`    | Browser persistence, import validation, undo/redo                      |
| `src/scene/deskScene.ts`        | Real 3D geometry, camera, picking, dragging, cable views               |
| `src/components/DeskCanvas.tsx` | React/Three lifecycle and accessible device labels                     |
| `src/domain/demoAssistant.ts`   | Limited, clearly labelled offline examples                             |
| `src/domain/useAssistant.ts`    | Provider opt-in, bounded conversation, error states                    |
| `src/components/PhotoPanel.tsx` | Local photo processing, consent, candidate confirmation                |
| `src/domain/diagnosis.ts`       | Pure state machine for safe user-guided monitor checks                 |
| `server/meta.ts`                | Official Meta adapter, structured output, reference checks             |
| `server/app.ts`                 | Local HTTP API, origin checks, input bounds, production static serving |

## Evidence model

Device identity source, reported connection topology, and operating state are separate. No field in the MVP means independently verified hardware operation. The schema deliberately has no `verified` operating state. User confirmation of a photo candidate does not silently convert a visual guess into a manufacturer-verified identity.

A connection is currently one undirected edge per device pair. Updating a pair replaces the existing record. Multiple parallel cables between the same devices are not yet representable. USB-C is a connector record, not a claim about Thunderbolt, DisplayPort Alt Mode, negotiated speed or charging power.

## Transaction boundaries

A mutation clones and validates the complete workspace before changing React state. Invalid imports leave the original workspace unchanged. Removing a device removes its incident edges. Stale AI proposals are validated again when the user confirms them. Undo stores up to 20 previous workspace snapshots in memory; history persists up to 100 events.

The server does not own a workspace database. It returns suggestions only. Client confirmation is required for applying any suggestion. No provider output is evaluated as code, shell commands, HTML or arbitrary remote URLs.

## Current limits

- Single workspace per browser origin; desktop-first layout with a responsive mobile view.
- 40 devices, 100 connections, 100 history entries.
- Photo input: PNG/JPEG/WebP up to 8 MB; re-encoded JPEG with longest side at most 1280 px.
- At most 8 model proposals; chat message at most 2,000 characters; last 12 messages sent to Meta.
- Meta output token cap 4,096; 35-second upstream timeout; no automatic retry loop.
- Local 20 POST requests/minute and two concurrent provider calls; not a financial spending cap.
- Procedural generic room and devices, not photo-to-mesh reconstruction or exact dimension measurement.
- No OS discovery, live link negotiation, autonomous cable diagnosis, native app packaging or cloud auth.

## Extending

Keep a future OS collector read-only and make its observations a separate evidence type with timestamps and provenance. Do not repurpose `user-reported` or `photo-inferred` for OS evidence. New scene assets should consume the validated workspace, not hide a second source of topology truth. Additional provider integrations need separate request validation, consent wording and tests rather than allowing arbitrary URLs from the browser.
