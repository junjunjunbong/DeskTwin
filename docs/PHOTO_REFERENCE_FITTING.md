# Automatic matching of a photo and its 3D preview

The photo preview now estimates a source view and adjusts its template layout against image evidence. Users do not enter coordinates, mark corners, select a calibration object, or supply lens parameters. The orthographic room view remains the primary scene. Photo matching is an in-memory proposal and still needs the existing explicit confirmation before saving.

This work starts at `550b1b4`, after [bounded geometry repair](PHOTO_PLACEMENT_REPAIR.md). That repair checked contact and collisions but had no objective connecting placement to the image. The [research note](PHOTO_RECONSTRUCTION_OPTIONS.md) motivated the separate source-view comparison. The user's requirement that people must not assign coordinates determines the product flow.

## Implementation plan and resulting behavior

| Step                              | Implementation                                                                                                                                                                                                                                     | Completion criterion                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Recover an approximate photo view | `photoProjection.ts` projects actual transformed template boxes. It can use a reliable model-proposed rectangular surface, or infer a perspective camera automatically from at least four distinct object regions and spread-out template centers. | Independent Three.js scenes verify projection/camera recovery; degenerate evidence is rejected.                                                 |
| Fit against image evidence        | `photoFitting.ts` compares projected outlines/contact anchors with supplied image evidence and searches bounded changes.                                                                                                                           | Image loss improves without introducing component collisions or worsening support margins; locks and retained records survive.                  |
| Make matching automatic           | `PhotoAlignmentPanel` uses the local image's actual aspect, attempts matching once, and offers visual comparison, local retry and undo.                                                                                                            | Browser flow requires no calibration inputs; undo stays undone; failure leaves the preview usable.                                              |
| Evaluate the complete response    | `evaluate-photo-reference.ts` replays caller-selected frozen inputs without a provider call or saved-workspace write.                                                                                                                              | All 19 inherited objects are included, source hashes are preserved, repeat fitting does not walk the layout, and remaining issues are reported. |

## Automatic evidence and source view

The proposal adds optional, validated `imageRegionVisibility`, `imageAnchor` and `photoReference` fields. Earlier frozen replies remain readable. A complete region means the whole outline is visible; a partial or unknown region does not determine an object's full size. An anchor is the visible center of the base contact, not an image-box center projected onto the desk.

The provider may supply visible rectangle corners for a template tabletop or monitor bezel. Hidden corners must remain absent. Reliable model references can initialize a perspective camera without any user calibration. Unreliable focal-limit or residual fits are not silently used. If no reliable model reference exists, the fallback infers a source view from object-region centers and approximate template geometry using a bounded, deterministic robust fit. This fallback does not fabricate individual corner observations.

These estimates depend on template proportions, seed geometry and image observations. They are not measured camera calibration or metric dimensions. A centered principal point, square pixels and undistorted perspective are assumptions. Strong cropping, occlusion, curved monitors and wrong template sizes can invalidate them. Optional rectangular-reference and fixed-field-of-view functions remain internal numerical/testing tools; the product has no manual coordinate or lens-input UI.

Only the source-view comparison uses this camera. The normal hero room camera and its editing controls are independent. The overlay outlines actual projected box parts; it is a geometric guide, not scene segmentation or a recovered photograph. It does not hide occluded parts with a learned visibility mask.

## Fitting and protection

Complete regions constrain the uncut projected bounds, so clipping an object at the image edge cannot make a wrong outline look smaller. Partial and unknown regions impose one-sided coverage only; their centers are not targets that shrink or drag the hidden portion. Visible contact anchors have a penalty when a predicted contact is absent or off frame. RGB texture similarity is not used across the photograph and voxel style.

The first policy permits X/Z changes up to 15% of the relevant desk's world-axis spans, uniform size refinement up to 20%, and yaw refinement up to 10 degrees, all measured against immutable seeds. Size/yaw proposals require complete outline evidence. The reference object, unrelated retained records and user locks are protected. Support descendants move as a group for a parent translation and refit their contact heights. A blocked or locked relation remains a review issue.

The search is bounded at 256 candidate evaluations and four sweeps. These are implementation limits, not quality guarantees. Every accepted update must reduce the image-evidence objective, preserve schema limits, add no new issue identity, and avoid worse numerical footprint/height errors. Component contacts are checked against both the original workspace and the current search iteration, so a small new part collision cannot hide underneath a larger unchanged collision in the same object pair. Final independent apply validation remains authoritative.

Photo-fit snapshots are keyed by stable proposal identity. Undo restores untouched automatic fields even if a candidate has been excluded or rebound to a saved record, while preserving later edits and the chosen record's reports. Repeated fitting reconstructs the same pre-fit variables rather than accumulating displacement. Tiny height roundoff from a size edit no longer creates a false position lock.

