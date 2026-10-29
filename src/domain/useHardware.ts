import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardwareSessionSchema,
  HardwareSnapshotSchema,
  stoppedHardwareSnapshot,
  type HardwareSession,
  type HardwareSnapshot,
} from './hardware';

const header = { 'X-DeskTwin-Hardware': '1' };

export function useHardware() {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot>(stoppedHardwareSnapshot);
  const [session, setSession] = useState<HardwareSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(snapshot);
  const sessionRef = useRef<HardwareSession | null>(null);
  const enabledRef = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const capabilityPending = useRef<Promise<HardwareSession | null> | null>(null);
  const capabilityRevision = useRef(0);
  const capabilityAbort = useRef<AbortController | null>(null);
  const starting = useRef(false);
  latest.current = snapshot;

  const update = useCallback((value: HardwareSnapshot) => {
    latest.current = value;
    setSnapshot(value);
  }, []);

  const unavailable = useCallback(
    (message: string) => {
      const previous = latest.current;
      const next = stoppedHardwareSnapshot();
      next.state = 'unavailable';
      next.message = message;
      next.lastCheckedAt = previous.lastCheckedAt;
      for (const category of ['display', 'usb', 'bluetooth'] as const) {
        next.categories[category] = {
          ...previous.categories[category],
          state: 'unavailable',
          message,
        };
      }
      update(next);
    },
    [update],
  );

  const refreshAvailability = useCallback((): Promise<HardwareSession | null> => {
    if (enabledRef.current) return Promise.resolve(sessionRef.current);
    if (capabilityPending.current) return capabilityPending.current;
    const revision = ++capabilityRevision.current;
    const abort = new AbortController();
    capabilityAbort.current = abort;
    const pending = (async () => {
      try {
        const response = await fetch('/api/hardware/session', {
          headers: header,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
        });
        if (!response.ok)
          throw new Error(
            'The local bridge is unavailable. Start the DeskTwin server on this Mac and try again.',
          );
        const value = HardwareSessionSchema.parse(await response.json());
        if (revision !== capabilityRevision.current || enabledRef.current)
          return sessionRef.current;
        sessionRef.current = value;
        setSession(value);
        setError('');
        return value;
      } catch {
        if (revision !== capabilityRevision.current || abort.signal.aborted) return null;
        sessionRef.current = null;
        setSession(null);
        setError(
          'The local bridge is unavailable. Start the DeskTwin server on this Mac and try again.',
        );
        return null;
      } finally {
        if (revision === capabilityRevision.current) capabilityPending.current = null;
      }
    })();
    capabilityPending.current = pending;
    return pending;
  }, []);

  const requestSnapshot = useCallback(
    async (operation: 'start' | 'snapshot', current: HardwareSession, revision: number) => {
      const abort = new AbortController();
      controller.current = abort;
      try {
        const response = await fetch(`/api/hardware/${operation}`, {
          method: operation === 'start' ? 'POST' : 'GET',
          headers: {
            ...header,
            'X-DeskTwin-Hardware-Token': current.token,
            ...(operation === 'start' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: operation === 'start' ? JSON.stringify({ consent: true }) : undefined,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        if (revision !== generation.current) return;
        if (response.status === 403) {
          enabledRef.current = false;
          setEnabled(false);
          sessionRef.current = null;
          setSession(null);
          throw new Error(
            'The bridge session ended. Check availability and start detection again.',
          );
        }
        if (!response.ok)
          throw new Error('The local bridge could not check device status. Presence is unknown.');
        const value = HardwareSnapshotSchema.parse(await response.json());
        if (revision !== generation.current) return;
        update(value);
        setError('');
        if (value.state === 'stopped') {
          enabledRef.current = false;
          setEnabled(false);
        }
      } catch (cause) {
        if (revision !== generation.current || abort.signal.aborted) return;
        const message =
          cause instanceof Error && cause.message.startsWith('The bridge session')
            ? cause.message
            : 'The local bridge is unavailable or returned an invalid response. Device presence is unknown.';
        unavailable(message);
        setError(message);
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    [unavailable, update],
  );

  const start = useCallback(async () => {
    if (enabledRef.current || starting.current) return;
    starting.current = true;
    const revision = ++generation.current;
    setBusy(true);
    const current = sessionRef.current ?? (await refreshAvailability());
    if (revision !== generation.current) return;
    if (!current?.available) {
      unavailable(current?.message || 'The local bridge is unavailable.');
      setBusy(false);
      starting.current = false;
      return;
    }
    enabledRef.current = true;
    setEnabled(true);
    // Polling stays paused while this initial request is busy; Stop remains available.
    await requestSnapshot('start', current, revision);
    if (revision === generation.current) {
      setEnabled(enabledRef.current);
      setBusy(false);
      starting.current = false;
    }
  }, [refreshAvailability, requestSnapshot, unavailable]);

  const stop = useCallback(async () => {
    const revision = ++generation.current;
    enabledRef.current = false;
    starting.current = false;
    capabilityRevision.current++;
    capabilityAbort.current?.abort();
    capabilityPending.current = null;
    setEnabled(false);
    controller.current?.abort();
    setBusy(true);
    const current = sessionRef.current;
    // Explicit Stop revokes this capability on the server. Restart requires a new token.
    sessionRef.current = null;
    setSession(null);
    const previous = latest.current;
    const stopped = stoppedHardwareSnapshot();
    stopped.message = 'Detection stopped. Device presence is unknown.';
    stopped.lastCheckedAt = previous.lastCheckedAt;
    for (const category of ['display', 'usb', 'bluetooth'] as const)
      stopped.categories[category] = {
        ...previous.categories[category],
        state: 'unavailable',
        message: 'Detection stopped. Device presence is unknown.',
      };
    update(stopped);
    setError('');
    try {
      if (current) {
        const response = await fetch('/api/hardware/stop', {
          method: 'POST',
          headers: {
            ...header,
            'Content-Type': 'application/json',
            'X-DeskTwin-Hardware-Token': current.token,
          },
          body: '{}',
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error('Stop not confirmed');
        const value = HardwareSnapshotSchema.parse(await response.json());
        if (revision === generation.current) update(value);
      }
    } catch {
      if (revision === generation.current) {
        sessionRef.current = null;
        setSession(null);
        setError(
          'Polling stopped in this tab. The bridge could not confirm stop; its short session lease will expire. Device presence is unknown.',
        );
      }
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  }, [update]);

  useEffect(() => {
    void refreshAvailability();
    return () => {
      generation.current++;
      capabilityRevision.current++;
      capabilityAbort.current?.abort();
      capabilityPending.current = null;
      controller.current?.abort();
      const current = sessionRef.current;
      if (current && enabledRef.current)
        void fetch('/api/hardware/stop', {
          method: 'POST',
          headers: {
            ...header,
            'Content-Type': 'application/json',
            'X-DeskTwin-Hardware-Token': current.token,
          },
          body: '{}',
          keepalive: true,
        }).catch(() => undefined);
    };
  }, [refreshAvailability]);

  useEffect(() => {
    if (!enabled || busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = sessionRef.current;
      if (!active || !enabledRef.current || !current) return;
      await requestSnapshot('snapshot', current, generation.current);
      if (active && enabledRef.current) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, busy, requestSnapshot]);

  return { snapshot, session, enabled, busy, error, start, stop, refreshAvailability };
}

export type HardwareController = ReturnType<typeof useHardware>;
