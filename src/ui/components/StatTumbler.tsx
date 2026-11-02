import React, { useEffect, useRef, useState } from 'react';
import { shouldReduceMotion } from '../animations';

interface StatTumblerProps {
  value: number;
  className?: string;
}

/**
 * Mechanical counter tumbler for stat rows, scores, and card tokens.
 * Performs a crisp 110ms micro-slip (upward on increment, downward on decrement)
 * with a subtle phosphor highlight flare, mimicking physical cyberdeck LED/tally counters.
 */
export const StatTumbler: React.FC<StatTumblerProps> = React.memo(({ value, className = '' }) => {
  const prevValue = useRef(value);
  const [anim, setAnim] = useState<{ dir: 'tumbler-up' | 'tumbler-down'; seq: number } | null>(null);

  useEffect(() => {
    if (prevValue.current !== value) {
      const dir = value > prevValue.current ? 'tumbler-up' : 'tumbler-down';
      prevValue.current = value;
      if (shouldReduceMotion()) return;
      setAnim(prev => ({ dir, seq: (prev?.seq ?? 0) + 1 }));
      const timer = setTimeout(() => setAnim(null), 120);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <span key={anim?.seq} className={`inline-block tabular-nums ${anim?.dir ?? ''} ${className}`}>
      {value}
    </span>
  );
});
