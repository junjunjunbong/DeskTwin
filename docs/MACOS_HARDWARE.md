# Read-only Mac hardware detection

DeskTwin can read actual display and USB metadata from the Mac running its local API server. Detection is off by default. Opening the application or checking availability does not scan hardware. A user must review the local-data notice and explicitly start detection.

**Validation boundary:** the native implementation uses real macOS APIs. This change was developed in Linux; compiling the Swift helper, OS permission behavior and actual hardware hot-plug behavior have **not** been tested on a Mac. Passing fixture-based service/API/browser tests is not evidence of native hardware success. Complete the Mac checklist below before the hackathon demonstration.

## Build and run on a Mac

Requirements: macOS 12 or later, Node.js 22.12 or later, and Apple Xcode Command Line Tools. The helper is built for the architecture of the current Mac. Build it again when moving the checkout to another architecture.

```bash
# In your authenticated checkout of DeskTwin's PR branch:
npm ci

# If Apple Command Line Tools are not already installed, run this yourself:
xcode-select --install

# Compile only the reviewed native/HardwareProbe.swift source:
npm run hardware:build

# Keep the paid Meta API disabled for the hardware demonstration:
MODEL_API_KEY='' npm run dev
```

Open **http://127.0.0.1:5173** on that Mac. Open the hardware detection panel, read the notice describing which metadata is read locally, check its consent control, and select **Start detection**. The native helper is not started until this action. Use **Stop detection** to stop this tab's session. Detection in another tab has a separate consent session.

If the usual ports are occupied, use a separate pair without stopping another checkout:

```bash
MODEL_API_KEY='' DESKTWIN_WEB_PORT=5187 PORT=4337 npm run dev
# Open http://127.0.0.1:5187
```

Production uses the same local bridge:

```bash
npm run build
MODEL_API_KEY='' npm start
# Open http://127.0.0.1:4318
```

The executable is `build/desktwin-hardware-probe`. It has no user-supplied arguments or commands and is invoked only by the local server. The server supplies a local identity key through a pipe. Running the helper directly without that protocol does not produce a snapshot. Rebuilding it does not enable detection or modify the saved workspace.

## What the OS observation means

| Category             | Native source                                                                                                          | What is shown                                                                                                                                | What remains unknown                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Displays             | CoreGraphics `CGGetOnlineDisplayList`, display metadata functions, and AppKit `NSScreen`                               | Online display list, available display name, vendor/model codes, pixel dimensions, active-for-drawing, mirrored, sleeping and built-in flags | Whether pixels are visibly correct, cable quality, actual HDMI/DisplayPort cable routing, the monitor's physical dock parent, all peripheral functions                                   |
| USB devices and hubs | IOKit `IOServiceGetMatchingServices`, registry properties and `IORegistryEntryGetParentEntry` in the `IOService` plane | OS-registered USB devices, available product/vendor names, vendor/product IDs, USB class and nearest enumerated USB ancestor                 | Whether data transfer/storage/audio/video works; power delivery; cable capabilities; physical port numbers not supplied by the OS; Thunderbolt-only devices without USB registry entries |
| Bluetooth            | Not collected                                                                                                          | An explicit **Unavailable** explanation; existing manually recorded Bluetooth connections remain visible                                     | Current pairing, connection, battery or signal status. Bluetooth detection is not implemented or claimed verified in this helper                                                         |

An OS USB hierarchy is displayed with its IOKit source. It is not inserted into the user's recorded connection graph and does not create a physical cable claim. A multi-function dock can expose several USB entries, including hubs; they remain separate observations. DeskTwin does not guess that entries with similar names are the same dock or merge them into one object.

Display “online” includes active, mirrored and sleeping displays; “active” specifically means available for drawing. Both are OS metadata, separate from a user report that a monitor is working. An online monitor can still have a reported issue. USB enumeration also does not prove a device's features work.

The native helper rejects incomplete reads. A changed display count, a display no longer online at the end of the read, an invalidated USB iterator, or a failed USB property-table read makes that category unknown until another successful check. USB property tables are read into the helper's memory for a consistent snapshot; only the explicit name/model/manufacturer/class allowlist and keyed identity digest are emitted. The helper does not open a USB device or send requests to it.

The panel refreshes by polling approximately every five seconds while enabled. Each fresh native probe is a bounded one-shot query; it does not hold a device open, install a driver, capture a screen, record keys, change settings or send control transfers. A sleeping/throttled tab may miss very short disconnect/reconnect events between polls. No polling-based detector can establish identity continuity through an unobserved interval for a device without a trustworthy identifier.

