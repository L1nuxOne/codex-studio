import { useEffect, useRef, useState } from 'react';
import { bus } from '../core/bus';
import { registerModuleFunctions } from '../core/registry';

export function ComposerPane({ id }: { id: string }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const historyIndex = useRef<number>(-1);

  useEffect(() => {
    registerModuleFunctions(id, {
      focus: () => textareaRef.current?.focus(),
      insert: (text: string) => {
        setValue((prev) => `${prev}${prev ? '\n' : ''}${text}`);
      }
    });
  }, [id]);

  const sendPrompt = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    bus.emit('prompt.send', { text: trimmed });
    setHistory((prev) => [...prev, trimmed]);
    historyIndex.current = -1;
    setValue('');
  };

  const recallHistory = (direction: 1 | -1) => {
    if (history.length === 0) return;
    if (historyIndex.current === -1) {
      historyIndex.current = history.length;
    }
    let nextIndex = historyIndex.current + direction;
    nextIndex = Math.max(0, Math.min(history.length - 1, nextIndex));
    historyIndex.current = nextIndex;
    const nextValue = history[nextIndex] ?? '';
    setValue(nextValue);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = nextValue.length;
      }
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
      event.preventDefault();
      sendPrompt();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
      event.preventDefault();
      recallHistory(-1);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') {
      event.preventDefault();
      recallHistory(1);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
          fontWeight: 600
        }}
      >
        Composer
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, gap: 12 }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Codex… (Ctrl+Enter to send)"
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 12,
            border: '1px solid rgba(15,23,42,0.12)',
            padding: 16,
            fontSize: 14,
            fontFamily: 'Inter, sans-serif',
            boxShadow: 'inset 0 1px 4px rgba(15,23,42,0.05)'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
          <span>Ctrl+Enter to stream via Codex CLI</span>
          <button
            onClick={sendPrompt}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
