# Automatic matching of a photo and its 3D preview

The photo preview estimates one source view, repairs joint support/collision geometry, then adjusts its template layout against image evidence with that same camera. Users do not enter coordinates, mark corners, select a calibration object, or supply lens parameters. The orthographic room view remains the primary scene. Photo matching is an in-memory proposal and still needs the existing explicit confirmation before saving.

This work starts at `550b1b4`, after [bounded geometry repair](PHOTO_PLACEMENT_REPAIR.md). That repair checked contact and collisions but had no objective connecting placement to the image. The [research note](PHOTO_RECONSTRUCTION_OPTIONS.md) motivated the separate source-view comparison. The user's requirement that people must not assign coordinates determines the product flow.

## Implementation plan and resulting behavior

| Step                              | Implementation                                                                                                                                                                                                                                     | Completion criterion                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recover an approximate photo view | `photoProjection.ts` projects actual transformed template boxes. It can use a reliable model-proposed rectangular surface, or infer a perspective camera automatically from at least four distinct object regions and spread-out template centers. | Independent Three.js scenes verify projection/camera recovery; degenerate evidence is rejected.                                                           |
| Repair joint geometry             | `photoJointRepair.ts` compares valid covering alternatives and composes contact-derived parent/child and collision-group movements before image refinement.                                                                                        | The complete 19-object fixture reaches zero collisions/support issues with unchanged scale/yaw, strict component guards and independent apply validation. |
| Fit against image evidence        | `photoFitting.ts` compares projected outlines/contact anchors with supplied image evidence and searches bounded changes.                                                                                                                           | Image loss improves without introducing component collisions or worsening support margins; locks and retained records survive.                            |
| Make matching automatic           | `PhotoAlignmentPanel` uses the local image's actual aspect, attempts matching once, and offers visual comparison, local retry and undo.                                                                                                            | Browser flow requires no calibration inputs; undo stays undone; failure leaves the preview usable.                                                        |
| Evaluate the complete response    | `evaluate-photo-reference.ts` replays caller-selected frozen inputs without a provider call or saved-workspace write.                                                                                                                              | All 19 inherited objects are included, source hashes are preserved, repeat fitting does not walk the layout, and remaining issues are reported.           |

## Automatic evidence and source view

The proposal adds optional, validated `imageRegionVisibility`, `imageAnchor` and `photoReference` fields. Earlier frozen replies remain readable. A complete region means the whole outline is visible; a partial or unknown region does not determine an object's full size. An anchor is the visible center of the base contact, not an image-box center projected onto the desk.

The provider may supply visible rectangle corners for a template tabletop or monitor bezel. Hidden corners must remain absent. Reliable model references can initialize a perspective camera without any user calibration. Unreliable focal-limit or residual fits are not silently used. If no reliable model reference exists, the fallback infers a source view from object-region centers and approximate template geometry using a bounded, deterministic robust fit. This fallback does not fabricate individual corner observations.

These estimates depend on template proportions, seed geometry and image observations. They are not measured camera calibration or metric dimensions. A centered principal point, square pixels and undistorted perspective are assumptions. Strong cropping, occlusion, curved monitors and wrong template sizes can invalidate them. Optional rectangular-reference and fixed-field-of-view functions remain internal numerical/testing tools; the product has no manual coordinate or lens-input UI.

Only the source-view comparison uses this camera. The normal hero room camera and its editing controls are independent. The overlay outlines actual projected box parts; it is a geometric guide, not scene segmentation or a recovered photograph. It does not hide occluded parts with a learned visibility mask.

## Fitting and protection

Complete regions constrain the uncut projected bounds, so clipping an object at the image edge cannot make a wrong outline look smaller. Partial and unknown regions impose one-sided coverage only; their centers are not targets that shrink or drag the hidden portion. Visible contact anchors have a penalty when a predicted contact is absent or off frame. RGB texture similarity is not used across the photograph and voxel style.

The first policy permits X/Z changes up to 15% of the relevant desk's world-axis spans, uniform size refinement up to 20%, and yaw refinement up to 10 degrees, all measured against immutable seeds. Size/yaw proposals require complete outline evidence. The reference object, unrelated retained records and user locks are protected. Support descendants move as a group for a parent translation and refit their contact heights. A blocked or locked relation remains a review issue.

The image refinement search is bounded at 256 candidate evaluations and four sweeps. A preceding joint geometry search has its own bounded budget, described below. These are implementation limits, not quality guarantees. Every accepted image refinement must reduce the image-evidence objective, preserve schema limits, add no new issue identity, and avoid worse numerical footprint/height errors. Component contacts are checked against both the original workspace and the current accepted search state, so a small new part collision cannot hide underneath a larger unchanged collision in the same object pair. Final independent apply validation remains authoritative.