## Matching observations to the desk

Detection itself never changes the saved desk. Select an observation, explicitly choose an existing record or a separate new device, review the choice, and confirm it. Existing names, placement, visual source, recorded connections and user-reported operating status remain intact. New records start with an unknown user-reported operating status.

Names are display labels, never automatic matching keys. A unique available hardware serial together with vendor/model information can provide a persistent identity. The native process converts it to an installation-specific HMAC before emitting JSON; the serial itself is not emitted, logged or stored. Duplicate identifiers in the same scan are downgraded to session identities. Vendor/model codes alone and a missing or placeholder serial are never treated as persistent identities.

An observation without a unique usable serial has a **session identity**. Reconnecting after an observed removal, restarting detection, restarting the bridge, or losing the category's ability to check invalidates that identity. The user must choose a match again. Moving a USB device without a serial to another port commonly creates a new registry identity and requires matching again. Identical names are still separate devices.

Persistent identities are scoped to the current local installation key. Reconnecting a uniquely identified device may restore its existing approved mapping. Deleting `local-data/hardware-identity.key`, moving to a different installation, or restoring a portable export requires user matching again. Successful snapshots include the installation scope even when no devices are present, so the UI can distinguish a different installation from a successfully checked missing device. Manufacturer-provided serials can themselves be faulty or reused; a persistent match is not a cryptographic proof of physical identity. CoreGraphics serial sentinels (`0` and `0xFFFFFFFF`) and common placeholder USB serials do not qualify as persistent identities.

Only local approved mapping metadata is stored with the browser workspace. Live snapshots, local session tokens and raw native identifiers are not part of workspace history. JSON export retains the approved device name/model and privacy provenance, but excludes hardware bindings and live observations. The model context also omits records created from OS observations and connections involving those records, including after a rename or unlink; it clears stored history because older text may contain an OS-derived name. Existing manually entered records linked to an observation remain ordinary manual records, with their hardware binding and observations excluded from model context. Linking an observation does not grant consent to send detection information to Meta. This implementation provides no automatic hardware-to-Meta transfer.

## Stopped, unknown and absent are different

| Situation                                                                                 | UI meaning                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Detection has not started or was stopped                                                  | **Detection stopped**; presence unknown                                               |
| Server stopped, helper missing, timeout, malformed native response or disconnected bridge | **Status unavailable / Unknown**; previous confirmation time retained where available |
| A category is permission-denied or otherwise fails                                        | Only that category becomes unknown. Other successfully read categories can continue   |
| This tab has not polled for 20 seconds                                                    | Its lease stops; explicit Start is required to resume                                 |
| A category completes successfully and a previously approved stable match is absent        | **Not detected** for that category at that successful check time                      |
| A serial-less identity cannot be safely resumed                                           | **Match again / Unknown**; choose the corresponding observation explicitly            |

“Not detected” is never derived from an unavailable category, a stopped bridge or an expired lease. Snapshots do not promote user-reported state to working and do not overwrite user-reported issues.

## Local API and privacy boundaries

The existing server remains bound to `127.0.0.1`. Production and development proxy requests must pass the existing loopback Host and exact Origin checks; no CORS access is enabled. Every hardware endpoint also requires `X-DeskTwin-Hardware: 1`, and private start/stop/snapshot calls require an unpredictable per-tab token in `X-DeskTwin-Hardware-Token`. Tokens are bound to the request origin and stay in browser memory.

An explicit Stop permanently revokes that token's ability to start detection. A previously sent Start request that arrives after Stop is rejected, so request reordering cannot silently restart a native scan. The old token may still read its stopped snapshot. A later explicit Start obtains a fresh capability; this does not affect another tab's session or the installation-specific identity key.

| Endpoint                 | Method                     | Effect                                                                            |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------- |
| `/api/hardware/session`  | GET                        | Return this tab's capability and token; do not read hardware                      |
| `/api/hardware/start`    | POST `{ "consent": true }` | Explicitly start this token's local session and return a validated snapshot       |
| `/api/hardware/snapshot` | GET                        | Refresh an enabled session with bounded polling; never start a stopped session    |
| `/api/hardware/stop`     | POST `{}`                  | Revoke this token's start permission, abort pending work and return stopped state |

Requests cannot choose an executable path, command, source code, native arguments or system setting. The fixed compiler build command is run by the developer, not exposed as an API. Native output is bounded and validated against a strict schema. Arbitrary native error output and request bodies are never copied into logs or error responses. Failed queries cannot return synthetic “detected” fixtures.