## User flow and privacy

1. The existing consented photo analysis returns editable candidates.
2. Matching runs locally after the source image loads; the user immediately retains the ordinary review scene.
3. **Compare with your photo** shows projected shapes. **Match photo again** reruns local fitting with current constraints and makes no model request. **Undo photo match** remains undone through rerenders.
4. Insufficient evidence leaves the current preview intact. The user can keep reviewing or choose another photo; there is no demand to set coordinates.
5. The existing explicit confirmation and storage-conflict checks control saving.

Photo bytes, regions, camera estimates, fit snapshots and comparison state remain outside `Workspace`. Neither retry nor comparison logs or transmits the photo. The expanded model contract is not evidence of live-provider compatibility or better recognition; no new paid request was made. Provider/browser deadlines remain 35/40 seconds. Photo review is loaded separately so the added fitting UI does not enlarge the initial application bundle beyond its previous bound.

## Verification record

The numerical tests use independently projected Three.js geometry, including portrait/rolled cameras, scaled/rotated reference objects, cropped desks with visible monitor references, partial regions, camera priors and perturbed template seeds. Review regressions cover repeat stability, locks, exclusion/restoration, saved-record rebinding, numerical support margins, missing anchors and part-level contacts. Browser tests cover automatic fitting with and without provider corners, absence of calibration inputs, local-only retry, undo, failure recovery, mobile layout and saving only after confirmation.

| Check                                   | Result                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_API_KEY='' npm run check`        | Typecheck, 434 unit/API tests across 24 suites, and build passed.                                                           |
| Full Chromium E2E, retries disabled     | 126/126 passed in the final integrated run (10.2 minutes).                                                                  |
| Automatic photo-flow tests              | Five cases passed; they assert the absence of calibration inputs and no additional model request for local retry.           |
| Production smoke                        | WebGL, CSP, invalid-input rejection and local HEIC conversion passed; no photo transmission/storage.                        |
| Desktop and 390-pixel mobile inspection | Automatic comparison, loaded room scene, failure actions and undo remained reachable without horizontal overflow.           |
| Frozen full-response browser replay     | One mocked local response, zero runtime errors, zero calibration controls, no saved workspace and apply correctly disabled. |
| Format and whitespace                   | Prettier and `git diff --check` passed.                                                                                     |

The complete frozen 19-object response, rather than only its three small sub-scenes, was replayed with **no manual reference or lens input**. The automatic view used its 18 non-desk model regions. All original region visibility values were unknown, so their losses use conservative coverage rather than claiming full-outline accuracy.

| Measurement                   | Before photo fitting | After photo fitting |
| ----------------------------- | -------------------- | ------------------- |
| Collision pairs               | 11                   | 11                  |
| Support issues                | 4                    | 3                   |
| Issue entries                 | 26                   | 25                  |
| Internal image-evidence error | 0.0224808            | 0.0164379           |

Twelve objects received nontrivial changes. The 256-evaluation budget was reached and view uncertainty remained substantial. Repeating the fit returned the identical draft. The final local evaluator took about 2.8 seconds including both the first fit and its repeat on this Mac; this is not a runtime benchmark. The source proposal and workspace hashes stayed unchanged. The report and source-photo screenshot remain in ignored local artifacts.

**The full scene is still blocked from application.** The lower loss is agreement with the model's estimated regions, not an independent measurement of photographic resemblance or recognition. This iteration establishes an automatic image-guided fitting path and its safeguards; it does not resolve every inherited scene error or establish lower human correction burden.

To replay private frozen data locally:

```sh
MODEL_API_KEY='' node --import tsx scripts/evaluate-photo-reference.ts \
  --proposal PATH_TO_FROZEN_PROPOSAL \
  --workspace PATH_TO_WORKSPACE_OR_APPLICATION_REQUEST \
  --aspect 1.3333333333333333 \
  --output PATH_TO_NEW_REPORT
```

The optional internal `--reference` flag is for controlled numerical comparisons, not a product setup requirement. Output files use exclusive creation. The script checks source hashes and repeat stability, and never applies the workspace. Private source inputs are intentionally not committed.

## Remaining limits

One photo does not uniquely determine hidden geometry, true scale, lens distortion or all depth/size combinations. Matching model-generated image boxes does not prove resemblance to the original photograph. Recognition, visible alignment, geometric validity, manual correction burden and latency need separate evaluation across multiple photos. No segmentation/depth model, generated mesh backend, persistent support graph or additional agent/model loop is introduced here.
