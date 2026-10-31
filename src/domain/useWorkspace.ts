import { useEffect, useRef, useState } from 'react';
import {
  applyProposal,
  createDemoWorkspace,
  parseWorkspace,
  type Proposal,
  type ProposalReview,
  type Source,
  type Workspace,
  type WorkspaceCommand,
} from './workspace';
import { applyQueuedCommand } from './queuedCommand';

// Keep the original key and the plain workspace JSON format for existing saves.
export const STORAGE_KEY = 'desktwin.workspace.v1';
const WRITE_LOCK = 'desktwin.workspace.write';
const CONFLICT_MESSAGE =
  'This workspace was saved in another tab. Your view has been kept. Export this copy if needed, then reload the latest saved workspace before editing.';
const LOCK_MESSAGE =
  'Safe saving requires a browser with Web Locks on HTTPS or localhost. Open DeskTwin there to edit; you can still export this workspace.';

export function useWorkspace() {
  const [initial] = useState(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      return {
        raw,
        workspace: raw ? parseWorkspace(JSON.parse(raw)) : createDemoWorkspace(),
        error: '',
      };
    } catch {
      return {
        raw,
        workspace: createDemoWorkspace(),
        error:
          'Could not read the saved workspace, so an example was opened. The original remains until you save a new change.',
      };
    }
  });
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const current = useRef(workspace);
  const expectedRaw = useRef(initial.raw);
  const past = useRef<Workspace[]>([]);
  const future = useRef<Workspace[]>([]);
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState(initial.error);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function observeLatest() {
      try {
        // A queued older event must not mark our newer successful write as stale.
        if (localStorage.getItem(STORAGE_KEY) !== expectedRaw.current) {
          setConflict(true);
          setError(CONFLICT_MESSAGE);
        }
      } catch {
        setError('Browser storage is unavailable. Export this copy to keep your workspace.');
      }
    }
    function storageChanged(event: StorageEvent) {
      if ((event.key === STORAGE_KEY || event.key === null) && event.storageArea === localStorage)
        observeLatest();
    }
    window.addEventListener('storage', storageChanged);
    window.addEventListener('focus', observeLatest);
    // Cover a change between the initial read and subscription.
    observeLatest();
    return () => {
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', observeLatest);
    };
  }, []);

  function enqueue(operation: () => boolean): Promise<boolean> {
    const result = queue.current.then(async () => {
      if (!navigator.locks?.request) {
        setError(LOCK_MESSAGE);
        return false;
      }
      setSaving(true);
      try {
        // Comparison and write share a cross-tab exclusive lock. A check before
        // awaiting this lock would still allow two tabs to overwrite each other.
        return await navigator.locks.request(WRITE_LOCK, operation);
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message
            ? cause.message.split('\n')[0]
            : 'Could not save in your browser. Export this copy to keep your workspace.',
        );
        return false;
      } finally {
        setSaving(false);
      }
    });
    // Commands are evaluated after the preceding operation updates the refs.
    queue.current = result.then(() => undefined);
    return result;
  }

  function mutate(
    build: () => Workspace | undefined,
    history: 'replace' | 'undo' | 'redo',
  ): Promise<boolean> {
    return enqueue(() => {
      let latest: string | null;
      try {
        latest = localStorage.getItem(STORAGE_KEY);
      } catch {
        setError('Browser storage is unavailable. Export this copy to keep your workspace.');
        return false;
      }
      if (latest !== expectedRaw.current) {
        setConflict(true);
        setError(CONFLICT_MESSAGE);
        return false;
      }
      const proposed = build();
      if (!proposed) return true;
      const next = parseWorkspace(proposed);
      const raw = JSON.stringify(next);
      if (raw === JSON.stringify(current.current)) return true;
      try {
        localStorage.setItem(STORAGE_KEY, raw);
      } catch {
        setError('Could not save in your browser. Your previous saved workspace is unchanged.');
        return false;
      }
      // A failed write cannot consume an Undo step or make an unsaved scene look saved.
      if (history === 'undo') {
        past.current.pop();
        future.current.push(current.current);
      } else if (history === 'redo') {
        future.current.pop();
        past.current = [...past.current.slice(-19), current.current];
      } else {
        past.current = [...past.current.slice(-19), current.current];
        future.current = [];
      }
      expectedRaw.current = raw;
      current.current = next;
      setWorkspace(next);
      setConflict(false);
      setError('');
      return true;
    });
  }

  function reloadLatest(): Promise<boolean> {
    return enqueue(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      let latest: Workspace;
      try {
        latest = raw ? parseWorkspace(JSON.parse(raw)) : createDemoWorkspace();
      } catch {
        setConflict(true);
        setError(
          'The latest saved workspace is invalid. Your view and the saved data were kept. Export your copy before repairing or importing a replacement.',
        );
        return false;
      }
      // Loading or migrating is read-only. Do not rewrite an old save here.
      expectedRaw.current = raw;
      current.current = latest;
      past.current = [];
      future.current = [];
      setWorkspace(latest);
      setConflict(false);
      setError('');
      return true;
    });
  }

  function replace(next: Workspace, expectedBase: Workspace = workspace): Promise<boolean> {
    const base = JSON.stringify(expectedBase);
    return mutate(() => {
      // A prepared import/photo draft must not overwrite a same-tab command
      // that was queued ahead of it while this rendered view was still current.
      if (JSON.stringify(current.current) !== base)
        throw new Error(
          'The workspace changed before this replacement could be saved. Review the latest scene and try again.',
        );
      return next;
    }, 'replace');
  }

  return {
    workspace,
    error,
    conflict,
    saving,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    command: (command: WorkspaceCommand) =>
      mutate(() => applyQueuedCommand(current.current, workspace, command), 'replace'),
    proposal: (proposal: Proposal, source?: Source, review?: ProposalReview) =>
      mutate(() => applyProposal(current.current, proposal, source, review), 'replace'),
    replace,
    undo: () => mutate(() => past.current.at(-1), 'undo'),
    redo: () => mutate(() => future.current.at(-1), 'redo'),
    reloadLatest,
  };
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
