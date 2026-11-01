# Photo review and support-aware placement — 2026-11-01

> This document records the earlier photo workflow and its verification. [PHOTO_PLACEMENT_REPAIR.md](PHOTO_PLACEMENT_REPAIR.md) documents the subsequent common contact policy, bounded repair, preview locks/comparison, cancellation and current verification. The historical test counts and live observations below are unchanged.

The photo workflow creates editable object candidates. Users choose which candidates to include, restore excluded candidates, add missing objects, and correct placement before a separate confirmation writes the workspace. A photo remains an interpretation of visible objects, not evidence of working hardware or cable connections.

## Why this changed

At source commit `61bbc0b`, two separately authorized live requests succeeded with `muse-spark-1.3`: one sample conversation and one real desk photo. The conversation took 6.95 seconds; the photo took 22.60 seconds and returned 12 objects. Both passed the application's response validation. These are individual observations, not a quality or latency benchmark.

The photo exposed several gaps. The wrist rest appeared only in the keyboard's description, not as a separate object. Trackpad, tablet, light bars and the laptop stand were omitted. The monitor riser used the old thin shelf template. Most importantly, the model placed the mat on the desk, but the application's device-first fitting pass moved it to the floor to avoid collisions. The original response and verdict are preserved in ignored local test artifacts; no personal photo is included in the repository.

This change addresses the application behavior and revises the model's requested output. Implementation checks used no additional live model request. Separately authorized follow-up calls subsequently evaluated the revised prompt on the same photo; their timeout and unresolved layout failures are recorded in [PHOTO_EVALUATION.md](PHOTO_EVALUATION.md). Replaying the earlier response or passing synthetic tests does not establish the quality of the revised prompt on a new photo.

## Review workflow

- Each photo or manual candidate has an independent inclusion choice. Exclusion is reversible within the review and retains the candidate's edits.
- An excluded candidate that matched an existing saved record restores that record's original data. Excluding a photo candidate is not permission to delete saved devices, reports or cable records.
- **Add missing object** creates a manual candidate in the same preview. Its source is user-reported; it is not labelled as something the model saw. Types and editable presets cover tablets, trackpads, wrist rests, monitor risers, laptop stands and monitor light bars, in addition to the existing types.
- The object list selects the corresponding 3D item and shows the reference photo. A supplied normalized image region is labelled as an approximate model region. No box is invented for old responses or manually added objects without region data.
- Device matching, placement problems and changed-workspace conflicts must be resolved before confirmation. The final apply path validates review metadata again, in addition to the existing storage transaction and collision checks.
- Preview changes remain in memory. Applying is one saved scene transaction; canceling does not write the workspace.

## Placement and geometry

Dedicated accessory templates separate a wrist rest from a keyboard, a riser from its monitors, and a stand from its laptop. The original `shelf` geometry is retained for existing saves. The model receives real template bounds and instructions to preserve relative size, left/right and front/back arrangement, with explicit support relationships when visible.

The review fitter places supports before supported candidates. It adjusts height to a valid support while retaining the proposed horizontal layout. Missing or cyclic supports, inadequate surfaces and collisions become review issues instead of silently moving a tabletop object to the floor. Deliberate **Place on surface** editing can resolve an issue. Desk attachment still means carrying an object with that desk; a visual support estimate is not a cable connection or a full physics simulation.

Optional nullable support and image-region fields keep earlier photo fixtures readable. The provider's strict schema requests these fields explicitly. New object/device kinds are additive to workspace v2; old saved records are not rewritten on load. Older application versions may reject the newly added kinds.

## HEIC and privacy

The photo selector accepts HEIC/HEIF in addition to JPEG, PNG and WebP. Native decoding is tried first. A pinned `libheif-js` pure-JavaScript decoder runs in a separately loaded local module worker when native decoding cannot read a HEIC/HEIF image. There is no conversion service, runtime CDN, WebAssembly or relaxed script evaluation policy.

Input is limited to 8 MiB. The fallback reads only the primary image, checks dimensions before decoding and RGBA allocation, and limits images to 64 megapixels and 16,384 pixels per side. The worker terminates on completion, failure, cancellation or timeout. Photos are oriented, resized to at most 1280 pixels on the longest side, and re-encoded as JPEG without the original metadata before any optional Meta transmission. Unsupported or malformed files produce a conversion/re-export message. Support for every HEIF codec or camera variant is not claimed.

Production CSP allows same-origin workers with `worker-src 'self'`; `script-src 'self'` remains unchanged. Decoder notices and license texts ship in `public/THIRD_PARTY_NOTICES.txt` and `public/licenses/`.

## Verification

Automated tests use an explicitly empty `MODEL_API_KEY`, synthetic scene inputs and a tiny self-generated rotated HEIC fixture. They do not make a live Meta call or read a physical hardware snapshot.

- `npm run check`: typecheck, 314 unit/API tests across 18 suites, and production build passed.
- `npm run test:e2e -- --retries=0`: all 113 Chromium browser tests passed in the final integrated run (8.9 minutes), including the 10 new photo-input/review cases and existing storage, hardware-fixture, connection and spatial-editing flows.
- `npm run format:check` and `git diff --check`: passed.
- `npm run test:production`: WebGL rendering, restrictive production CSP, invalid-input rejection and local rotated-HEIC conversion passed. The fixture became a 32 × 64 JPEG with zero photo requests and no photo in browser storage.
- The initial full browser run found four failures: two manual-add flows exposed a shared placement-search budget that mat layers exhausted before the desk was checked; two identity/consent fixtures contained overlapping or unsupported geometry. Each surface now receives its own bounded search, with a domain regression test preserving existing records. The two fixtures now specify a clear position and supporting desk. All four focused browser retests passed without retries.
- A frozen earlier real-photo response was replayed locally. All 12 candidates retained their proposed X/Z coordinates, individual exclusion/restoration preserved their draft data, and the mat stayed on the desk at y=2.4855 rather than being moved to the floor. Seven support/collision issues remained visible and blocked final apply. The eight recorded artifact hashes from the earlier review remained unchanged.
- A separate local browser check decoded the user's supplied HEIC in the production app to a 1280 × 960 JPEG in 2.32 seconds. It made no external or photo-analysis request and stored no photo. This is one file/browser observation, not universal camera-format coverage.
- Desktop and 390-pixel mobile review screens were inspected using a synthetic proposal. Object selection, reference-region display, independent wrist-rest geometry and confirmation controls rendered without runtime errors or horizontal dialog overflow. The workspace remained unsaved.

The build emits browser-externalization notices for the decoder package's unused Node `fs`, `path` and `crypto` branches. The built production worker was exercised successfully under the unchanged script policy; these notices are not live API evidence.

Follow-up live validation: the revised model prompt returned 19 objects in a separately authorized 90-second harness run, after an earlier request timed out under the unchanged 35-second default. Placement issues blocked apply. See [PHOTO_EVALUATION.md](PHOTO_EVALUATION.md) for observations and offline reproductions. General new-photo recognition and relative-size accuracy, Safari/Firefox behavior and broader HEIF codec/camera coverage remain unverified. The local checks establish the review and conversion behavior, not automatic fidelity to a photographed desk.
