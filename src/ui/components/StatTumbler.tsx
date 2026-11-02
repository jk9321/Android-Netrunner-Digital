import React, { useEffect, useRef, useState } from 'react';

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
  const [animClass, setAnimClass] = useState<'tumbler-up' | 'tumbler-down' | ''>('');

  useEffect(() => {
    if (prevValue.current !== value) {
      const isUp = value > prevValue.current;
      prevValue.current = value;
      setAnimClass(isUp ? 'tumbler-up' : 'tumbler-down');
      const timer = setTimeout(() => setAnimClass(''), 120);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <span className={`inline-block tabular-nums ${animClass} ${className}`}>
      {value}
    </span>
  );
});
