# Two-stage photo analysis and optional SAM regions

This path lists visible objects before placement, and can ask SAM 3.1 for a box around each chosen noun phrase. It has not been called against the live Meta API. Tests use a fake `fetch`. Nothing below that depends on a live response should be treated as measured latency, region quality, or a paid invoice.

The screen uses this split only when `META_PHOTO_TWO_STAGE=true`. Otherwise it still calls `POST /api/photo` once. The screen path below has not been called against the live Meta API.

## Flow

1. `POST /api/photo/objects` sends the desk photo to Muse Spark and asks only for an inventory. The reply has no placement, size, rotation, support, connection, operating status, or executable fields.
2. When `META_SAM_ENABLED=true`, the server sends one SAM 3.1 request per distinct `samPhrase`. Returned boxes replace the inventory rectangle when they can be paired. A SAM failure leaves the inventory rectangle in place.
3. The user chooses rows later. `POST /api/photo` with `selection` asks Muse Spark for a scene containing only those ids. Without `selection`, that route is unchanged.

`regionSources` and `sam` are response metadata. They are not part of `SceneProposal` and are not saved on a workspace.

## Configuration

| Variable               | Default   | Meaning                                                                 |
| ---------------------- | --------- | ----------------------------------------------------------------------- |
| `META_SAM_MODEL`       | `sam-3.1` | Model id on the SAM request.                                            |
| `META_SAM_ENABLED`     | off       | SAM runs only when this is the string `true`.                           |
| `META_PHOTO_TWO_STAGE` | off       | The screen uses the two-stage flow only when this is the string `true`. |

The same `MODEL_API_KEY` is used. An empty key still makes both photo routes return 503. The key stays on the server. The photo remains in the request body and is not written to disk or logs.

`server/index.ts` reads these variables. A process-level `timeoutMs` on the server config, when set, replaces the 90 second inventory default the same way it replaces the scene default. SAM's 15 second and 25 second limits are separate and always apply.

## Stage 1 — `POST /api/photo/objects`

The body matches `POST /api/photo`: `image` (JPEG, PNG, or WebP data URL), `consent: true`, `workspace`, and optional `context` up to 2000 characters. The same local rate limit, 8 MB body limit, and error mapping apply. The provider call reuses the chat-completions transport with strict JSON schema, a 90 second default deadline, and `max_completion_tokens` of 8000. The completion budget includes reasoning tokens: a 2026-11-04 full-scene reply used 9,402 completion tokens, 6,293 of them for reasoning. Regions outside the frame are clipped the same way as in scene replies.

```json
{
  "message": "Visible objects only. Placement is not decided.",
  "objects": [
    {
      "id": "monitor-a",
      "kind": "monitor",
      "name": "Black monitor",
      "samPhrase": "black computer monitor",
      "imageRegion": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.25 },
      "imageRegionVisibility": "partial"
    }
  ],
  "regionSources": { "monitor-a": "model" },
  "sam": { "enabled": false, "requests": 0, "failed": 0 }
}
```

`kind` uses the same device and prop kinds as a scene proposal. At most 32 objects. `samPhrase` is one English noun phrase of at most six words, using letters, digits, spaces, and hyphens. `imageRegion` is null when the inventory model is unsure. `imageRegionVisibility` is `complete`, `partial`, or `unknown`.

`regionSources` is `sam` when a SAM box was applied, `model` when the inventory rectangle was kept, and `none` when the rectangle is null. `sam.requests` counts phrase attempts. `sam.failed` counts attempts that timed out, returned an HTTP error, or could not be read. An empty SAM text is a successful miss, not a failure.

Evidence rules match the scene prompt: demo rows are examples, photo inference is a hypothesis, and the user's description is not independent verification. The inventory does not claim that a device works.

## SAM request

For each distinct `samPhrase` the server sends `POST {META_BASE_URL}/responses` (the configured base must still be `https://api.meta.ai`). At most two of those requests run at once. Each attempt aborts after 15 seconds. The whole SAM step aborts after 25 seconds. The caller's cancel signal aborts them too and fails the DeskTwin request.

