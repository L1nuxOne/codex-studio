import { useEffect, useState } from 'react';
import { useAppStore } from '../core/store';

const formatNumber = (value: number, fraction = 0) =>
  Number.isFinite(value) ? value.toFixed(fraction) : '—';

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const renderMarkdown = (text: string) => {
  const lines = text.split(/\n/g);
  let html = '';
  let inCode = false;
  let codeBuffer: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
      } else {
        html += `<pre class="rounded bg-slate-900/70 px-3 py-2 text-xs text-slate-100"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
        inCode = false;
        codeBuffer = [];
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }
    if (line.startsWith('#')) {
      const level = Math.min(line.match(/^#+/)?.[0].length ?? 1, 4);
      const content = escapeHtml(line.replace(/^#+\s*/, ''));
      html += `<h${level} class="mt-4 text-${level === 1 ? 'lg' : 'base'} font-semibold">${content}</h${level}>`;
      continue;
    }
    if (line.trim().length === 0) {
      html += '<p class="mt-2"></p>';
      continue;
    }
    const processed = escapeHtml(line).replace(/`([^`]+)`/g, '<code class="rounded bg-slate-900/40 px-1">$1</code>');
    html += `<p class="mt-2 leading-relaxed">${processed}</p>`;
  }
  if (inCode && codeBuffer.length) {
    html += `<pre class="rounded bg-slate-900/70 px-3 py-2 text-xs text-slate-100"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
  }
  return html;
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col text-right">
    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted-foreground)]">{label}</span>
    <span className="text-sm font-semibold text-[var(--foreground)]">{value}</span>
  </div>
);

export const NowPane = ({ id }: { id: string }) => {
  const stream = useAppStore((state) => state.stream);
  const setModuleFunctions = useAppStore((state) => state.setModuleFunctions);
  const [rendered, setRendered] = useState('');

  useEffect(() => {
    const functions = {
      'render.markdown': (value: string) => setRendered(renderMarkdown(value)),
      'render.text': (value: string) => setRendered(escapeHtml(value)),
      clear: () => setRendered(''),
    };
    setModuleFunctions(id, functions);
  }, [id, setModuleFunctions]);

  useEffect(() => {
    if (!stream.active && stream.history.length > 0) {
      const last = stream.history[stream.history.length - 1];
      setRendered(renderMarkdown(last.text));
    }
  }, [stream.active, stream.history]);

  const liveContent = stream.active ? stream.buffer : stream.history.at(-1)?.text ?? 'Ready for the next run.';
  const ttfb = stream.ttfb ? `${formatNumber(stream.ttfb, 0)} ms` : '—';
  const rate = stream.active ? `${formatNumber(stream.rate, 2)} tok/s` : '—';
  const totalTokens = stream.active
    ? `${stream.tokens}`
    : stream.history.length
    ? `${stream.history.at(-1)?.totalTokens ?? 0}`
    : '—';
  const status = stream.active ? 'Streaming…' : stream.lastStatus ?? 'Idle';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.4em] text-[var(--muted-foreground)]">Now</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Live Codex output, streamed first</p>
        </div>
        <div className="grid grid-cols-4 gap-4 text-right">
          <Metric label="Status" value={status} />
          <Metric label="TTFB" value={ttfb} />
          <Metric label="Rate" value={rate} />
          <Metric label="Tokens" value={totalTokens} />
        </div>
      </header>
      <div className="flex-1 overflow-auto px-4 py-3 font-mono text-sm leading-relaxed scrollbar-thin">
        <pre className="whitespace-pre-wrap text-[var(--foreground)]">{liveContent}</pre>
      </div>
      {rendered ? (
        <section className="border-t border-[var(--surface-border)] bg-[var(--muted)]/20 px-4 py-3 text-sm leading-relaxed">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted-foreground)]">Parsed</h3>
          <div className="mt-2 prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: rendered }} />
        </section>
      ) : null}
    </div>
  );
};
