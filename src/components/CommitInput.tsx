import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type' | 'min' | 'max' | 'step'
>;

/** Keep intermediate text (including a trailing space) until the user commits it. */
export function CommitTextInput({
  value,
  onCommit,
  allowEmpty = false,
  ...props
}: InputProps & {
  value: string;
  onCommit: (value: string) => unknown;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const focused = useRef(false);
  const dirty = useRef(false);
  const pending = useRef(false);
  const submitted = useRef(value);
  const requestVersion = useRef(0);
  const editVersion = useRef(0);
  const latest = useRef(value);
  latest.current = value;
  const errorId = useId();
  useEffect(() => {
    if ((!pending.current || value === submitted.current) && (!focused.current || !dirty.current)) {
      setDraft(value);
      setError('');
    }
  }, [value]);
  async function commit() {
    const next = draft.trim();
    if (!next && !allowEmpty) {
      setError('Enter a non-empty name. Press Escape to restore the saved value.');
      return;
    }
    if (pending.current && next === submitted.current) return;
    dirty.current = false;
    setDraft(next);
    setError('');
    if (next === latest.current && !pending.current) return;
    pending.current = true;
    submitted.current = next;
    const request = ++requestVersion.current;
    const edit = editVersion.current;
    try {
      const result = await onCommit(next);
      if (result === false && request === requestVersion.current && edit === editVersion.current)
        setDraft(latest.current);
    } catch {
      if (request === requestVersion.current && edit === editVersion.current) {
        setDraft(latest.current);
        setError('The change could not be saved.');
      }
    } finally {
      if (request === requestVersion.current) {
        pending.current = false;
        if (edit === editVersion.current) setDraft(latest.current);
      }
    }
  }
  return (
    <>
      <input
        {...props}
        type="text"
        data-commit-input="true"
        value={draft}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        onFocus={(event) => {
          focused.current = true;
          props.onFocus?.(event);
        }}
        onChange={(event) => {
          dirty.current = true;
          editVersion.current++;
          setDraft(event.target.value);
          setError('');
        }}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dirty.current = false;
            editVersion.current++;
            setDraft(latest.current);
            setError('');
          }
        }}
      />
      {error && (
        <small id={errorId} className="form-error" role="alert">
          {error}
        </small>
      )}
    </>
  );
}

/** Decimal text is locally editable; only a complete, bounded number reaches the model. */
export function CommitNumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  ...props
}: InputProps & {
  value: number;
  onCommit: (value: number) => unknown;
  min: number;
  max: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const focused = useRef(false);
  const dirty = useRef(false);
  const pending = useRef(false);
  const submitted = useRef(value);
  const requestVersion = useRef(0);
  const editVersion = useRef(0);
  const latest = useRef(value);
  latest.current = value;
  const errorId = useId();
  useEffect(() => {
    if ((!pending.current || value === submitted.current) && (!focused.current || !dirty.current)) {
      setDraft(String(value));
      setError('');
    }
  }, [value]);
  async function commit() {
    const text = draft.trim();
    const next = Number(text);
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text) || !Number.isFinite(next)) {
      setError('Enter a complete number. Press Escape to restore the saved value.');
      return;
    }
    if (next < min || next > max) {
      setError(`Enter a value from ${min} to ${max}.`);
      return;
    }
    if (pending.current && next === submitted.current) return;
    dirty.current = false;
    setDraft(String(next));
    setError('');
    if (next === latest.current && !pending.current) return;
    pending.current = true;
    submitted.current = next;
    const request = ++requestVersion.current;
    const edit = editVersion.current;
    try {
      const result = await onCommit(next);
      if (result === false && request === requestVersion.current && edit === editVersion.current)
        setDraft(String(latest.current));
    } catch {
      if (request === requestVersion.current && edit === editVersion.current) {
        setDraft(String(latest.current));
        setError('The change could not be saved.');
      }
    } finally {
      if (request === requestVersion.current) {
        pending.current = false;
        if (edit === editVersion.current) setDraft(String(latest.current));
      }
    }
  }
  return (
    <>
      <input
        {...props}
        type="text"
        data-commit-input="true"
        inputMode="decimal"
        value={draft}
        data-step={step}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        onFocus={(event) => {
          focused.current = true;
          props.onFocus?.(event);
        }}
        onChange={(event) => {
          dirty.current = true;
          editVersion.current++;
          setDraft(event.target.value);
          setError('');
        }}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dirty.current = false;
            editVersion.current++;
            setDraft(String(latest.current));
            setError('');
          }
        }}
      />
      {error && (
        <small id={errorId} className="form-error" role="alert">
          {error}
        </small>
      )}
    </>
  );
}
