# Workspace storage and editing consistency

## Setup and guided-check records

Workspace v2 now accepts `diagnoses`, defaulting to an empty array when reading older saves. The newest 30 attempts are retained, with bounded original route snapshots and append-only answers. An attempt's route, plan, start time, and privacy provenance cannot be rewritten by a later answer. Import validation replays the saved answer sequence; invalid results, dangling device references, and duplicate attempt IDs are rejected. Deleting a referenced device removes its checks in the same undoable command. Removing or replacing an edge retains the earlier check and requires a fresh attempt before continuing on the changed route.

Starting and answering a check writes only check history. `record-diagnosis-result` changes operating status only after explicit confirmation; inside the write lock it verifies the latest attempt, exact resolved session, current route, and current device report. Undoing the report makes the save action available again. Photo previews preserve diagnostic history and devices referenced by those checks.

Connection replacements and hardware matches/removals carry the exact reviewed prior record (or an explicit absence). The command compares it again after acquiring the write lock. A queued change cannot silently replace a newer connection or matching approval. The unchanged legacy sample note has a narrowly defined display translation; it is treated as the same reviewed content, while other note changes still reject stale saves. Add-device and connection dialogs expose storage recovery inside the modal so failed saves do not require discarding entries.

An edited operating status and its note are one report during stale-draft review and saving. Changing status clears the old observation note; unrelated name/model edits adopt the complete current report. Photo setup notes, conversation messages, and unsaved device drafts remain memory-only.

## Save format and compatibility

DeskTwin continues to use the localStorage key `desktwin.workspace.v1`. The value is a plain workspace JSON document, not a new storage envelope. JSON import and export use that same document format, with installation-specific hardware bindings removed.

The current document has `schemaVersion: 2`. Attachment, custom-shape and hardware metadata fields are optional so existing v2 saves remain readable. Existing v1 files are parsed using their original permissive object-key behavior, then migrated in memory: devices keep their IDs, identity, reported state, connections, history, and appearance; visual defaults and editable example furniture are added. Generated example furniture IDs are made unique if a legacy device already uses one of those IDs. Migration does not write storage on page load or on an explicit reload of the saved workspace.

Approved OS matching is an ordinary undoable workspace command. `hardwareBinding` contains the category, opaque identity/stability/scope and approval time; it changes only after review/confirmation. It does not replace a name, model, layout, connection or reported working/issue status. Live observations, active polling state and session tokens are not workspace data.

`portableWorkspace()` removes every device's hardware binding on both JSON export and UI import. Approved labels/models and `hardwareOrigin: 'macos'` are retained. `parseWorkspace()` normalizes imported OS-source provenance; renaming a record or removing its binding does not erase that privacy provenance. A portable import cannot claim that an old installation's hardware match is currently present. The user explicitly matches again.

`modelWorkspace()` applies a stricter projection than export: OS-derived records, incident links and stored history are excluded, as well as all bindings. Therefore a user-controlled export may contain approved device labels that are intentionally absent from automatic model context. See [Privacy](PRIVACY.md).

A successful editing action saves the current document. New custom shapes and attachments require this version of DeskTwin; older builds are not guaranteed to understand newer optional fields even though the document remains v2. Keep an exported original if opening it in an older build is necessary.

Validation remains active for imports and every saved command. Invalid data is not silently accepted as a workspace. When the initial saved document is unreadable, an example is opened and the unreadable original remains until the user saves a new change. If another tab supplies invalid data during the session, loading it fails without replacing the current view or overwriting that data.

## Two tabs and concurrent edits

Each tab remembers the exact saved JSON value from which its current view was loaded. Every write follows this sequence:

1. Join the tab's command queue.
2. Acquire the exclusive `desktwin.workspace.write` Web Lock for the origin.
3. Read storage again and compare it with the tab's expected saved value.
4. Reject the operation if another tab has changed that value.
5. Validate and write the new document, then update the displayed workspace and Undo/Redo state.

The comparison is inside the lock. A comparison performed before waiting for the lock would still permit two tabs to overwrite one another. Commands are evaluated against the current workspace when their turn in the queue begins.

Position, scale, color, and individual box edits carry the specific fields the user changed. Those fields are merged into the latest same-tab state. A queued Z edit therefore preserves an earlier X edit, and a color edit preserves a width change. An explicit return to the original value is still a command; it is not discarded by comparing the request with an old rendered snapshot.

An explicit device-details save carries its original stored name, model, operating status and status note as `expectedDetails`. The command checks these fields against the latest device inside the same serialized write, after acquiring the Web Lock. If an earlier action changed one of those fields while the save was waiting, the save fails and the draft remains available for review. This guard does not reject an unrelated visual or hardware-binding change. The save applies the edited detail fields with the existing source and status-note rules. Untouched record fields retain the reviewed latest values.

