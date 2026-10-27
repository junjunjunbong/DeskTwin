import { useRef, useState } from 'react';
import {
  applyCommand,
  applyProposal,
  createDemoWorkspace,
  parseWorkspace,
  type Proposal,
  type Source,
  type Workspace,
  type WorkspaceCommand,
} from './workspace';
export const STORAGE_KEY = 'desktwin.workspace.v1';
export function useWorkspace() {
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return {
        workspace: raw ? parseWorkspace(JSON.parse(raw)) : createDemoWorkspace(),
        error: '',
      };
    } catch {
      return {
        workspace: createDemoWorkspace(),
        error:
          'Could not read the saved workspace, so an example was opened. The original remains until you save a new change.',
      };
    }
  });
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const current = useRef(workspace);
  const past = useRef<Workspace[]>([]);
  const future = useRef<Workspace[]>([]);
  const [error, setError] = useState(initial.error);
  function store(next: Workspace) {
    current.current = next;
    setWorkspace(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setError('');
    } catch {
      setError('Could not save in your browser. Export as JSON to keep the current workspace.');
    }
  }
  function replace(next: Workspace) {
    const validated = parseWorkspace(next);
    past.current = [...past.current.slice(-19), current.current];
    future.current = [];
    store(validated);
  }
  return {
    workspace,
    error,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    command: (c: WorkspaceCommand) => replace(applyCommand(current.current, c)),
    proposal: (p: Proposal, source?: Source) => replace(applyProposal(current.current, p, source)),
    replace,
    undo: () => {
      const previous = past.current.pop();
      if (previous) {
        future.current.push(current.current);
        store(previous);
      }
    },
    redo: () => {
      const next = future.current.pop();
      if (next) {
        past.current.push(current.current);
        store(next);
      }
    },
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
