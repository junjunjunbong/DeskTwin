import { applyCommand, type Workspace, type WorkspaceCommand } from './workspace';

/** Apply granular edits to the latest same-tab state; reject stale structural replacements. */
export function applyQueuedCommand(
  current: Workspace,
  rendered: Workspace,
  command: WorkspaceCommand,
): Workspace {
  if ('id' in command) {
    const fromView = [...rendered.devices, ...rendered.objects].find(
      (item) => item.id === command.id,
    );
    const latest = [...current.devices, ...current.objects].find((item) => item.id === command.id);
    if (
      (command.type === 'update-object' || command.type === 'update-device') &&
      command.patch.parts !== undefined
    ) {
      // Add/remove/duplicate/template conversion supplies a whole array. Unlike
      // an explicit update-part, it cannot be merged safely with an intervening edit.
      if (
        !fromView ||
        !latest ||
        fromView.kind !== latest.kind ||
        fromView.shapeMode !== latest.shapeMode ||
        JSON.stringify(fromView.parts ?? []) !== JSON.stringify(latest.parts ?? [])
      )
        throw new Error(
          'The shape changed before this replacement could be saved. Review its latest parts and try again.',
        );
    }
    if (
      command.type === 'update-part' &&
      (!fromView ||
        !latest ||
        fromView.kind !== latest.kind ||
        fromView.shapeMode !== latest.shapeMode)
    )
      throw new Error(
        'The shape changed before this part edit could be saved. Select the part again and retry.',
      );
    if (
      command.type === 'move-object' &&
      command.dragPath &&
      (!fromView ||
        !latest ||
        JSON.stringify(fromView.placement) !== JSON.stringify(latest.placement))
    )
      throw new Error(
        'The object moved while this drag was waiting to save. Try dragging again from its latest position.',
      );
  }
  return applyCommand(current, command);
}
