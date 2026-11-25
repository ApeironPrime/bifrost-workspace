import { useEffect, useRef, useState } from 'react';
import { computeVoiceSpectrumFromBins } from '../../../lib/mediaQuality';

const IDLE_BAR_HEIGHTS = [6, 10, 14, 8, 16, 12, 7, 15, 11, 8, 12, 9, 6] as const;
const SPEAKING_HOLD_MS = 350;

function resetWaveBars(container: HTMLDivElement | null) {
  if (!container) return;
  const children = container.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i] as HTMLElement | undefined;
    if (el) {
      el.style.height = `${IDLE_BAR_HEIGHTS[i % IDLE_BAR_HEIGHTS.length]}px`;
    }
  }
}

/**
 * Measures real-time voice energy and frequency spectrum from a MediaStream using WebAudio AnalyserNode.
 * Bar heights update directly in DOM (`waveContainerRef`) to avoid 15fps React re-renders, while `isSpeaking`
 * provides a debounced boolean for Active Speaker tile highlights.
 */
export function useStreamVoiceActivity(stream: MediaStream | null, enabled: boolean) {
  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  const [speakingRaw, setSpeakingRaw] = useState(false);

  useEffect(() => {
    const waveEl = waveContainerRef.current;
    resetWaveBars(waveEl);
    if (!enabled || !stream) return;

    const hasLiveAudio = stream.getAudioTracks().some((track) => track.readyState === 'live');
    if (!hasLiveAudio) return;

    const AudioCtx =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let intervalId: number | null = null;

    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.74;
      source.connect(analyser);

      const bins = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeechAt = 0;

      intervalId = window.setInterval(() => {
        analyser.getByteFrequencyData(bins);
        const container = waveContainerRef.current;
        const barCount = container?.children.length || IDLE_BAR_HEIGHTS.length;
        const { bars, speaking } = computeVoiceSpectrumFromBins(bins, barCount);

        if (container) {
          for (let i = 0; i < container.children.length; i++) {
            const el = container.children[i] as HTMLElement | undefined;
            if (el) {
              el.style.height = `${bars[i] ?? 6}px`;
            }
          }
        }

        const now = performance.now();
        if (speaking) {
          lastSpeechAt = now;
          setSpeakingRaw((prev) => (prev ? prev : true));
        } else if (now - lastSpeechAt > SPEAKING_HOLD_MS) {
          setSpeakingRaw((prev) => (prev ? false : prev));
        }
      }, 65);
    } catch {
      /* Ignore WebAudio errors in headless/restricted environments. */
    }

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      try {
        source?.disconnect();
      } catch {
        /* Ignore disconnect errors. */
      }
      if (ctx) {
        void ctx.close().catch(() => {});
      }
      resetWaveBars(waveEl);
    };
  }, [stream, enabled]);

  return {
    waveContainerRef,
    isSpeaking: Boolean(enabled && stream && speakingRaw),
  };
}
