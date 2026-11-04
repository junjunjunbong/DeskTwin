# Real photo evaluation and reproducible placement failures

> Historical evaluation at the diagnosis baseline. The observations and counterfactuals below are preserved. See [PHOTO_PLACEMENT_REPAIR.md](PHOTO_PLACEMENT_REPAIR.md) for the subsequent implementation and its separate local acceptance results.

The revised photo workflow finds more separately editable accessories in one desk photo, but its generated layout still cannot be applied without corrections. This record separates live request outcomes, local diagnosis and remaining hypotheses. Product source for the revised runs is `3eb50528763b1f8f4238fe041297d09c59659299`.

## Live observations on 2026-11-01

All three photo requests were separately authorized, used `muse-spark-1.3`, identical resized JPEG bytes, the same workspace and an empty user description. No proposal was applied to the saved workspace. Raw requests, responses, photos and checksums remain in ignored local artifacts; this repository contains only the technical summary and sanitized geometry reproduction.

| Request                             | Source    | Server deadline               | Observed application duration | Outcome                                                                          |
| ----------------------------------- | --------- | ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Original photo                      | `61bbc0b` | 35 s                          | 22.601 s                      | HTTP 200; validated response with 12 objects                                     |
| Revised photo                       | `3eb5052` | 35 s                          | 35.039 s                      | HTTP 504 after provider timeout; no usable scene                                 |
| Separately authorized revised retry | `3eb5052` | 90 s in one-shot harness only | 38.887 s                      | HTTP 200; validated response with 19 objects; placement validation blocked apply |

At the time of these observations, production used a 35-second provider deadline and a 40-second browser photo timeout; the successful 90-second experiment did not change either default. The current photo deadlines are 120 seconds on the provider request and 125 seconds in the browser. On 2026-11-04 one separately authorized request with the same photo returned 504 at the 60-second deadline, which is why the deadline was raised. On 2026-11-04, with the 120-second deadline, the same photo returned 17 objects after about 82 seconds. The reply was rejected because one cropped object's region extended past the frame; the app now clips such regions to the frame and marks them partial. An offline replay of that saved reply is accepted with 17 objects and 28 preview issues. These observations do not establish a latency distribution, reliable production completion or cost benchmark. The earlier successful sample conversation is separate from these three photo requests.

The revised successful response separated a wrist rest, trackpad, tablet, two monitor light bars and a laptop stand. It used the dedicated monitor-riser template. It omitted clipboard/papers and a product box that the earlier response had represented, and approximated the fan with an empty generic template. These are qualitative observations of one image. Prompt, schema, templates and fitting code changed together, so this is not an isolated prompt experiment.

The old application moved the mat to the floor at y=0.001. Both the earlier response replayed in the new application and the new response kept it on the desk at y=2.4855. The new preview retained proposed X/Z and scales but reported 45 issue entries: 5 support entries and 40 collision entries representing 20 pairs. Entries are not independent failures or a quality score, especially across different object counts. Some collisions are secondary to failed support fitting.

## Offline reproduction

Run from the repository root after installing dependencies:

```sh
node --import tsx scripts/replay-photo-placement.ts
```

At `d02cac93`, this script used six geometry records with generic names, neutral colors, no image regions and no personal notes. It called the actual preview and placement validators, read no private artifacts, made no API calls and wrote no files. A successful exit meant the documented baseline and counterfactuals were reproduced; it did not mean the bugs were fixed. `--expect-clear` demonstrated the unresolved keyboard/mat failure with a nonzero exit at that revision. The exact original script is now preserved in [baselines/replay-photo-placement-d02cac93.ts.txt](baselines/replay-photo-placement-d02cac93.ts.txt). The command above tests current acceptance; add `--baseline` to print the historical result instead. These three cases are also current regression tests in `src/domain/photoPlacement.test.ts`.

| Isolated scene             | Unchanged result                | Single controlled change                            | Result                        |
| -------------------------- | ------------------------------- | --------------------------------------------------- | ----------------------------- |
| Desk, mat, keyboard        | 2 collision entries             | Keyboard support changes from desk to mat           | 0 issues                      |
| Desk, keyboard, wrist rest | 2 collision entries             | Wrist-rest Z changes from 0.70 to 0.78              | 0 issues                      |
| Desk, stand, laptop        | 1 support + 2 collision entries | Laptop root height increases by 0.00295 scene units | 1 support entry, no collision |

In the third case, a separate counterfactual increases the stand's X/Z scale from 0.8 to 0.9 and yields no issues. Enlarging geometry is a diagnostic intervention, not a recommended automatic repair or a claim about real dimensions.

The returned keyboard note described it as centered on the mat, while `supportId` named the desk. The isolated replay establishes the effect of that support relation on the current app. The wrist-rest replay establishes a coordinate overlap. The laptop case shows that the full contact-footprint rule can reject slight overhang and skip the height adjustment, producing additional collision entries. These cases do not establish that every support warning is false or that all overhang should be accepted.

## Questions recorded at the diagnosis baseline

The current fitter preserves horizontal positions and scale, orders supports before children and adjusts height only when its support rules pass. It is not a scene-wide layout solver. A plausible next direction is to separate visual object/relation inference from deterministic geometry fitting, but the appropriate scope and benefit remain open.

Review should compare bounded repairs to the current fitter, a constraint-based layout stage, and image-region-assisted fitting with limited user anchors. Decisions should cover contact footprints, supported overhang, uncertainty, displacement limits and a useful preview when the complete scene cannot be made valid. Evaluate recognition, geometry, manual correction effort and latency separately.

The 314 unit/API tests, 113 browser tests and production smoke checks recorded in [PHOTO_REVIEW.md](PHOTO_REVIEW.md) validate behavior and safety boundaries. They do not establish photographed-layout fidelity. No new product implementation or live request is part of this handoff. [GPT Pro review prompt](GPT_PRO_REVIEW_PROMPT.md) requests independent review of these findings and concrete next steps.

That paragraph describes the original handoff. The subsequent bounded repair changes and verification are documented separately in [PHOTO_PLACEMENT_REPAIR.md](PHOTO_PLACEMENT_REPAIR.md). The 2026-11-04 cropped-region note above is a later response check, not a new placement benchmark.
