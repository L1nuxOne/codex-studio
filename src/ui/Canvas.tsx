import type { PropsWithChildren } from 'react';

export const Canvas = ({ children }: PropsWithChildren) => {
  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      {children}
    </div>
  );
};
