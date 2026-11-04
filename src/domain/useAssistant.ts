import { useEffect, useRef, useState } from 'react';
import { modelWorkspace } from './workspacePrivacy';
import { demoReply } from './demoAssistant';
import { assistantTargetIsLocalOnly } from './assistantContext';
import { AssistantResponseSchema, type Proposal, type Workspace } from './workspace';
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals: Proposal[];
  mode?: 'demo' | 'meta';
  focusDeviceId?: string | null;
  sharedWithMeta?: boolean;
  kind?: 'reply' | 'notice';
};
export function useAssistant(workspace: Workspace) {
  const [targetDeviceId, setTargetDeviceId] = useState<string | null>(null);
  const targetDevice = workspace.devices.find((device) => device.id === targetDeviceId) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'applied' | 'dismissed'>>({});
  const [available, setAvailable] = useState(false);
  const [photoTwoStage, setPhotoTwoStage] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [healthCheck, setHealthCheck] = useState(0);
  const [healthState, setHealthState] = useState<'checking' | 'ready' | 'offline'>('checking');
  const mode: 'demo' | 'meta' = enabled && available ? 'meta' : 'demo';
  useEffect(() => {
    let active = true;
    setHealthState('checking');
    fetch('/api/health', { signal: AbortSignal.timeout(4000) })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable');
        const data = await response.json();
        if (!active) return;
        setAvailable(data.mode === 'meta');
        setPhotoTwoStage(data.photoTwoStage === true);
        setModel(typeof data.model === 'string' ? data.model : null);
        setHealthState('ready');
        if (data.mode !== 'meta') setEnabled(false);
      })
      .catch(() => {
        if (active) {
          setAvailable(false);
          setPhotoTwoStage(false);
          setEnabled(false);
          setHealthState('offline');
        }
      });
    return () => {
      active = false;
    };
  }, [healthCheck]);
  useEffect(() => {
    if (targetDeviceId && !workspace.devices.some((device) => device.id === targetDeviceId))
      setTargetDeviceId(null);
  }, [targetDeviceId, workspace.devices]);
  function setTarget(id: string | null) {
    setTargetDeviceId(workspace.devices.some((device) => device.id === id) ? id : null);
  }
  function resetConversation() {
    generation.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    busy.current = false;
    setPending(false);
    setMessages([]);
    setDecisions({});
    setTargetDeviceId(null);
  }
  useEffect(
    () => () => {
      generation.current++;
      activeRequest.current?.abort();
    },
    [],
  );
  async function send(value: string, selectedDeviceId?: string | null) {
    const message = value.trim().slice(0, 2000);
    if (!message || busy.current) return;
    const requestedTarget = selectedDeviceId === undefined ? targetDeviceId : selectedDeviceId;
    const focusDeviceId = workspace.devices.some((device) => device.id === requestedTarget)
      ? requestedTarget
      : null;
    setTargetDeviceId(focusDeviceId);
    const revision = ++generation.current;
    const abort = new AbortController();
    activeRequest.current = abort;
    busy.current = true;
    setPending(true);
    // Previous proposals are not state. The latest workspace is always included separately.
    const history = messages
      // Local-demo replies can mention hardware-derived labels. They were never approved for transfer.
      .filter((entry) => entry.mode === 'meta' && entry.sharedWithMeta && entry.kind !== 'notice')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
    setMessages((items) => [
      ...items.slice(-79),
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        proposals: [],
        mode,
        focusDeviceId,
        sharedWithMeta: mode === 'meta' && !assistantTargetIsLocalOnly(workspace, focusDeviceId),
      },
    ]);
    try {
      let reply;
      if (mode === 'meta') {
        if (assistantTargetIsLocalOnly(workspace, focusDeviceId))
          throw new Error(
            'This target comes from local Mac observations and cannot be sent to Meta. Switch to the local demo or choose another target.',
          );
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]),
          body: JSON.stringify({
            message,
            workspace: modelWorkspace(workspace),
            history,
            focusDeviceId,
            consent: true,
          }),
        });
        const raw = await response.json();
        if (!response.ok)
          throw new Error(typeof raw.error === 'string' ? raw.error : 'The Meta request failed.');
        if (raw.mode !== 'meta')
          throw new Error(
            'The server’s Meta configuration changed. Check the connection settings again.',
          );
        reply = { ...AssistantResponseSchema.parse(raw), mode: 'meta' as const };
      } else reply = demoReply(message, workspace, focusDeviceId);
      if (revision !== generation.current) return;
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply.message,
          proposals: reply.proposals,
          mode: reply.mode,
          focusDeviceId,
          sharedWithMeta: reply.mode === 'meta',
        },
      ]);
    } catch (error) {
      if (revision !== generation.current) return;
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'The response timed out.'
          : error instanceof Error
            ? error.message
            : 'The request could not be completed.';
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `${message}\nNo changes were applied. Try again or switch to the local demo.`,
          kind: 'notice',
          proposals: [],
          mode,
        },
      ]);
    } finally {
      if (revision === generation.current) {
        activeRequest.current = null;
        busy.current = false;
        setPending(false);
      }
    }
  }
  return {
    messages,
    targetDeviceId: targetDevice?.id ?? null,
    targetDevice,
    setTarget,
    resetConversation,
    pending,
    decisions,
    send,
    mode,
    available,
    photoTwoStage,
    model,
    healthState,
    enableMeta: () => {
      if (available) setEnabled(true);
    },
    disableMeta: () => setEnabled(false),
    refreshHealth: () => setHealthCheck((x) => x + 1),
    decide: (key: string, decision: 'applied' | 'dismissed') =>
      setDecisions((s) => ({ ...s, [key]: decision })),
  };
}
