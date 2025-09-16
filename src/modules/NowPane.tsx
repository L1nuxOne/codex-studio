import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { bus } from '../core/bus';
import { useAppStore } from '../core/store';

type StreamDelta = {
  text: string;
  ts: number;
  run_id: string;
};

type StreamDone = {
  run_id: string;
  total: number;
};

export function NowPane({ id }: { id: string }) {
  const [liveText, setLiveText] = useState('');
  const [html, setHtml] = useState('');
  const runIdRef = useRef<string | undefined>();
  const pendingRef = useRef('');
  const bufferRef = useRef('');
  const animationRef = useRef<number>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stream = useAppStore((state) => state.stream);

  useEffect(() => {
    const tick = () => {
      if (pendingRef.current.length > 0) {
        setLiveText((prev) => prev + pendingRef.current);
        bufferRef.current += pendingRef.current;
        pendingRef.current = '';
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const offDelta = bus.on<StreamDelta>('stream:delta', (delta) => {
      if (runIdRef.current && runIdRef.current !== delta.run_id) {
        bufferRef.current = '';
        pendingRef.current = '';
        setLiveText('');
      }
      runIdRef.current = delta.run_id;
      pendingRef.current += delta.text;
    });
    const offDone = bus.on<StreamDone>('stream:done', (done) => {
      if (runIdRef.current !== done.run_id) return;
      const markdown = bufferRef.current;
      setHtml(marked.parse(markdown));
    });
    const offReset = bus.on('stream:reset', () => {
      pendingRef.current = '';
      bufferRef.current = '';
      setLiveText('');
      setHtml('');
      runIdRef.current = undefined;
    });
    return () => {
      offDelta();
      offDone();
      offReset();
    };
  }, []);

  useEffect(() => {
    if (stream.active) return;
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [html, stream.active]);

  const metrics = useMemo(() => {
    const formatMs = (value?: number) => (value ? `${value.toFixed(0)} ms` : '—');
    const formatRate = (value?: number) => (value ? `${value.toFixed(1)} tok/s` : '—');
    return {
      ttfb: formatMs(stream.ttfb),
      rate: formatRate(stream.rate),
      total: stream.total
    };
  }, [stream.ttfb, stream.rate, stream.total]);

  return (
    <div className="now-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
          background: 'rgba(15,23,42,0.02)'
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Now</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Stream-first renderer</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
          <span>TTFB: {metrics.ttfb}</span>
          <span>Rate: {metrics.rate}</span>
          <span>Total: {metrics.total}</span>
        </div>
      </header>
      <div style={{ flex: 1, position: 'relative' }}>
        {stream.active ? (
          <pre
            style={{
              margin: 0,
              padding: 20,
              fontFamily: 'JetBrains Mono, SFMono-Regular, ui-monospace, monospace',
              fontSize: 14,
              height: '100%',
              overflow: 'auto',
              whiteSpace: 'pre-wrap'
            }}
          >
            {liveText}
          </pre>
        ) : (
          <div
            ref={containerRef}
            style={{
              padding: 20,
              height: '100%',
              overflow: 'auto'
            }}
            dangerouslySetInnerHTML={{ __html: html || marked.parse(liveText || 'Waiting for stream…') }}
          />
        )}
      </div>
    </div>
  );
}
