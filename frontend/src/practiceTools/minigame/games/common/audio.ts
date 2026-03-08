let ctx: AudioContext | null = null;
let soundEnabled = true;

export type ScheduledToneEvent = {
  offsetMs: number;
  hz: number;
  durationSec?: number;
  volume?: number;
  type?: OscillatorType;
};

export type RhythmCueKind = "HIT" | "GHOST";
export type RhythmCueStyle = "guide" | "input";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function ensureContext(): Promise<AudioContext> {
  if (!ctx) {
    ctx = new window.AudioContext();
  }
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

function scheduleSimpleTone(
  audio: AudioContext,
  destination: AudioNode,
  hz: number,
  startAt: number,
  durationSec: number,
  volume: number,
  type: OscillatorType
): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(clamp(hz, 30, 5000), startAt);
  gain.gain.setValueAtTime(clamp(volume, 0.001, 1), startAt);

  oscillator.connect(gain);
  gain.connect(destination);

  const duration = Math.max(0.03, durationSec);
  oscillator.start(startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  oscillator.stop(startAt + duration);
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (!enabled && ctx && ctx.state === "running") {
    void ctx.suspend();
  }
  if (enabled && ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export async function playTone(
  hz: number,
  durationSec = 0.12,
  volume = 0.2,
  type: OscillatorType = "triangle"
): Promise<void> {
  if (!soundEnabled) return;
  const audio = await ensureContext();
  const now = audio.currentTime;
  scheduleSimpleTone(audio, audio.destination, hz, now, durationSec, volume, type);
}

export async function playFretMidi(midi: number, volume = 0.17): Promise<void> {
  if (!soundEnabled) return;
  const audio = await ensureContext();
  scheduleBassPluck(audio, midi, audio.currentTime, volume);
}

export async function playFretMidiGroup(midis: number[], volume = 0.16, spreadMs = 0): Promise<void> {
  if (!soundEnabled) return;
  if (!midis.length) return;
  const audio = await ensureContext();
  const now = audio.currentTime;
  const spreadSec = Math.max(0, spreadMs) / 1000;
  const unique = Array.from(new Set(midis.map((midi) => Math.round(midi))));
  unique.forEach((midi, idx) => {
    const gainScale = idx === 0 ? 1 : 0.9;
    scheduleBassPluck(audio, midi, now + idx * spreadSec, volume * gainScale);
  });
}

function scheduleBassPluck(audio: AudioContext, midi: number, startAt: number, volume: number): void {
  const now = Math.max(audio.currentTime, startAt);
  const hz = clamp(midiToHz(midi), 28, 1200);
  const duration = 0.52;
  const target = clamp(volume * 2.35, 0.02, 1.2);

  const output = audio.createGain();
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(1800, hz * 5.5);
  filter.Q.value = 0.9;

  const body = audio.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(hz, now);

  const bodyGain = audio.createGain();
  bodyGain.gain.setValueAtTime(0.84, now);

  const sub = audio.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(Math.max(28, hz / 2), now);

  const subGain = audio.createGain();
  subGain.gain.setValueAtTime(0.52, now);

  const attack = audio.createOscillator();
  attack.type = "sawtooth";
  attack.frequency.setValueAtTime(Math.min(1800, hz * 2.1), now);

  const attackGain = audio.createGain();
  attackGain.gain.setValueAtTime(0.2, now);
  attackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  body.connect(bodyGain);
  sub.connect(subGain);
  attack.connect(attackGain);
  bodyGain.connect(filter);
  subGain.connect(filter);
  attackGain.connect(filter);
  filter.connect(output);
  output.connect(audio.destination);

  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(target, now + 0.02);
  output.gain.exponentialRampToValueAtTime(Math.max(0.0008, target * 0.62), now + 0.2);
  output.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  body.start(now);
  sub.start(now);
  attack.start(now);
  body.stop(now + duration + 0.01);
  sub.stop(now + duration + 0.01);
  attack.stop(now + 0.055);
}

export async function playMetronomeClick(accent = false, volumeScale = 1): Promise<void> {
  const hz = accent ? 1480 : 980;
  const volume = (accent ? 0.28 : 0.19) * volumeScale;
  await playTone(hz, 0.06, volume, "square");
}

export function buildRhythmCueEvent(offsetMs: number, kind: RhythmCueKind, style: RhythmCueStyle = "guide"): ScheduledToneEvent {
  if (kind === "GHOST") {
    return {
      offsetMs,
      hz: style === "guide" ? 228 : 248,
      durationSec: style === "guide" ? 0.045 : 0.055,
      volume: style === "guide" ? 0.08 : 0.11,
      type: "sine",
    };
  }
  return {
    offsetMs,
    hz: style === "guide" ? 698 : 622,
    durationSec: style === "guide" ? 0.095 : 0.085,
    volume: style === "guide" ? 0.16 : 0.15,
    type: "triangle",
  };
}

export async function playRhythmCue(kind: RhythmCueKind, style: RhythmCueStyle = "input"): Promise<void> {
  const spec = buildRhythmCueEvent(0, kind, style);
  await playTone(spec.hz, spec.durationSec, spec.volume, spec.type);
}

export async function playResultCue(kind: "ok" | "bad"): Promise<void> {
  if (!soundEnabled) return;
  const audio = await ensureContext();
  const now = audio.currentTime;

  if (kind === "ok") {
    scheduleSimpleTone(audio, audio.destination, midiToHz(64), now, 0.08, 0.12, "triangle");
    scheduleSimpleTone(audio, audio.destination, midiToHz(71), now + 0.085, 0.09, 0.13, "triangle");
    scheduleSimpleTone(audio, audio.destination, midiToHz(76), now + 0.18, 0.12, 0.15, "triangle");
    return;
  }

  scheduleSimpleTone(audio, audio.destination, midiToHz(57), now, 0.09, 0.12, "sawtooth");
  scheduleSimpleTone(audio, audio.destination, midiToHz(54), now + 0.085, 0.11, 0.12, "sawtooth");
  scheduleSimpleTone(audio, audio.destination, midiToHz(50), now + 0.19, 0.16, 0.13, "square");
}

export async function scheduleToneSequence(
  events: ScheduledToneEvent[],
  startDelayMs = 120
): Promise<{ anchorMs: number; stop: () => void }> {
  if (!soundEnabled || !events.length) {
    return {
      anchorMs: performance.now(),
      stop: () => undefined,
    };
  }

  const audio = await ensureContext();
  const output = audio.createGain();
  output.gain.value = 1;
  output.connect(audio.destination);

  const safeDelayMs = Math.max(40, startDelayMs);
  const anchorSec = audio.currentTime + safeDelayMs / 1000;
  const anchorMs = performance.now() + safeDelayMs;

  for (const event of events) {
    const startAt = anchorSec + Math.max(0, event.offsetMs) / 1000;
    scheduleSimpleTone(
      audio,
      output,
      event.hz,
      startAt,
      event.durationSec ?? 0.06,
      event.volume ?? 0.2,
      event.type ?? "triangle"
    );
  }

  const stop = () => {
    const now = audio.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(Math.max(0.001, output.gain.value), now);
    output.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    window.setTimeout(() => output.disconnect(), 60);
  };

  return { anchorMs, stop };
}

export function startMetronome(
  bpm: number,
  beatsPerBar: number,
  onTick?: (beatIndex: number) => void,
  volumeScale = 1
): () => void {
  const ms = Math.max(40, Math.round((60_000 / Math.max(30, bpm))));
  let beat = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const beatInBar = beat % Math.max(1, beatsPerBar);
    void playMetronomeClick(beatInBar === 0, volumeScale);
    onTick?.(beatInBar + 1);
    beat += 1;
  };

  tick();
  const id = window.setInterval(tick, ms);

  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}
