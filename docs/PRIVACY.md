# Privacy and security boundaries

## Default: local-only demo

Starting DeskTwin without a key does not call an external inference API. Even when a key is configured, conversation starts in offline demo mode until the user explicitly enables Meta. The local health request reveals availability and model name, never the key, and does not call Meta.

The local demo uses deterministic pattern matching, not a running language model. It remains visibly labelled as a demo. Photo analysis and local hardware detection have separate opt-in controls. Loading the page or checking bridge availability does not scan hardware.

## Read-only local hardware information

After **Start detection** and the local metadata consent, the Mac helper reads display names/flags and registered USB product/vendor metadata and hierarchy. It does not capture screens, record keys, control devices, open storage contents, send USB transfers or change OS settings. Bluetooth collection is not implemented; the UI reports it unavailable while preserving manually recorded Bluetooth links.

The native process reads an available serial only to derive a minimized installation-specific HMAC identity. Raw serials and raw OS registry identities are not emitted to the browser, logged or included in exported JSON. Failed or incomplete categories become unknown. The service does not substitute synthetic devices when a native query fails.

The ignored `local-data/hardware-identity.key` is created on the local Mac with owner-only permissions when supported detection actually starts. It is separate from any Meta API credential. Changing/deleting that key makes old persistent matches require review. Names, vendor/model codes alone, duplicate serials and placeholder serials do not establish a persistent identity.

Stopping detection stops the tab's reads and revokes the token's start permission. A bridge failure, timeout, expired session or permission denial is not physical disconnection. Detection is polling-based; a brief disconnect/reconnect between reads can go unobserved. See [Mac hardware details](MACOS_HARDWARE.md) for the source APIs and identity limits.

## Storage

- Devices, reported connections, scene objects, attachments, custom box parts, transforms, visual evidence notes, appearance, and change history are stored in localStorage under `desktwin.workspace.v1`. Approved local OS matches add optional `hardwareBinding`; an OS-created device retains `hardwareOrigin` provenance.
- The value is a plain Workspace v2 JSON document without a storage envelope. Existing v1/v2 documents remain readable; v1 documents migrate in memory and the old storage key is retained to find existing saves. A user action that saves a change writes the new document. Generated migration furniture IDs are renamed on collision, preserving existing device IDs and their connection endpoints.
- Photos, chat messages, and photo description input are held in memory and are not separately persisted in the workspace or included as raw input in exported JSON. Model-derived object names and visual notes are included in an approved scene and can therefore be saved and exported.
- Selecting a photo does not save it to the backend. The browser resizes and re-encodes the image before transmission, stripping image metadata.
- An unapproved scene draft remains in component memory. Preview adjustments do not write localStorage. Applying the reviewed scene saves its structured data, without the photo bytes.
- The API key exists only in the server environment or the local ignored `.env` file. Never use a `VITE_*` variable for a key.
- Browser storage is not encrypted and is shared with scripts running on the same origin. Deleting site data removes the saved workspace; JSON export provides a user-controlled backup.
- Live OS observations, capability tokens and native snapshots remain in memory rather than browser workspace history. Export retains approved names/models and provenance but strips `hardwareBinding`; import also strips bindings and requires fresh local matching. Exported labels can still be personal information, so review a file before sharing it.
- View/Edit mode, selection and **Show connections** are transient view state. Toggling it, selecting a connected device, or reading ports/source notes does not modify saved relationships or send data. Hiding lines does not delete the records.

Saving uses an exclusive Web Lock and compares the latest stored JSON inside that lock. A stale tab cannot use photo approval, JSON import or Undo/Redo to overwrite another current-version tab's saved document. Web Locks require a supported HTTPS or localhost browser; if unavailable, saving is blocked and JSON export remains available. This protection does not coordinate older application versions or unrelated scripts that write directly to the same key without the lock.

## External transfer

Enabling Meta conversation permits sending the current message, up to 12 recent Meta-mode messages, and privacy-filtered device and connection records to the official Meta API. Prior local-demo messages are excluded because they may mention a locally detected name. Device records include their saved visual properties and notes. Conversation does not automatically send a selected photo.

Photo analysis requires its own consent checkbox and send button. It sends the resized image, optional user description, and privacy-filtered device, connection, and non-device object records. Change history and unrelated UI preferences are omitted from provider context. Custom box arrays are summarized as part counts and scene-coordinate dimensions before provider transmission to avoid sending thousands of redundant editing records. Selecting, locally previewing, or manually editing a photo or scene does not itself call Meta.

Hardware detection consent never authorizes external transfer. Browser and server use `modelWorkspace()` before transmitting workspace context. That projection removes hardware bindings, OS-derived records, their incident links, dangling attachments and stored change history. OS-derived records remain excluded after renaming or removing their local match; imported OS provenance is retained/normalized. A pre-existing manual record linked to hardware keeps its original manual fields and may still be sent under ordinary Meta consent, without the binding or observation.

