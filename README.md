# DeskTwin

**Your desk, understood.** DeskTwin turns a desk photo into an editable 3D workspace. You record how your devices are actually connected, and when something stops working you get help grounded in that record.

Built for the [Meta AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details). This repository was started during the event, and every commit is from 2026-10-26 or later. [한국어 README](README.ko.md)

![DeskTwin on first visit: a sample desk with the My desk panel](docs/screenshots/first-visit-desktop.png)

> The desk above is a sample. Its 8 devices and 7 connections are placeholders, not detected hardware. **Start my own desk** clears them.

## Why

A desk with a laptop, a dock, two monitors and a handful of USB and Bluetooth devices is hard to explain when one screen goes black. Photos show what is there but not what is plugged into what. Chat assistants guess. DeskTwin keeps three kinds of evidence apart, so neither the person nor the model mistakes a guess for a fact:

| Claim                | Where it comes from                                 | What it does **not** prove               |
| -------------------- | --------------------------------------------------- | ---------------------------------------- |
| Photo interpretation | Muse Spark reads the desk photo                     | That a device exists, works or is cabled |
| User report          | The person confirms a connection or a device status | That the link works electrically         |
| macOS observation    | Optional, consented, local display/USB read-out     | Cable routes or that a feature works     |

Saving a cable never marks a device as working, and no model suggestion is applied until the person confirms it.

## How Meta models are used

| Model                             | Used for                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Muse Spark** (`muse-spark-1.3`) | Photo understanding: finds the visible objects on a desk and proposes a 3D layout (kind, rough position, size, color, simple box parts). Conversation: answers questions about a selected device using the recorded connections and earlier checks. Both use **strict structured output**. |
| **SAM 3.1** (`sam-3.1`, optional) | With two-stage photo analysis on, outlines each chosen object in the photo so the person can see exactly what was found.                                                                                                                                                                   |
| **Muse Image**                    | Generated the demo desk image used in the video. The generated images are not committed.                                                                                                                                                                                                   |

All calls go through the Meta Model API (`https://api.meta.ai/v1`) from the local server. The key stays server-side in `.env`. Model output is validated before it is shown:

- Responses must match a strict JSON schema and refer only to device IDs that exist.
- Photo responses may describe visible objects only. Connection, operating-status and executable fields are rejected.
- Errors are shown as errors. A failed live call is never replaced by a fake "AI" answer.
- Without an API key, the same workflow runs as a clearly labeled **local demo** that does not imitate a model.

## What you can do

1. **Build from a photo** (My desk). Choose a JPEG, PNG, WebP or HEIC photo. Rotation, resizing and HEIC conversion happen in the browser, and nothing is sent until you give separate consent. In **Choose what to add**, pick which detected objects belong on your desk, then review the proposed 3D scene and apply it with **Confirm and apply scene**.

   ![Choose what to add after photo analysis (test fixture response)](docs/screenshots/photo-object-picker.png)

2. **Record connections** (Hardware → Connections). Saved links are listed first, and devices with no link yet appear as chips. Tap one, choose what it is plugged into and the cable (or **Unknown**), then press **Save connection**. You can also tap a device on the desk and answer "What is it plugged into?". Replacing an existing link always shows the old and new record before saving.
3. **Fix a problem** (Hardware → Fix a problem). Pick the device that is not working. AI chat opens for that device with a draft question; nothing is sent until you press Send. Monitors also have a guided **Troubleshoot monitor step by step** check in their detail view. It follows the recorded monitor → dock → computer route and stores each answer.
4. **Edit the 3D scene** (Edit mode). Drag devices and furniture with collision checks, place things on surfaces, attach them to the desk, and edit position, rotation, size, color and box parts. Undo/Redo covers 20 steps. **Show connections** draws the recorded links in the scene.
5. **Match with this Mac** (optional). After explicit consent, a local helper reads display and USB metadata. You match an observation to a desk device yourself; nothing is merged by name. Observations never leave the machine.
6. **Export / import JSON.** Photos, chat and keys are never included.

## Quick start

Requires Node.js 22.12 or later.

