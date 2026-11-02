import React, { useEffect, useRef } from 'react';
import { SideCode } from '../../core/types/card';

interface SectorRimTraceProps {
  side: SideCode;
  isActive: boolean;
  tabRef: React.RefObject<HTMLDivElement | null>;
  chassisRef: React.RefObject<HTMLElement | null>;
}

export const SectorRimTrace: React.FC<SectorRimTraceProps> = React.memo(({ side, isActive, tabRef, chassisRef }) => {
  const pathRef = useRef<SVGPathElement>(null);
  const prevActiveRef = useRef(isActive);

  useEffect(() => {
    const justActivated = isActive && !prevActiveRef.current;
    prevActiveRef.current = isActive;

    if (!justActivated) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    const tab = tabRef.current;
    const chassis = chassisRef.current;
    const path = pathRef.current;
    if (!tab || !chassis || !path) return;

    const w = chassis.offsetWidth;
    const tw = tab.offsetWidth;
    const th = tab.offsetHeight;

    // Stepped rim trace: climbs left tab edge -> sweeps tab top -> turns down notch step -> races across chassis top rim
    const d = `M 0,${th} L 0,0.5 L ${tw - 0.5},0.5 L ${tw - 0.5},${th - 0.5} L ${w},${th - 0.5}`;
    path.setAttribute('d', d);

    const totalLen = path.getTotalLength();
    const pulseLen = Math.min(220, Math.floor(totalLen * 0.38));

    path.style.opacity = '1';
    path.style.strokeDasharray = `${pulseLen} ${totalLen * 2}`;
    path.style.strokeDashoffset = `${pulseLen}`;
    path.style.transition = 'none';

    // Force layout reflow
    void path.getBoundingClientRect();

    const durationMs = 520;
    path.style.transition = `stroke-dashoffset ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${durationMs * 0.35}ms linear ${durationMs * 0.65}ms`;
    path.style.strokeDashoffset = `${-totalLen}`;
    path.style.opacity = '0';

    const timer = setTimeout(() => {
      path.style.transition = 'none';
      path.style.opacity = '0';
    }, durationMs + 50);

    return () => clearTimeout(timer);
  }, [isActive, tabRef, chassisRef]);

  const dropShadowColor = side === 'corp' ? '#00f0ff' : '#ff0055';

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-30 overflow-visible" aria-hidden="true">
      <path
        ref={pathRef}
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          opacity: 0,
          filter: `drop-shadow(0 0 6px ${dropShadowColor}) drop-shadow(0 0 14px ${dropShadowColor})`,
        }}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
