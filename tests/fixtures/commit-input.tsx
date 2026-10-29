import { useRef, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { CommitNumberInput, CommitTextInput } from '../../src/components/CommitInput';

type Value = string | number;
type Pending = {
  value: Value;
  resolve: (accepted: boolean) => void;
  reject: (error: Error) => void;
};

/** A save can finish before React publishes the accepted workspace to a field. */
function PublicationFixture() {
  const numeric = new URLSearchParams(location.search).get('kind') === 'number';
  const initial = numeric ? 0.3 : 'Original name';
  const [value, setValue] = useState<Value>(initial);
  const [submissions, setSubmissions] = useState<Value[]>([]);
  const [result, setResult] = useState('No completed save');
  const accepted = useRef<Value>(initial);
  const pending = useRef<Pending[]>([]);

  function commit(next: Value) {
    setSubmissions((previous) => [...previous, next]);
    return new Promise<boolean>((resolve, reject) => {
      pending.current.push({ value: next, resolve, reject });
    });
  }
  function settle(outcome: 'accept' | 'reject' | 'error') {
    const next = pending.current.shift();
    if (!next) throw new Error('The fixture has no pending save.');
    if (outcome === 'accept') {
      accepted.current = next.value;
      next.resolve(true);
    } else if (outcome === 'reject') next.resolve(false);
    else next.reject(new Error('Fixture save failed.'));
    setResult(outcome);
  }
  // Test controls change save timing without changing the input's focus or draft.
  const retainFocus = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();
  return (
    <main>
      <h1>Commit input publication fixture</h1>
      {numeric ? (
        <CommitNumberInput
          aria-label="Edited value"
          value={Number(value)}
          min={-6}
          max={6}
          onCommit={commit}
        />
      ) : (
        <CommitTextInput aria-label="Edited value" value={String(value)} onCommit={commit} />
      )}
      <button onMouseDown={retainFocus} onClick={() => settle('accept')}>
        Accept save
      </button>
      <button onMouseDown={retainFocus} onClick={() => settle('reject')}>
        Reject save
      </button>
      <button onMouseDown={retainFocus} onClick={() => settle('error')}>
        Fail save
      </button>
      <button onMouseDown={retainFocus} onClick={() => setValue(accepted.current)}>
        Publish accepted value
      </button>
      <button>Focus elsewhere</button>
      <output aria-label="Submitted values">{JSON.stringify(submissions)}</output>
      <output aria-label="Last save result">{result}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<PublicationFixture />);
