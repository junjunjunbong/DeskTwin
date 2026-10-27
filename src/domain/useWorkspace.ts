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
          '저장된 구성을 읽지 못해 예시를 열었습니다. 원본은 새 변경을 저장하기 전까지 유지됩니다.',
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
      setError('브라우저에 저장하지 못했습니다. JSON으로 내보내면 현재 구성을 보관할 수 있습니다.');
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
