import type { PropsWithChildren } from 'react';

export function Canvas({ children }: PropsWithChildren) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--background-light)',
        color: 'var(--foreground-light)'
      }}
    >
      {children}
    </div>
  );
}
