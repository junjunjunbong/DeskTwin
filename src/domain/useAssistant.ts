import { useEffect, useRef, useState } from 'react';
import { demoReply } from './demoAssistant';
import { AssistantResponseSchema, type Proposal, type Workspace } from './workspace';
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; proposals: Proposal[]; mode?: 'demo' | 'meta' };
export function useAssistant(workspace: Workspace) {
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [pending, setPending] = useState(false); const busy = useRef(false);
  const [decisions, setDecisions] = useState<Record<string, 'applied' | 'dismissed'>>({});
  const [available, setAvailable] = useState(false); const [model, setModel] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false); const [healthCheck, setHealthCheck] = useState(0);
  const [healthState, setHealthState] = useState<'checking' | 'ready' | 'offline'>('checking');
  const mode: 'demo' | 'meta' = enabled && available ? 'meta' : 'demo';
  useEffect(() => {
    let active = true;
    setHealthState('checking');
    fetch('/api/health', { signal: AbortSignal.timeout(4000) }).then(async response => {
      if (!response.ok) throw new Error('API unavailable'); const data = await response.json();
      if (!active) return;
      setAvailable(data.mode === 'meta'); setModel(typeof data.model === 'string' ? data.model : null); setHealthState('ready');
      if (data.mode !== 'meta') setEnabled(false);
    }).catch(() => { if (active) { setAvailable(false); setEnabled(false); setHealthState('offline'); } });
    return () => { active = false; };
  }, [healthCheck]);
  async function send(value: string) {
    const message = value.trim().slice(0, 2000); if (!message || busy.current) return;
    busy.current = true; setPending(true);
    // Previous proposals are not state. The latest workspace is always included separately.
    const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
    setMessages(items => [...items.slice(-79), { id: crypto.randomUUID(), role: 'user', content: message, proposals: [] }]);
    try {
      let reply;
      if (mode === 'meta') {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000), body: JSON.stringify({ message, workspace, history, consent: true }) });
        const raw = await response.json();
        if (!response.ok) throw new Error(typeof raw.error === 'string' ? raw.error : 'Meta 요청에 실패했습니다.');
        if (raw.mode !== 'meta') throw new Error('서버의 Meta 설정이 변경되었습니다. 연결 설정을 다시 확인해 주세요.');
        reply = { ...AssistantResponseSchema.parse(raw), mode: 'meta' as const };
      } else reply = demoReply(message, workspace);
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'assistant', content: reply.message, proposals: reply.proposals, mode: reply.mode }]);
    } catch (error) {
      const message = error instanceof Error && error.name === 'TimeoutError' ? '응답 시간이 초과되었습니다.' : error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `${message}\n변경 사항을 반영하지 않았습니다. 다시 시도하거나 로컬 데모로 전환할 수 있습니다.`, proposals: [], mode }]);
    } finally { busy.current = false; setPending(false); }
  }
  return { messages, pending, decisions, send, mode, available, model, healthState,
    enableMeta: () => { if (available) setEnabled(true); }, disableMeta: () => setEnabled(false), refreshHealth: () => setHealthCheck(x => x + 1),
    decide: (key: string, decision: 'applied' | 'dismissed') => setDecisions(s => ({ ...s, [key]: decision })),
  };
}
