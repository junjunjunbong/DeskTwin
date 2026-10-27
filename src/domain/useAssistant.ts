import { useRef, useState } from 'react';
import { demoReply } from './demoAssistant';
import type { Proposal, Workspace } from './workspace';
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; proposals: Proposal[]; mode?: 'demo' | 'meta' };
export function useAssistant(workspace: Workspace) {
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [pending, setPending] = useState(false); const busy = useRef(false);
  const [decisions, setDecisions] = useState<Record<string, 'applied' | 'dismissed'>>({});
  async function send(value: string) {
    const message = value.trim().slice(0, 2000); if (!message || busy.current) return;
    busy.current = true; setPending(true);
    setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', content: message, proposals: [] }]);
    try {
      const reply = demoReply(message, workspace);
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'assistant', content: reply.message, proposals: reply.proposals, mode: reply.mode }]);
    } finally { busy.current = false; setPending(false); }
  }
  return { messages, pending, decisions, send, mode: 'demo' as 'demo' | 'meta', decide: (key: string, decision: 'applied' | 'dismissed') => setDecisions(s => ({ ...s, [key]: decision })) };
}
