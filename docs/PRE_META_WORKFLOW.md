# Pre-Meta workflow completion — 2026-10-31 KST

This change completes the bounded setup-to-monitor-check workflow before live model testing. It does not claim that the Meta API, photo recognition quality, or new physical Mac tests have been verified.

## Implemented workflow

- Photo approval offers **Continue to connections** while retaining the user's description in memory. The setup guide compares photo, manual, sample, and optional local OS evidence without merging identities automatically.
- Missing-connection questions prioritize monitors and docks. A narrow local helper proposes only clear two-device connection reports; the user reviews endpoints, connector, ports, and unknowns before saving. Replacing an existing edge requires explicit review in setup, manual entry, and assistant proposals.
- Monitor checks use the recorded direct/dock route. Users confirm the route and, before a bypass test, compatible ports/cables. Failed and skipped checks lead to different next steps. The last 30 attempts and answers survive navigation/reload; changed topology requires a new attempt while preserving earlier evidence.
- A successful answer does not change operating status automatically. Saving its user-reported result checks the exact session, route, and latest report inside the storage transaction. Undo restores the result-save action.
- Conversation has an explicit target and a current recorded-path display. Eligible diagnostic summaries inform local demo replies and the prepared Meta request. OS-origin devices, edges, checks, observations, and matching identities remain excluded. Generic prompts do not interpolate OS names; locally produced errors are labelled local notices and are not forwarded in model history.
- Status and note drafts are reviewed as one report. Connections and local hardware matches/removals validate the reviewed prior snapshot again when saving. Add-device/connection dialogs preserve entries and expose recovery controls when another tab has changed the workspace.

## Verification

Environment: macOS, Node.js 22.22.3, npm 10.9.8, locked dependencies, Chromium through Playwright. All application/test processes used an empty `MODEL_API_KEY`; model and hardware paths used synthetic fixtures or injected transports. No native scan, live Meta request, public deployment, upload, or repository visibility change was performed.

Final integrated checks:

- `npm run check`: TypeScript, **259/259 unit/API tests** across 14 files, and production build passed.
- Chromium full suite: **98/103 passed** in the first frozen-source run, with no retries or skips. Five tests still expected the earlier UI/storage behavior: resetting already closes Settings; the Type field needs its accessible combobox selector; diagnosis starts/answers now persist; and Describe a connection opens setup instead of sending a made-up report. These tests were corrected without changing application code. The five cases plus an expanded photo-to-result case then passed **6/6**, covering all **103 distinct browser cases** across the two runs. This is not a claim of a single all-green full-suite run.
- The expanded case completes synthetic photo approval → reviewed monitor/dock and dock/laptop connections → route-aware check → separate result confirmation → selected-device conversation that uses the saved answers. It checks that the photo is absent from storage and conversation alone changes no records.
- `npm run test:production`: passed; WebGL available, no browser errors, CSP present, invalid input rejected.
- `npm run format:check` and `git diff --check`: passed. Desktop diagnostic history and mobile setup screenshots were inspected.

Local artifacts: `/tmp/desktwin-pre-meta-report` and `/tmp/desktwin-pre-meta-results` retain the first full run and its failures; `/tmp/desktwin-pre-meta-followup-report` and `/tmp/desktwin-pre-meta-followup-results` retain the six successful follow-up cases. Temporary artifacts are not part of the repository.

Early focused runs are retained separately: setup 4/4 and path-domain 8/8 passed. One path browser run and one draft/connection case saw React hook-refresh errors immediately after concurrent App hot updates. A separate two-tab replacement case exposed a real modal-recovery issue, which was fixed by placing recovery controls inside the dialog. These early runs are not counted as a clean final browser result.

Reproduce without a provider key:

```bash
MODEL_API_KEY='' npm run check
MODEL_API_KEY='' DESKTWIN_TEST_PORT=5190 DESKTWIN_TEST_API_PORT=4390 \
  PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/desktwin-pre-meta-report \
  npm run test:e2e -- --retries=0 --output=/tmp/desktwin-pre-meta-results
MODEL_API_KEY='' npm run test:production
npm run format:check
git diff --check
```

The focused follow-up used separate ports 5191/4391, `--retries=0`, and this test filter:

```text
resetting the workspace|adding a device can recover|a failed diagnostic save|a reported issue opens|conversation proposals require|photo approval carries
```

Keep source files unchanged during the full browser run; hot updates can invalidate React state and contaminate results. Ports and outputs must be isolated from other runners.

## Remaining external validation and limits

Live Meta authentication/model availability, strict structured output compatibility, photo quality, response latency, and cost need a separately approved real-model test. A fake transport only establishes application behavior. Physical Mac reconnect/hot-plug and multiple-machine behavior remain manual tests; existing native-probe history is separate from this change's synthetic matching tests.

The local setup-note helper is intentionally limited, and troubleshooting covers monitors with recorded direct/dock paths, not arbitrary autonomous diagnosis. OS recognition does not prove cabling or operation. Multiple simultaneous cables per device pair, Bluetooth live discovery, Windows/Linux helpers, precise room reconstruction, cloud sync, and a packaged signed application remain outside this implementation. Submission video, publication review, and official submission are separate work.