The ignored `local-data/hardware-identity.key` is a random 32-byte local key created only when detection actually starts on a supported installation. It is written with owner-only file permissions; the enclosing directory is owner-only when created by the bridge. It is not a serial, account token or API key, and is not shared with external services. Replacing it invalidates old mappings. Anyone already able to run arbitrary code under the same local OS account is outside this local-MVP security boundary.

## Mac demonstration checklist (not completed in Linux)

1. Build successfully with `npm run hardware:build`. Record the Mac model, macOS version and architecture in the validation notes, without serial numbers. Start with `MODEL_API_KEY=''`.
2. Before consent, confirm detection says stopped and no OS observations appear. Enabling detection should show CoreGraphics and IOKit sources with the last successful check time. Bluetooth must say unavailable.
3. Compare display names/counts with macOS System Settings → Displays. Check built-in, external, mirrored and sleeping cases where available. “Active for drawing: No” for a mirrored/sleeping display must not become a user issue or absence claim.
4. Connect/remove an external display. Within the polling interval, successful display snapshots should change. An approved persistent mapping should become not detected only after a successful scan missing it; reconnect should match only if the identity is stable.
5. Connect a USB hub/dock and a peripheral through it. Compare the visible USB hierarchy against System Information → USB. Check the nearest USB ancestor and IOKit source; no display-to-dock cable should be invented.
6. Remove/reconnect the USB peripheral, then change ports. Test a device with no unique serial, if available: after an observed removal the UI must ask for a new match, not silently reuse a name. Test two same-name peripherals to ensure explicit separate choices and no auto merge.
7. Select an observation and cancel the mapping confirmation. The saved workspace must remain unchanged. Approve a match to an existing object and verify its name, position, reported issue and recorded connections are preserved. Add another as a new device and verify user-reported status remains unknown.
8. Stop detection. Previously observed devices must become stopped/unknown, not physically disconnected. Start again. Stop the local API server and verify the UI reports unavailable, then restart the server and require a fresh session.
9. To check a permission failure without changing system privacy settings, stop detection, temporarily remove the helper executable's execute permission, start detection and confirm unavailable (never “not detected”), then restore permission and retry. Real macOS registry permission denial still needs validation on a Mac configured to deny it; tests exercise this response with fixtures.
10. Test two tabs with independently enabled detection. Stop one tab; the other should continue. Let a tab stop polling for more than 20 seconds (e.g. suspend its JavaScript); it must return stopped and require Start rather than silently resume.
11. Confirm work remains local using the browser Network panel. Only same-origin `/api/hardware/*` calls should occur. Export JSON and verify no `hardwareBinding`, raw serial, hardware token or live snapshot. Confirm linking/removing a match participates in normal Undo/Redo and stale-tab save protection.
12. Report these results separately from automated fixture tests. Do not label native detection validated until steps 1–8 have run on actual hardware; record any denied/unavailable APIs exactly as observed.

## Official API references

- [CoreGraphics online display list](<https://developer.apple.com/documentation/coregraphics/cggetonlinedisplaylist(_:_:_:)>) — online includes active, mirrored and sleeping displays.
- [Quartz Display Services](https://developer.apple.com/documentation/coregraphics/quartz-display-services) — the metadata getters used here; display capture and configuration mutation APIs are not used.
- [AppKit NSScreen](https://developer.apple.com/documentation/appkit/nsscreen) and [localizedName](https://developer.apple.com/documentation/appkit/nsscreen/localizedname) — available display labels.
- [CGDisplaySerialNumber](<https://developer.apple.com/documentation/coregraphics/cgdisplayserialnumber(_:)>) — missing and unavailable serial sentinels; vendor/model context for identity.
- [IOServiceGetMatchingServices](https://developer.apple.com/documentation/iokit/1514494-ioservicegetmatchingservices) — enumerate registered services.
- [IORegistryEntryGetParentEntry](https://developer.apple.com/documentation/iokit/1514454-ioregistryentrygetparententry) — retrieve a parent in a registry plane; this is an OS tree, not a cable-path measurement.
- [IOIteratorIsValid](https://developer.apple.com/documentation/iokit/1514556-ioiteratorisvalid) — detect incomplete enumeration when the registry changes during a read.
- [IORegistryEntryCreateCFProperties](https://developer.apple.com/documentation/iokit/1514310-ioregistryentrycreatecfpropertie) — read an instantaneous metadata table with an explicit return code.