```bash
git clone https://github.com/junjunjunbong/DeskTwin.git
cd DeskTwin
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API server runs on `127.0.0.1:4318`. Both listen on localhost only. With no key this is the local demo, and no external calls are made.

To use Meta models:

```bash
cp .env.example .env
```

```dotenv
MODEL_API_KEY=your_key_here
META_BASE_URL=https://api.meta.ai/v1
META_MODEL=muse-spark-1.3
# Optional: split photo analysis into object list + layout, and outline objects with SAM 3.1
META_PHOTO_TWO_STAGE=false
META_SAM_ENABLED=false
META_SAM_MODEL=sam-3.1
```

Restart the server, open **AI chat → Connect Meta API**, review what will be sent, and enable it. Real API calls may cost money. The local 20 requests/minute limit is not a spending cap. Never put the key in `VITE_*` variables, screenshots or commits.

If the default ports are busy:

```bash
MODEL_API_KEY='' DESKTWIN_WEB_PORT=5187 PORT=4337 npm run dev
```

### macOS hardware matching (optional)

Requires macOS 12+, Node.js 22.12+ and Xcode Command Line Tools.

```bash
npm run hardware:build
MODEL_API_KEY='' npm run dev
```

Open **Hardware → Devices → Open Mac hardware details**, read the notice, check **I agree to read this Mac's hardware metadata locally.**, and press **Start detection**. Serial numbers are turned into an installation-specific HMAC inside the native process and are never logged or exported. Bluetooth live detection is not supported; manual Bluetooth links are kept. See [MACOS_HARDWARE.md](docs/MACOS_HARDWARE.md).

## What was verified, and what was not

- **Live Meta calls (2026-11-04):** a conversation request succeeded in 14.3 s. On a Muse Image demo desk, two-stage photo analysis reached a scene that could be applied. On a real desk photo, analysis returned 17 objects, but 4–5 overlaps (monitor, riser, stand) still have to be fixed by hand before applying. Photo limits are 120 s on the server and 125 s in the browser. Details: [PHOTO_TWO_STAGE.md](docs/PHOTO_TWO_STAGE.md), [PHOTO_EVALUATION.md](docs/PHOTO_EVALUATION.md).
- **Automated tests:** unit/API tests and Chromium end-to-end tests mock every Meta request and use no API credit.
- **Not claimed:** the guided check covers monitors only. Other devices go to AI chat. Physical Mac re-verification of the hardware helper, Bluetooth live discovery, Windows/Linux helpers, multi-user hosting and cloud sync are out of scope.
- This is a single-user local MVP. Do not expose the server to the public internet.

## Privacy

- Photos stay in memory unless you explicitly send them for analysis, and they are never saved to storage or JSON.
- Chat sends the current message, up to 12 recent Meta-mode turns and the shareable device and connection records. macOS observations, hardware identities and OS-created records are excluded from every model request.
- The workspace is stored in your browser. See [PRIVACY.md](docs/PRIVACY.md).

## Development

```bash
npm run check            # TypeScript + unit/API tests + production build
npx playwright install chromium
npm run test:e2e         # Chromium UI tests (own servers, empty API key)
npm run test:production  # production server + browser test on separate ports
```

If ports 5173/4318 are in use: `DESKTWIN_TEST_PORT=5187 DESKTWIN_TEST_API_PORT=4337 npm run test:e2e`.

**Project layout:** `src/domain/workspace.ts` is the source of truth (schema, commands, validation). `src/components/` holds the Three.js scene and panels. `server/` holds the local API and the Meta client (`server/meta.ts`). `native/` holds the macOS helper. More in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

Further docs (some are in Korean): [scene editor](docs/SCENE_EDITOR.md) · [storage](docs/STORAGE.md) · [photo review](docs/PHOTO_REVIEW.md) · [photo reference fitting](docs/PHOTO_REFERENCE_FITTING.md) · [hackathon notes](docs/HACKATHON.md) · [submission script](docs/SUBMISSION.md) · [contributing](CONTRIBUTING.md)

## License

Code is [MIT](LICENSE). Scene geometry and pixel textures are generated by this code. No third-party 3D models or user photos are shipped. Icons come from `@phosphor-icons/react`. `libheif-js` (LGPL-3.0) is used for local HEIC conversion, with notices in [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt). The Meta API and each dependency have their own terms.

## API references

- [Meta Chat Completions quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Meta structured output](https://dev.meta.ai/docs/structured-output)
- [Meta image understanding](https://dev.meta.ai/docs/image-understanding)
