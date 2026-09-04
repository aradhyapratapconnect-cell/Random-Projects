import { useEffect, useRef } from 'react';
import type { VoiceEngine } from '../kycelius';

interface Props {
  engine: VoiceEngine;
  listening: boolean;
  speaking: boolean;
}

/**
 * Canvas waveform: real-time frequency bars from the engine's AnalyserNode,
 * with an animated synthetic baseline when idle so the HUD always feels alive.
 */
export function WaveformVisualizer({ engine, listening, speaking }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const listeningRef = useRef(listening);
  const speakingRef = useRef(speaking);
  listeningRef.current = listening;
  speakingRef.current = speaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let t = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bars = 72;
      const gap = 3;
      const barW = (w - gap * (bars - 1)) / bars;
      const analyser = listeningRef.current ? engine.getAnalyser() : null;
      const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
      if (analyser && freq) analyser.getByteFrequencyData(freq);

      t += 0.03;

      for (let i = 0; i < bars; i++) {
        let level: number;
        if (speakingRef.current) {
          // TTS speaking: smooth synthetic "voice" wave
          level =
            0.15 +
            0.5 *
              Math.abs(
                Math.sin(t * 2.1 + i * 0.35) * 0.6 + Math.sin(t * 3.7 + i * 0.13) * 0.4,
              );
        } else if (analyser && freq) {
          // Real mic data — mirror low frequencies across the bar range
          const idx = i < bars / 2 ? i * 2 : (bars - i) * 2;
          const v = freq[Math.min(idx, freq.length - 1)] / 255;
          level = Math.max(0.02, v * 1.4);
        } else {
          // Idle: gentle breathing baseline
          level = 0.04 + 0.03 * Math.abs(Math.sin(t + i * 0.4));
        }

        const barH = Math.max(3, level * h * 0.9);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, '#7be4ff');
        grad.addColorStop(0.5, '#36d3ff');
        grad.addColorStop(1, '#0dbcff');
        ctx.fillStyle = grad;
        ctx.globalAlpha = listeningRef.current || speakingRef.current ? 0.95 : 0.35;

        const r = Math.min(barW / 2, 3);
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engine]);

  return <canvas ref={canvasRef} className="h-36 w-full" />;
}
