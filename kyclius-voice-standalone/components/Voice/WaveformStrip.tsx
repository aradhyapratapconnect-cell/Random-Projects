/**
 * WaveformStrip: inline above the text field; animates via direct rAF writes
 * to the DOM (no React re-render at 30 Hz). Shows input RMS while listening,
 * output RMS while speaking (07 section 3).
 */
import { useEffect, useRef } from 'react';
import type { KycliusVoiceBridge } from '../../ipc/voice.preload.ts';

declare global {
  interface Window {
    kycliusVoice?: KycliusVoiceBridge;
  }
}

export interface WaveformStripProps {
  source: 'in' | 'out';
  active: boolean;
}

export function WaveformStrip({ source, active }: WaveformStripProps): JSX.Element {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = window.kycliusVoice;
    const container = barsRef.current;
    if (!bridge || !container) return;
    const bars = Array.from(container.children) as HTMLElement[];
    let raf = 0;
    let smooth = 0;
    const unsub = bridge.on('level', (p) => {
      const ev = p as { direction: 'in' | 'out'; rms: number };
      if (ev.direction !== source) return;
      smooth = smooth * 0.7 + ev.rms * 2.2 * 0.3; // quick attack, gentle decay
    });
    const tick = (): void => {
      const h = active ? Math.max(0.06, Math.min(1, smooth)) : 0.08;
      for (let i = 0; i < bars.length; i++) {
        const falloff = 1 - Math.abs(i - (bars.length - 1) / 2) / bars.length;
        bars[i].style.height = `${Math.round((h * (0.5 + 0.5 * falloff)) * 100)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [source, active]);

  return (
    <div ref={barsRef} className="mb-1 flex h-3 items-end gap-[3px]" aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          className={[
            'w-[3px] rounded-sm transition-[height] duration-75',
            source === 'out' ? 'bg-emerald-400/70' : 'bg-sky-400/70',
          ].join(' ')}
          style={{ height: '8%' }}
        />
      ))}
    </div>
  );
}
