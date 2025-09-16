import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { bus } from '../core/bus';
import { useAppStore } from '../core/store';

export const ComposerPane = ({ id }: { id: string }) => {
  const [value, setValue] = useState('');
  const streamActive = useAppStore((state) => state.stream.active);
  const setModuleFunctions = useAppStore((state) => state.setModuleFunctions);

  useEffect(() => {
    const offInsert = bus.on<string>('composer.insert', (text) => setValue((prev) => `${prev}${text}`));
    const offSet = bus.on<string>('composer.set', (text) => setValue(text ?? ''));
    setModuleFunctions(id, {
      'compose.insert': (text: string) => setValue((prev) => `${prev}${text}`),
      'compose.set': (text: string) => setValue(text ?? ''),
      clear: () => setValue(''),
    });
    return () => {
      offInsert();
      offSet();
    };
  }, [id, setModuleFunctions]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    bus.emit('prompt.send', { text: trimmed });
    setValue('');
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--surface-border)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted-foreground)]">Compose</h2>
        <p className="text-xs text-[var(--muted-foreground)]">Draft a prompt and press Ctrl+Enter to stream it</p>
      </header>
      <div className="flex-1 px-4 py-3">
        <textarea
          className="h-full w-full resize-none rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Ask Codex…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streamActive}
        />
      </div>
      <footer className="flex items-center justify-between border-t border-[var(--surface-border)] bg-[var(--muted)]/10 px-4 py-2 text-xs text-[var(--muted-foreground)]">
        <span>{streamActive ? 'Streaming in progress…' : 'Ctrl+Enter to send · Shift+Enter for newline'}</span>
        <button
          className="rounded-full bg-[var(--accent)] px-4 py-1 text-xs font-semibold text-[var(--accent-foreground)] disabled:opacity-40"
          type="button"
          onClick={handleSend}
          disabled={streamActive || !value.trim()}
        >
          Send
        </button>
      </footer>
    </div>
  );
};
