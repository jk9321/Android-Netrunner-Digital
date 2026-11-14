import React, { useRef } from 'react';
import { useAutoFit } from '../useAutoFit';

/** A scrolling board area whose cards shrink to fit when Auto fit is on. */
export const AutoFitArea: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useAutoFit(ref);
  return (
    <div ref={ref} className={`auto-fit-area ${className ?? ''}`} data-testid="auto-fit-area">
      {children}
    </div>
  );
};