Adding, removing, duplicating, or restoring shape parts replaces a whole part array. Such a replacement is rejected if the shape changed after the view used to prepare it; the user can retry against the updated parts. Individual part commands check their expected part count before using an index. A saved drag path is also rejected if its object moved while the drag was waiting in the queue.

A storage event or focus check reveals that another tab has saved a different version. DeskTwin keeps the older tab's current view and shows a conflict notice. The user can export that tab's copy and choose **Load latest saved workspace**. Reload validates the newest document, changes the view only after validation succeeds, and resets that tab's Undo/Redo stacks. It does not merge objects automatically or overwrite the other tab's version.

Undo and Redo use the same lock and comparison as ordinary edits. An old Undo snapshot cannot replace another tab's newer save. Replacing the whole workspace also checks its prepared baseline inside the lock; a photo draft or import cannot overwrite a same-tab command that completed while the replacement was queued.

Web Locks are required for writing. When the browser does not provide them, DeskTwin reports that safe saving requires a supported browser on HTTPS or localhost. It does not fall back to an unprotected write. This protocol coordinates tabs running this implementation on the same origin. An older DeskTwin build or unrelated script that writes directly to the same key without the lock is outside that coordination protocol.

## Undo, failed writes, and confirmation

Undo/Redo retain up to 20 snapshots in tab memory. They are separate from the persisted activity history and are not restored after reloading the page. Reloading another tab's saved workspace clears these local snapshots so they cannot be mistaken for the new version's edit history.

Storage writes happen before the rendered workspace or history stacks change. A rejected command, quota error, or conflict leaves the last saved scene and Undo/Redo state unchanged. Unchanged command results do not write storage or create an Undo step.

Async mutation methods return `Promise<boolean>`. The caller must await success before dismissing a dialog or reporting completion. Photo approval, JSON import, device creation, device-details saving, connection creation/removal, OS-match approval/removal, and diagnostic result saving follow this rule. A failed photo save leaves the editable preview open. Failed device and connection saves retain the user's form entries for correction or retry. A failed diagnostic save does not claim that the reported result was saved.

Photo previews remain in memory and require explicit approval. Their saved baseline and cross-tab conflict state are checked again on approval. Photo bytes are never added to the saved workspace. Selecting a photo or editing an unsaved preview does not transmit it; photo transfer retains its separate consent flow.

## Device drafts and navigation

Device name, model, operating status and status-note drafts are held in an App-owned, per-device memory cache. **View**, **My desk**, device switches, closing/reopening the inspector and opening other panels do not save or discard these fields. **Unsaved device details** identifies the draft; **Resume editing draft** and the draft list return to it. The View inspector and summaries continue to show the saved name, model and report. Typing a working-status draft does not create a saved user report.

**Save device details** applies the edited fields only after a successful storage transaction. **Discard draft** removes that device's draft without changing the saved workspace or Undo history. Each device has its own draft. A pending save disables its fields, remains pending across inspector unmount/reopen, and cannot clear a different device's unsaved work. Failed saves retain the draft and show an error.

The cache has explicit boundaries:

| Event                                                                                                          | Draft behavior                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View/Edit, Home, device selection or panel navigation                                                          | Keep the draft in the current open app; do not save.                                                                                                                        |
| Saved name, model, status or note differs from the draft's baseline, including after a diagnostic save or Undo | Keep the draft and require review against the latest saved details before saving.                                                                                           |
| Another tab saves                                                                                              | Keep the draft and visible copy; block saving until **Load latest saved workspace** resolves the storage conflict. A successful load retains the draft and requires review. |
| JSON import or erasing the desk                                                                                | Keep existing drafts and require review even if a new record has the same ID and detail values.                                                                             |
| A device disappears                                                                                            | Keep its draft for reference or explicit discard. Undo may restore the device, but the draft still requires review before saving.                                           |
| Browser page reload, tab close or app restart                                                                  | The memory cache ends. Save details first if they must persist.                                                                                                             |
| JSON export or automatic model context                                                                         | Include successfully saved workspace data under the existing privacy rules; omit unsaved detail drafts.                                                                     |

**Keep my edited fields after review** accepts the displayed latest record as the new baseline. It preserves fields the user changed and refreshes untouched fields from that record. This step does not save: **Save device details** remains a separate action. The transaction-level `expectedDetails` check still runs if the record changes again while waiting to save.

This cache covers the device-details form. Geometry controls and workspace/object-name fields keep their existing Enter/blur commit behavior. Incomplete numeric input remains available while its selected editor stays mounted across View/Edit; it is not a new persisted or cross-panel geometry draft format.

## Connection editing and confirmation

View exposes recorded connection details, counterpart selection and the connection-line toggle. **Edit connections** enters Edit without saving anything. Add and Remove actions are available only in Edit. Removing a connection first opens **Confirm removal / Cancel removal** inside the fixed inspector. Cancel, or returning to View before confirming, leaves the record unchanged. Confirmation removes only the recorded relationship; it does not control or disconnect hardware. A failed removal leaves the confirmation available with an error. Undo/Redo continue to use the ordinary guarded workspace transactions.