```json
{
  "model": "sam-3.1",
  "stream": false,
  "metadata": { "include_confidence": "true" },
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "black computer monitor" },
        { "type": "input_image", "image_url": "data:image/jpeg;base64,..." }
      ]
    }
  ]
}
```

The server reads assistant text from `output[].content[]` items whose `type` is `output_text`. It parses boxes and ignores mask payloads. A record that does not match the documented token shape is dropped. The rest of the line is kept. Mask payloads are allowed to contain `|`, `,`, `~`, and `!`; a token ends at the two-character `|>` closer. Coordinates are source pixels. `x2` and `y2` are inclusive, so a normalized rectangle uses width `(x2 - x1 + 1) / w` and height `(y2 - y1 + 1) / h`. A box that cannot become a region inside the image is dropped.

Within one phrase, objects that already have an inventory rectangle take boxes in descending intersection-over-union, and only when that overlap is greater than zero. Objects without an inventory rectangle then take the remaining boxes in descending confidence. The first such object gets the highest confidence. A missing confidence sorts last, and equal confidence keeps SAM's order. An object that gets no box keeps its inventory rectangle.

## Stage 2 — `POST /api/photo`

`selection` is optional. When it is absent, the request and the provider prompt are the previous scene call.

When it is present, `selection.objects` has 1 to 32 items of `{ id, kind, name, imageRegion }`. `imageRegion` may be null. The prompt tells the model to place only those ids and to copy a non-null rectangle. Validation still rejects unknown or duplicate device matches under the existing rules. A scene object whose id is outside the selection is rejected and nothing is applied. A non-null selected rectangle replaces that object's `imageRegion` on the returned proposal. A null selected rectangle leaves the model's rectangle as it was.

The client helper `findPhotoObjects` posts to `/api/photo/objects`. `photoSceneRequest` builds the stage-2 body from chosen rows and omits `samPhrase`, visibility, and region provenance. The screen calls those helpers only when health reports `photoTwoStage: true`.

## Screen

`/api/health` includes `photoTwoStage`. It is `true` only when `META_PHOTO_TWO_STAGE` is the string `true`. A missing value is `false`. The photo panel reads that flag from health. If health does not send it, the screen keeps the single-request flow.

When the flag is on:

1. **Create scene preview with Meta** calls `findPhotoObjects` (`POST /api/photo/objects`). The progress line is “Meta is finding objects in the photo...”, with elapsed seconds, cancel, and the same 125 second browser limit. Placement uses the 120 second scene deadline and the same browser limit.
2. **Choose what to add** lists the inventory. A row whose `regionSources` entry is `sam` shows “Outlined by SAM 3.1”. Any other source shows no region label. An empty inventory shows an error and does not open the picker.
3. **Continue** closes the picker and posts `photoSceneRequest` to `POST /api/photo`. The progress line is “Meta is placing N selected objects...”. The same scene-proposal check and `buildScenePreview` path then open **Review your desk scene** directly.
4. If placement fails, times out, or is canceled, the picker opens again with the same inventory and the same checks, and shows the error. **Continue** retries placement and does not call `/api/photo/objects` again.
5. **View processing times** lists Finding objects, Placing selected objects, Scene fitting, and Analysis to preview. When SAM ran, the summary also says “SAM 3.1 outlined X of N objects”.

The photo and the selection stay in memory. Removing the photo, closing the panel, or canceling aborts the in-flight request. Nothing is written to the saved workspace until the user applies the review.

This screen path has not been called against the live Meta API. The browser test intercepts `/api/health`, `/api/photo/objects`, and `/api/photo`.

## Failure

Inventory validation failures, a missing key, a missing consent flag, and provider failures of stage 1 or stage 2 use the existing photo errors (400, 502, 503, 504, 499). They do not change the workspace.

SAM does not fail the inventory response. HTTP errors, unread responses, the 15 second phrase deadline, and the 25 second overall deadline increment `sam.failed` and leave `regionSources` as `model` or `none`. Client disconnect still cancels the whole request.

