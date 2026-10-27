# Privacy and security boundaries

## Default: local-only demo

Starting DeskTwin without a key does not call an external inference API. Even when a key is configured, conversation starts in offline demo mode until the user explicitly enables Meta. The local health request reveals availability and model name, never the key, and does not call Meta.

The local demo uses deterministic pattern matching, not a running language model. It remains visibly labelled as a demo. Photo analysis is a separate opt-in action.

## Storage

- Devices, reported connections, scene objects, transforms, visual evidence notes, appearance, and change history are stored in localStorage under `desktwin.workspace.v1`.
- The document uses schema v2. Existing v1 documents migrate in memory; the old storage key is retained to find existing saves. A user action that saves a change writes the new document.
- Photos, chat messages, and photo description input are held in memory and are not separately persisted in the workspace or included as raw input in exported JSON. Model-derived object names and visual notes are included in an approved scene and can therefore be saved and exported.
- Selecting a photo does not save it to the backend. The browser resizes and re-encodes the image before transmission, stripping image metadata.
- An unapproved scene draft remains in component memory. Preview adjustments do not write localStorage. Applying the reviewed scene saves its structured data, without the photo bytes.
- The API key exists only in the server environment or the local ignored `.env` file. Never use a `VITE_*` variable for a key.
- Browser storage is not encrypted and is shared with scripts running on the same origin. Deleting site data removes the saved workspace; JSON export provides a user-controlled backup.

## External transfer

Enabling Meta conversation permits sending the current message, up to 12 recent messages, and current device and connection records to the official Meta API. Device records include their saved visual properties and notes. Conversation does not automatically send a selected photo.

Photo analysis requires its own consent checkbox and send button. It sends the resized image, optional user description, and current device, connection, and non-device object records. Change history and unrelated UI preferences are omitted from provider context. Selecting, locally previewing, or manually editing a photo or scene does not itself call Meta.

A changed photo requires new consent. Canceling analysis, choosing another photo, or closing the panel prevents an obsolete response from becoming a preview. Browser cancellation does not necessarily cancel an upstream request that the local server already sent. Such a request may finish and may incur provider charges.

Meta's own data handling terms apply after transmission. DeskTwin cannot retract an already sent photo or promise deletion by a third-party provider. Remove private information from a photo before consenting to transmission.

## Local API protections

The server binds to `127.0.0.1`. Hostnames are limited to loopback names. Cross-site requests and mismatched Origin/Host are rejected. The API accepts bounded JSON bodies and validates workspace graphs. It does not accept arbitrary remote image URLs.

Provider requests use HTTPS, the official Meta host, disabled redirects, a timeout, and bounded response size. API keys stay in the server's authorization header. Production responses include a restrictive Content Security Policy and deny framing. The server does not log request bodies, images, device details, API keys, or arbitrary upstream error bodies.

These are local-MVP protections, not a complete security audit. The project has no multi-user authentication or tenant isolation. It is not designed for direct public internet exposure. A malicious program already running on the user's computer is outside this boundary.

## Model output and evidence boundaries

The model receives rules that treat image text, workspace fields, names, and user notes as untrusted data. The photo response has a separate strict schema. It can describe only allowed templates, bounded transforms, six-digit colors, and up to 16 bounded local boxes for a generic object. Extra fields such as code, connections, and operating status are rejected. No model-generated script, shader, shell command, URL, or expression is executed.

Device identity source, visual source, reported topology, and reported operating status remain separate. A photo cannot establish that a hidden cable exists or a device works. New photo devices receive unknown status in application code. Existing user reports and connections are preserved deterministically during scene creation and checked again on approval.

The user sees an editable preview before any saved configuration changes. A stale preview cannot overwrite a newer saved edit. Approval is one undoable workspace replacement. Discarding a preview leaves the saved workspace unchanged.

Schema validation does not prove factual correctness or eliminate prompt injection. A structurally valid arrangement, object name, or explanation can still be wrong. The adapter and user flow have mocked-provider tests; successful live Meta calls and measured visual accuracy are not established by those tests. No OS settings changes, disk formatting, or hardware actuation exists in this implementation.

## Reporting a security issue

Do not include API keys, private images, or unredacted device logs in a public issue. Use GitHub private vulnerability reporting if the repository owner has enabled it. Otherwise, contact the maintainer privately rather than publishing an exploit containing user data.
