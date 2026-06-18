// Tiny Web Audio sound effects for billing events — no audio assets needed, so
// it works offline in the PWA. Sounds play in response to button clicks (a user
// gesture), so the autoplay policy is satisfied. Everything is wrapped so a
// failure never interrupts the billing flow.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Blip {
  freq: number;
  start: number; // seconds from now
  dur: number;
  type?: OscillatorType;
  peak?: number;
}

function blip(ac: AudioContext, { freq, start, dur, type = "sine", peak = 0.2 }: Blip): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ac.destination);
  const t = ac.currentTime + start;
  // Quick attack, exponential decay — a soft, non-jarring envelope.
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** A single soft blip — a bill was saved to Open Bills (held). */
export function playBillSaved(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    blip(ac, { freq: 760, start: 0, dur: 0.13, type: "triangle", peak: 0.16 });
  } catch {
    /* ignore */
  }
}

/** A rising two-note chime — a bill was settled (paid). */
export function playSettled(): void {
  const ac = getCtx();
  if (!ac) return;
  try {
    blip(ac, { freq: 523.25, start: 0, dur: 0.14, type: "sine", peak: 0.2 }); // C5
    blip(ac, { freq: 783.99, start: 0.12, dur: 0.22, type: "sine", peak: 0.22 }); // G5
  } catch {
    /* ignore */
  }
}