Assistant connection proposals use **Edit to review connection** before **Confirm and apply**. Entering Edit does not approve or apply the proposal. Other proposal, photo and diagnostic approval requirements remain unchanged.

## Mode switches and async test assertions

View/Edit, connection visibility and mobile panel expansion do not write the workspace. Device-detail drafts survive navigation as described above. Geometry editors remain mounted across ordinary View/Edit changes, preserving incomplete numeric text. An already confirmed save may finish after navigation; navigation itself does not confirm a new save.

Browser tests must wait for a saved field or a success indicator that appears after the transaction. A completed Playwright click does not mean that the Web Lock callback has run. The unchanged baseline test read seven devices immediately after Undo, while the later failure snapshot already showed eight. Exact polling for the expected saved value resolves that race without changing the expected result or bypassing the lock. See [Baseline investigation](BASELINE_REGRESSIONS.md).

## Text and decimal inputs

Workspace/object-name fields and numeric geometry inputs keep local text while the user types. A trailing space, `0.`, or a lone minus sign is not forced into the persisted model. Blur or Enter commits a complete valid value; Escape restores the saved value. These names are trimmed at commit, preserving internal spaces. Blank required names and incomplete or out-of-range numbers show validation feedback without changing the saved object. The device-details form uses the separate explicit Save/Discard workflow above.

A commit is not repeated merely because Enter is followed by blur. A different deliberate commit while an earlier save is waiting is still queued; it is not discarded as a duplicate. Responses from older attempts do not erase newer text that the user has started typing. Accepted constrained values are reflected back into the input. JSON export contains the last successfully committed workspace, not incomplete field drafts.

Range controls likewise retain a local draft while saves are pending, including an intentional return to the original value. Their DOM value follows the browser's range step without rounding the saved geometry. Imported uppercase colors are normalized only for the color control. These browser normalizations cannot enqueue a second stale write after the user's intended edit; ordinary change-only color events remain supported.

## Regression coverage

The [original validation record](VALIDATION.md) is retained separately from [PR #4 review reproductions and follow-up verification](PR4_REVIEW_FIXES.md).

`tests/storage.spec.ts` uses real same-context Chromium tabs, localStorage events, and Web Locks. It covers:

- Stale-tab writes, explicit reload, Undo/Redo, and page reload persistence.
- Two writes queued behind a held cross-tab lock with exactly one winner.
- Stale Undo rejection and preservation of invalid external data.
- Blocking unsafe writes when Web Locks are unavailable.
- A photo approval that encounters a quota failure, keeps its preview, and succeeds on retry.
- A prepared replacement queued behind a same-tab edit.
- Device and connection dialogs retaining entered values on failed writes.
- Diagnostic result feedback reporting success only after a successful save.

`tests/hardware.spec.ts` exercises explicit OS match approval, duplicate prevention, Undo/Redo, portable export, reconnect review and stale-tab rejection with fixture observations. `tests/workspace-modes.spec.ts` covers preserved inputs and a save held behind a real Web Lock during a mode switch. These browser fixtures do not validate native Mac APIs.

`tests/device-drafts.spec.ts` covers View/Home/other-panel navigation, independent drafts for multiple devices, saved-status accuracy, another tab's changed record, deletion and Undo, same-ID imports, pending saves across inspector unmount, and a diagnostic result committed ahead of a queued detail save. `tests/connections.spec.ts` checks View inspection, explicit Edit transitions from the inspector/overview/connection guide, inline removal cancellation and confirmation, and Undo. Existing conversation and storage tests keep the separate approval and failed-save assertions.

`tests/inputs.spec.ts` checks normal typing with spaces, intermediate decimal text, validation, Escape, exactly one history step per commit, a second commit while the first waits for a lock, and persistence after reload.

`tests/queued-edits.spec.ts` holds a real Web Lock while editing different position axes, scale axes, color, and box axes. It checks that every intended field survives, including a numeric return to its original value, and that a stale structural shape replacement is rejected without losing the preceding part edit. `src/domain/queuedCommand.test.ts` covers the corresponding command semantics, collision checks, and stale-index/drag rejection independently of the UI.

Run the focused suite with the standard Playwright Chromium installation:

```sh
MODEL_API_KEY='' npm run test:e2e -- tests/storage.spec.ts tests/inputs.spec.ts tests/queued-edits.spec.ts tests/device-drafts.spec.ts tests/connections.spec.ts
```

The development verification also supports the existing `DESKTWIN_CHROMIUM_EXECUTABLE` override. When running multiple Playwright processes, use separate `--output` directories and `PLAYWRIGHT_HTML_OUTPUT_DIR` values to keep one runner from removing another runner's artifacts. The photo test responses are browser fixtures, and the server key is blank. These tests make no real Meta API calls.