Photo-fit snapshots are keyed by stable proposal identity and include support metadata as well as geometry. Undo restores untouched automatic fields even if a candidate has been excluded or rebound to a saved record, while preserving later edits and the chosen record's reports. A later position lock or user height reference retains the matching support because its contact height cannot be rolled back independently. Both Undo paths check the complete proposed rollback: if moving a parent back would worsen a protected child's contact, they retain the needed support group together. Excluded items are checked in a temporary geometry view without adding them to the applied scene. Repeated fitting reconstructs the same pre-fit variables rather than accumulating displacement, including after a child is locked. Tiny height roundoff from a size edit does not create a false position lock.

## User flow and privacy

1. The existing consented photo analysis returns editable candidates.
2. Matching runs locally after the source image loads; the user immediately retains the ordinary review scene.
3. **Compare with your photo** shows projected shapes. **Match photo again** reruns local fitting with current constraints and makes no model request. **Undo photo match** remains undone through rerenders.
4. Insufficient evidence leaves the current preview intact. The user can keep reviewing or choose another photo; there is no demand to set coordinates.
5. The existing explicit confirmation and storage-conflict checks control saving.

Photo bytes, regions, camera estimates, fit snapshots and comparison state remain outside `Workspace`. Neither retry nor comparison logs or transmits the photo. The expanded model contract is not evidence of live-provider compatibility or better recognition; no new paid request was made. Current photo provider/browser deadlines are 60/65 seconds; chat retains its 35-second provider deadline. Photo review is loaded separately so the added fitting UI does not enlarge the initial application bundle beyond its previous bound.

## Baseline verification at `79ed8b6`

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

**At this baseline the full scene was blocked from application.** The lower loss is agreement with the model's estimated regions, not an independent measurement of photographic resemblance or recognition. That iteration established an automatic image-guided fitting path and its safeguards; the joint repair below addresses the remaining numerical failures.

To replay private frozen data locally:

```sh
MODEL_API_KEY='' node --import tsx scripts/evaluate-photo-reference.ts \
  --proposal PATH_TO_FROZEN_PROPOSAL \
  --workspace PATH_TO_WORKSPACE_OR_APPLICATION_REQUEST \
  --aspect 1.3333333333333333 \
  --output PATH_TO_NEW_REPORT
```

The optional internal `--reference` flag is for controlled numerical comparisons, not a product setup requirement. Output files use exclusive creation. The script checks source hashes and repeat stability, and never applies the workspace. Private source inputs are intentionally not committed.

## Full-scene replay for independent review

The repository also includes a sanitized numerical fixture of all 19 objects, with original names, notes, colors, photo and private workspace removed. Stable generic IDs, geometry and estimated normalized image regions are retained because they affect the deterministic search. These are model estimates, not measurements or ground truth.

```sh
node --import tsx scripts/replay-photo-scene-19.ts
node --import tsx scripts/replay-photo-scene-19.ts --extended
```

At `79ed8b6`, the sanitized replay matched the private-data replay: 11 collision pairs and three support issues after fitting. The remaining support issues concerned two monitors on their riser and one monitor light bar. Increasing the image candidate budget to 1,024 and the sweep limit to 12 used 864 evaluations and reduced image-evidence error to 0.0146203, but left the same 11 collision pairs. This rules out a larger image search budget alone as a sufficient solution in this case.

The inherited response has zero complete-outline labels, zero contact anchors and no source reference. Accordingly, the image fitter does not propose scale/yaw changes. At the baseline, support relations also stayed fixed and every accepted step had to reduce image-evidence loss immediately. The missing support alternatives, joint and relative movement candidates, and immediate image-loss gate prevented a valid joint correction.

## Joint geometry repair follow-up

`photoJointRepair.ts` runs before the existing photo fitter. It reuses the geometry-first score from `photoPlacement.ts`, the current contact policy, the current component collision detector, and the independent final apply validator. It does not contain fixture IDs, target coordinates, or the diagnostic witness. Geometry repair never changes scale, yaw, template kinds, or retained records.

1. **Support alternatives.** Read-only geometry helpers propose an unambiguous nearby thin covering on the same solid support, including partial mat contact already accepted by `evaluateSceneSupport()`. The current support remains a search candidate. Support choice, its height correction, and dependent height carry are assembled together. Multiple plausible coverings remain unresolved rather than being selected by object order. User-selected or locked support relationships are preserved; automatic choices record `supportSource: 'geometry'` without rewriting the original seed.
2. **Joint endpoint construction.** Actual colliding box parts provide separating directions and distances. Actual contact patches provide containment offsets in the support's local coordinates. Candidates can move a parent and descendants, a parent relative to some children, siblings, or both colliding support groups. Rotated local directions and combined contact corrections produce simultaneous X/Z changes. Intermediate construction states stay in temporary copies; they are not applied to the review.
3. **Strict acceptance.** Geometry issues, collision count and penetration precede image loss in the score. A completed endpoint can therefore improve geometry even if its image error temporarily increases. It must still pass schema validation, immutable-seed movement limits, support margins and `getSceneCollisionPairs(next, current)`. The collision tolerances and independent `validateSceneReviewForApply()` are unchanged. A failed or exhausted search returns only a strictly accepted endpoint with its remaining issues.
4. **One camera and one movement budget.** The camera is estimated before repair and is shared by all image comparisons and the subsequent existing fitter. X/Z changes across both stages remain within 15% of the desk's world-axis spans from the same seed, and automatic height correction remains within 0.12 of the original/user-defined height reference. Retry reconstructs geometry and support choices together. Undo, exclusion/restoration and rebinding use stable proposal identities and preserve later locks, explicit choices and saved reports.

