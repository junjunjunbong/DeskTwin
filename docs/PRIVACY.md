# Privacy and security boundaries

## Default: local-only demo

Starting DeskTwin without a key does not call an external inference API. Even when a key is configured, the conversation starts in offline demo mode until the user explicitly enables Meta. The health request is local and reveals only availability/model name, never the key.

The local demo is deterministic pattern matching, not a running language model. It must remain visibly labelled as such.

## Storage

- Workspace devices, reported connections, appearance and change history are stored under `desktwin.workspace.v1` in localStorage.
- Photos and chat messages are held in memory and are not included in exported JSON.
- Photos are not saved to the backend or committed. The browser re-encodes the selected image, stripping metadata, before transmission.
- The API key exists only in server environment / the local ignored `.env` file. Never use a `VITE_*` key variable.
- Browser storage is not encrypted and is shared with scripts running on the same origin. Do not use the same origin for untrusted applications.
- Deleting browser site data removes the local workspace. Export JSON first if a backup is needed.

## External transfer

Enabling Meta conversation permits sending the current message, up to 12 recent messages, and current device/connection records to the official Meta API. Photo analysis has its own per-selection consent checkbox and send button. Selecting a file does not itself send it.

Photo analysis also sends current device records to reduce duplicate candidates. Remove private information from photos before sending. Meta's own data handling terms apply after transmission; DeskTwin cannot undo an already sent request or promise deletion by a third-party provider.

## Local API protections

The server binds to `127.0.0.1`. Hostnames are limited to loopback names. Cross-site requests and mismatched Origin/Host are rejected. The API only accepts bounded JSON bodies and validates workspace graphs. It permits no user-supplied remote image URLs. Provider requests use HTTPS, the official Meta host, no redirects, a timeout and bounded response size.

Production responses include a restrictive Content Security Policy and deny framing. The server does not log request bodies, images, device details, API keys or arbitrary upstream error bodies.

These are local-MVP protections, not a complete security audit. This project has no multi-user authentication or tenant isolation. Do not expose it directly to the public internet. A malicious program already running on the user's computer is outside this boundary.

## Model safety and reliability

The model receives system rules about untrusted workspace/image content and source boundaries. Structured output and reference validation constrain the proposed changes. Photo replies may only propose adding devices. User confirmation is still required.

Schema validation does not prove factual correctness or eliminate prompt injection. Free-text advice and valid-looking proposals may still be wrong. The UI must retain uncertainty and ask the user to verify. No model-controlled shell execution, OS settings changes, disk formatting or hardware actuation exists in this MVP.

## Reporting a security issue

Do not include API keys, private images or unredacted device logs in a public issue. Use GitHub private vulnerability reporting if enabled by the repository owner. Until it is enabled, contact the maintainer privately rather than publishing a working exploit with user data.
