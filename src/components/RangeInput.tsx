import { useEffect, useRef, useState } from 'react';

/** Keep the latest gesture visible while a serialized save is awaiting its lock. */
export function RangeInput({
  value,
  min,
  max,
  step,
  onCommit,
  ...props
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => unknown;
  'aria-label': string;
}) {
  const canonical = (number: number) =>
    Number((min + Math.round((number - min) / step) * step).toFixed(6));
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  const active = useRef(0);
  const version = useRef(0);
  const mounted = useRef(true);
  const frame = useRef<number | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    if (active.current === 0) setDraft(value);
  }, [value]);
  async function commit(next: number) {
    const token = ++version.current;
    setDraft(next);
    active.current++;
    try {
      await onCommit(next);
    } catch {
      // Command owners display the failure; the slider restores accepted state below.
    } finally {
      active.current--;
      if (token === version.current && mounted.current) {
        // React may publish the accepted workspace after the command Promise resolves.
        frame.current = requestAnimationFrame(() => {
          if (token === version.current && active.current === 0 && mounted.current)
            setDraft(latest.current);
        });
      }
    }
  }
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      step={step}
      value={canonical(draft)}
      onChange={(event) => {
        void commit(Number(event.target.value));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (active.current) void commit(latest.current);
          else setDraft(latest.current);
        }
      }}
    />
  );
}