The default application policy allows 2,048 evaluated joint endpoints and 12 sweeps, with a three-state frontier. The internal fitting policy rejects repair budgets above 4,096 endpoints. It expands the current largest penetration conflict and support-contact alternatives. The unchanged default image phase then uses at most 256 evaluations and four sweeps. These are bounded heuristics, not a guarantee that every valid scene will be found. No segmentation/depth service, GPU dependency, calibration UI, new model loop or persistent workspace schema is added.

### Complete 19-object automatic regression

The replay now asserts the completion conditions instead of merely printing an unresolved scene. It uses the real application path and an independently recomputed source camera. It also asserts unchanged source inputs, all 19 retained objects, exact repeat/undo behavior, fixed scale/yaw, original seeds/locks, movement limits, no new or worsened component contacts and independent apply validation.

| Measurement                       | Initial preview | Default joint repair + photo fit | Extended image fit |
| --------------------------------- | --------------: | -------------------------------: | -----------------: |
| Included objects                  |              19 |                               19 |                 19 |
| Collision pairs                   |              11 |                                0 |                  0 |
| Support issues                    |               4 |                                0 |                  0 |
| Issue entries                     |              26 |                                0 |                  0 |
| Fixed-camera image-evidence error |       0.0224808 |                        0.0159907 |          0.0146250 |
| Independent apply validator       |         Blocked |                             Pass |               Pass |

The geometry stage used 479 endpoint evaluations and four sweeps. Its image error was 0.0244346 before image refinement: this measured temporary increase is why the original immediate-image-improvement gate was insufficient. The default final error is below the baseline default 0.0164379. The extended run uses 864 image evaluations and retains zero geometry issues. Neither the earlier diagnostic error nor its coordinates are inputs to the solver.

Default maximum seed displacement was X = 0.6459981, Y = 0.0314500, Z = 0.3593203, below limits 1.113, 0.12 and 0.474 respectively. All 19 scales and yaw values remain identical to their seeds. Repeat returns identical geometry and support metadata; Undo restores the pre-fit geometry and support metadata.

Independent tests also exercise partial and ambiguous mats, rotated supports and collision parts, compound shapes with empty bounding-box space, locks and user-selected supports, excluded candidates, and saved-record rebinding. The browser regression uses a synthetic 4:3 PNG and the sanitized response, with provider traffic intercepted. No actual source photo or paid API call is part of this verification.

### Integrated verification

The integrated runs use the Mac repository, Node.js 26.0.0 and Chromium. API keys are empty, and browser/production tests own their local servers rather than reusing a development session.

| Check                               | Result                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_API_KEY='' npm run check`    | Typecheck, 468 unit/API tests across 27 suites, and production build passed.                                                                                     |
| Full Chromium E2E, retries disabled | 127/127 passed in the final integrated run (12.6 minutes).                                                                                                       |
| Photo review browser cases          | All 15 related cases passed, including the full 19-object automatic fit, repeat, Undo and explicit save; also included in the final full run.                    |
| Production smoke                    | WebGL, CSP, invalid-input rejection and local HEIC conversion passed; zero photo requests and no stored photo.                                                   |
| Support/Undo lifecycle matrix       | 14 cases passed, including moved-parent contact, included/excluded locked children, both Undo APIs, user-height timing and stable repeated fitting after a lock. |
| Full-scene replay with `--extended` | All 19 objects retained; zero collisions/support issues, independent apply, unchanged scale/yaw, seed budgets, fixed camera, repeat and Undo assertions passed.  |

The existing gap-review browser test now waits for the review dialog to close after confirmation before inspecting saved data: browser saving awaits the cross-tab Web Lock. Its existing saved-value and metadata assertions remain unchanged. The new full-scene test uses an explicit JSON import attribute for the supported Node runtime. No test is excluded and no geometry assertion or collision threshold is weakened.

## Remaining limits

One photo does not uniquely determine hidden geometry, true scale, lens distortion or all depth/size combinations. Matching model-generated image boxes does not prove resemblance to the original photograph. Recognition, visible alignment, geometric validity, manual correction burden and latency need separate evaluation across multiple photos. No segmentation/depth model, generated mesh backend, persistent support graph or additional agent/model loop is introduced here.
