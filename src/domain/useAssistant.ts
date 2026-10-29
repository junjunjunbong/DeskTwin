import { useEffect, useRef, useState } from 'react';
import { modelWorkspace } from './workspacePrivacy';
import { demoReply } from './demoAssistant';
import { AssistantResponseSchema, type Proposal, type Workspace } from './workspace';
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals: Proposal[];
  mode?: 'demo' | 'meta';
};
export function useAssistant(workspace: Workspace) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [decisions, setDecisions] = useState<Record<string, 'applied' | 'dismissed'>>({});
  const [available, setAvailable] = useState(false);
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
        setModel(typeof data.model === 'string' ? data.model : null);
        setHealthState('ready');
        if (data.mode !== 'meta') setEnabled(false);
      })
      .catch(() => {
        if (active) {
          setAvailable(false);
          setEnabled(false);
          setHealthState('offline');
        }
      });
    return () => {
      active = false;
    };
  }, [healthCheck]);
  async function send(value: string) {
    const message = value.trim().slice(0, 2000);
    if (!message || busy.current) return;
    busy.current = true;
    setPending(true);
    // Previous proposals are not state. The latest workspace is always included separately.
    const history = messages
      // Local-demo replies can mention hardware-derived labels. They were never approved for transfer.
      .filter((entry) => entry.mode === 'meta')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
    setMessages((items) => [
      ...items.slice(-79),
      { id: crypto.randomUUID(), role: 'user', content: message, proposals: [], mode },
    ]);
    try {
      let reply;
      if (mode === 'meta') {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(40000),
          body: JSON.stringify({
            message,
            workspace: modelWorkspace(workspace),
            history,
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
      } else reply = demoReply(message, workspace);
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply.message,
          proposals: reply.proposals,
          mode: reply.mode,
        },
      ]);
    } catch (error) {
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
          proposals: [],
          mode,
        },
      ]);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    messages,
    pending,
    decisions,
    send,
    mode,
    available,
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