The server does not log the photo, the key, or the provider body.

## Cost

Published list prices, not a measurement from this change:

- SAM 3.1 image segmentation is $2.50 per 1,000 images. One image request is billed per distinct `samPhrase` in that inventory, because each phrase is its own request. Video pricing does not apply; this path sends a still. Streaming and non-streaming use the same image price.
- Muse Spark standard prices are $1.25 per 1M input tokens and $4.25 per 1M output tokens. Stage 1 is one chat completion. Stage 2 is a second chat completion only if the user asks for a scene. Token counts for those calls were not measured here.

A desk with 12 objects and 9 distinct phrases, with SAM enabled, is 1 inventory completion plus 9 image segmentations, then later 1 scene completion. `sam.requests` is the segmentation count for that inventory. The DeskTwin process limit still counts the inventory as one local request; the SAM calls sit inside it and count separately against Meta's per-model request limit (`sam-3.1` is listed at 3,000 requests per minute and no token limit).

## Confirmed from Meta's documentation

Checked against the pages linked below. This is documentation, not a live call.

- SAM 3.1 is called as `model: "sam-3.1"` on `POST /v1/responses` at `https://api.meta.ai/v1`, with the same Bearer key as the rest of the API.
- One user message carries `input_text` and one `input_image`. A concept prompt is a short noun phrase. One concept per request. Several concepts mean several requests. Commands, questions, and comma-separated lists are not the concept syntax.
- Streaming is recommended for video and is not required. `stream` omitted or `false` returns the whole result in one response. An image is one `<0f>` line. Zero matches complete with an empty `output_text` and are not an error.
- A record is an integer object id, one box token, and one mask token. The box is `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>`. `w` and `h` are the source image size. `x2` and `y2` are inclusive. Object ids are not a dense 0-based sequence.
- `metadata.include_confidence` set to the string `"true"` adds `;c=` on the box and the mask. Omit it, or send `"false"`, and `c` is absent.
- `image_url` is documented as a public URL or a base64 data URL. The written example is `data:image/png;base64,...`.
- The Responses API example places assistant text in `output[].content[]` with `type: "output_text"` and a string `text`. SAM's overview says the segmentation text arrives in that output-text lane.
- Mask text uses `~` (lossless) or `!` (`one_bit`). The payload is base85 and may itself contain `~` or `!`. This server does not decode it.
- Image segmentation is billed per image at $2.50 per 1,000 images, not per token. The same price is documented for streaming and non-streaming.

## Not confirmed

These were not established by a live response, and this change does not claim them.

- Whether a JPEG or WebP data URL is accepted. The docs show a PNG data URL and say a base64 data URL is allowed. This app sends the existing JPEG, PNG, or WebP data URL. That specific acceptance was not tried.
- The exact non-streaming SAM JSON from production. The reader follows the Responses API example. A body that does not contain readable `output_text` is treated as a SAM failure and falls back to the inventory rectangle.
- Latency of stage 1, of SAM, and of stage 2.
- Whether SAM boxes are better than the inventory rectangles on a real desk photo, including repeated objects that share a noun phrase.
- Actual token counts and the resulting Muse Spark charge. The dollar amounts above are the published list prices only.
- Contributor-mode prices. This path does not switch the model id to a contributor variant.
- The screen flow with `META_PHOTO_TWO_STAGE`. Browser tests use mocked `/api/health`, `/api/photo/objects`, and `/api/photo` responses. No live Meta call was made for the picker, the selection request, or the direct review handoff.

## Sources

- [Segmentation overview](https://dev.meta.ai/docs/sam/overview)
- [Segmenting with prompts](https://dev.meta.ai/docs/sam/segmenting) (linked from the overview; there is no separate `segmenting-with-prompts` path)
- [Reading segmentation output](https://dev.meta.ai/docs/sam/reading-segmentation)
- [Responses API](https://dev.meta.ai/docs/protocols/responses)
- [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)