No automatic hardware-to-Meta sharing path or hardware-sharing option is implemented. Information deliberately typed into a message or photo description is still sent when the user explicitly submits that input under the corresponding consent. These filters do not infer whether arbitrary free text contains a device name.

A changed photo requires new consent. Canceling analysis, choosing another photo, or closing the panel prevents an obsolete response from becoming a preview. Browser cancellation does not necessarily cancel an upstream request that the local server already sent. Such a request may finish and may incur provider charges.

Meta's own data handling terms apply after transmission. DeskTwin cannot retract an already sent photo or promise deletion by a third-party provider. Remove private information from a photo before consenting to transmission.

## Local API protections

The server binds to `127.0.0.1`. Hostnames are limited to loopback names. Cross-site requests and mismatched Origin/Host are rejected. The API accepts JSON bodies up to 8 MB and validates workspace graphs, attachment references, custom shape bounds and scene proposals. It does not accept arbitrary remote image URLs.

Every hardware endpoint additionally requires `X-DeskTwin-Hardware: 1`. Start/stop/snapshot operations require an unpredictable token bound to the exact allowed origin. A late Start cannot revive an explicitly stopped token. The helper executable path and arguments are fixed in reviewed source; neither an API request nor model-generated content can choose a program or code to execute. The build script compiles only `native/HardwareProbe.swift`, outside the HTTP API.

Provider requests use HTTPS, the official Meta host, disabled redirects, a timeout, and bounded response size. API keys stay in the server's authorization header. Production responses include a restrictive Content Security Policy and deny framing. The server does not log request bodies, images, device details, API keys, or arbitrary upstream error bodies.

These are local-MVP protections, not a complete security audit. The project has no multi-user authentication or tenant isolation. It is not designed for direct public internet exposure. A malicious program already running on the user's computer is outside this boundary.

## Model output and evidence boundaries

The model receives rules that treat image text, workspace fields, names, and user notes as untrusted data. The photo response has a separate strict schema. It can describe only allowed templates, bounded transforms, six-digit colors, and up to 32 bounded local boxes for any allowed device or object. Extra fields such as code, connections, and operating status are rejected. No model-generated script, shader, shell command, URL, or expression is executed.

Device identity source, visual source, reported topology, reported operating status and live OS recognition remain separate. An online display or enumerated USB device is not automatically working. OS USB ancestors are not copied into the user cable graph, and the application does not infer HDMI paths or a display-to-dock relationship. A photo cannot establish that a hidden cable exists or a device works. New photo devices receive unknown status in application code. Existing user reports and connections are preserved deterministically during scene creation and checked again on approval.

The visible connection arcs illustrate saved relationships, including example and inferred records. Their endpoints use the rendered geometry for readability; they do not locate physical ports, trace cable routes or report electrical connectivity. A selected device highlights counterparts from the stored graph. This emphasis is not hardware verification. The inspector identifies both entered ports and the source of each record separately from the device's operating status.

Photo record matching is a visual suggestion. If a candidate could duplicate a retained same-type device and no unambiguous match exists, the preview requires an explicit existing-record or separate-new-device choice before enabling approval. Original sample IDs that are endpoints of user-recorded connections are retained. Resolving a match does not turn image inference into verified identity or create a connection claim.

The user sees an editable preview before any saved configuration changes. A stale preview cannot overwrite a newer saved edit. Cross-tab Web Locks and an in-lock comparison protect browser writes; a rejected save preserves the prior workspace and keeps the approval flow open. Approval is one undoable workspace replacement. Discarding a preview leaves the saved workspace unchanged.

Schema validation does not prove factual correctness or eliminate prompt injection. A structurally valid arrangement, object name, or explanation can still be wrong. The adapter and user flow have mocked-provider tests; successful live Meta calls and measured visual accuracy are not established by those tests. No OS settings changes, disk formatting, or hardware actuation exists in this implementation.

## Test isolation

Browser E2E tests launch their own server with an explicitly empty `MODEL_API_KEY`. They do not reuse a running developer server. `DESKTWIN_TEST_PORT` and `DESKTWIN_TEST_API_PORT` allow the test process to run alongside another checkout without touching that checkout's server. The production smoke test also launches a separate blank-key server. Photo and conversation responses used for browser tests are fixtures or mocked failures. Hardware service/browser tests use explicit fixtures; the production source invokes real native APIs only on macOS after consent. A passing fixture test does not establish native compilation, actual Mac hardware recognition, hot-plug/permission behavior, a real Meta request, billing configuration or photo quality.

## Reporting a security issue

Do not include API keys, private images, or unredacted device logs in a public issue. Use GitHub private vulnerability reporting if the repository owner has enabled it. Otherwise, contact the maintainer privately rather than publishing an exploit containing user data.
