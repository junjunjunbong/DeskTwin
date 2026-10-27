# Validation record — photo scene editor, 2026-10-27

## Scope and environment

This record covers `feat/photo-scene-editor`, based on authenticated private `main` at `5b405a485294fc515c343d06ecc9c4f51a3319a1`. The implementation commit is `b480cf7`.

The checks ran in a Linux workspace with Node.js 24.22.1 and the repository's unchanged locked npm dependencies. `MODEL_API_KEY` was explicitly empty for the application servers and test commands. API tests and photo browser tests use mocked provider responses and synthetic image data. **No live Meta API request was made and no real desk photo was analyzed.**

The Playwright-managed Chromium download returned invalid archives in this environment. Browser tests therefore used an isolated Chromium 153.0.8010.0 executable with Playwright 1.64.1 and software WebGL. This is a real browser run, but not a validation of the default Playwright Chromium build. The repository's optional `DESKTWIN_CHROMIUM_EXECUTABLE` test override makes that difference explicit. No production dependency was added for the fallback browser.

## Automated results

| Check                                     | Result                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run check`                           | Passed: strict TypeScript, unit/API tests, production build                            |
| Unit and HTTP/API tests                   | **58 passed**, 4 files                                                                 |
| `npm run test:e2e`                        | **21 passed**, including 8 scene-editor flows                                          |
| `npm run test:production`                 | Passed: real WebGL canvas, UI controls, CSP, rejected invalid input and missing assets |
| `npm run format:check`                    | Passed                                                                                 |
| `git diff --check`                        | Passed                                                                                 |
| Live Meta API / photo recognition quality | **Not run**                                                                            |

The browser commands used:

```bash
MODEL_API_KEY='' npm run check
MODEL_API_KEY='' DESKTWIN_CHROMIUM_EXECUTABLE=/tmp/desktwin-headless/chromium npm run test:e2e
MODEL_API_KEY='' DESKTWIN_CHROMIUM_EXECUTABLE=/tmp/desktwin-headless/chromium npm run test:production
npm run format:check
```

Ordinary development can omit `DESKTWIN_CHROMIUM_EXECUTABLE` after installing the normal Playwright Chromium. The override is only a test executable path; it does not change application behavior or the model endpoint.

## Verified behaviors

- A selected photo remains local until the separate consent checkbox and analysis button are used. User setup notes are included in the explicitly approved request.
- A validated response opens an editable, unsaved 3D preview. Editing or discarding it does not write localStorage or add saved Undo entries.
- Approval writes one workspace snapshot and one history event. One Undo restores the prior furniture, devices, statuses, and connections; Redo restores the approved scene.
- Existing user-reported identity, model, status, connection ports, and notes survive scene approval. New photo devices have `photo-inferred` identity and `unknown` operating status.
- Desk, chair, plant, generic object, and generic box-part edits persist across reload and JSON export/import.
- Literal v1 data migrates to v2 with existing IDs, records, history, and appearance preserved. Migration on read does not overwrite storage until an explicit saved change.
- Malformed/hostile scene fields, bad references, duplicate references, excessive objects/parts, invalid transforms, and provider errors fail without replacing the saved workspace.
- Canceling analysis or replacing the photo prevents late responses from reopening or replacing a newer preview. Replacing the photo resets consent.
- Stale scene approval is rejected by the domain boundary. Photo proposals cannot create connection or operating-status records.
- Narrow viewport object editing and creation pass at 390 × 844. Existing device, conversation, connection, troubleshooting, import/export, and Undo flows also pass.

## Visual and direct canvas checks

The desktop hero and separate scene preview were rendered and inspected. The preview retains the existing voxel appearance, keeps the 3D scene prominent, and exposes the object inspector plus confirmation controls.

Additional canvas exercises selected and dragged actual geometry, beyond the form-based E2E checks:

- Desk: moved from x/z `(0, 0)` to `(0.64, 0.14)` and restored with Undo.
- Generic headphone substitute: selected from its visible boxes and moved from x `-1.30` to `-0.96` at y `2.51`.
- Chair: selected from its back and moved from x `-0.55` to `-0.21` on its ground-height drag plane.

These exercises reported no page runtime errors. Mobile preview testing at 390 × 844 also confirmed no horizontal overflow and reachable, working approval controls. The preview scrolls vertically on narrow screens.

- `screenshots/scene-preview-desktop.png`: actual desktop browser preview, mocked proposal.
- `screenshots/scene-preview-mobile.png`: actual mobile-width browser preview, mocked proposal.

The screenshots use a deliberately mocked proposal and a synthetic reference image. They demonstrate rendering and editing, not live photo recognition.

## Remaining validation gaps

- Real Meta authentication, model availability, billing, response latency, strict-output compatibility, and visual inference accuracy remain unverified. A configured key or passing mock test is not a successful live call.
- The default Playwright Chromium build, Safari, Firefox, and physical mobile touch dragging were not exercised in this environment.
- Long-duration operation, low-end GPU performance, exhaustive accessibility, and an independent security audit were not tested.
- The room shell is fixed, rotation is yaw only, and there is no collision detection or desk/object parenting. Repeated analysis may duplicate retained furniture/props because they have no model matching reference. These are implementation limits, not failed tests; see `SCENE_EDITOR.md`.
- Browser cancellation suppresses the result but cannot retract an image already transmitted or guarantee cancellation of a provider request already in flight.

A live acceptance run requires separate approval for API spending. It should use a non-sensitive desk photo, evaluate visible object identity/layout/color against the image, and verify both discard and approval before claiming model reconstruction quality.
