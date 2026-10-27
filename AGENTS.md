# DeskTwin engineering guide

- Preserve the hero-desk design: the room scene is primary, panels are contextual.
- Source of truth is `src/domain/workspace.ts`; validate imported and model-generated data.
- A photo, reported cable, and working device are different claims. Never label sample data or model inference as verified.
- Changes proposed by AI require explicit user confirmation. No shell execution, automatic settings changes, or destructive storage tests.
- Keys stay server-side in `.env`; never use `VITE_*` for secrets. Photos stay in memory unless explicitly sent for analysis.
- Work in small coherent commits. Run `npm run check` before each commit; run browser tests for UI changes.
- Keep external integrations and manual-test gaps explicit in docs. Do not claim an untested API works.
- Do not publish the repository, deploy publicly, or spend on API calls without appropriate user authorization.
