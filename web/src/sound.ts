// Small synthesized sounds tied to onchain events. No audio files; nothing plays until the user has interacted.
type Name = "confirm" | "payout" | "tick" | "error";

const notes: Record<Name, { f: number[]; step: number; len: number; type: OscillatorType; gain: number }> = {
  confirm: { f: [659.25, 987.77], step: 0.09, len: 0.22, type: "sine", gain: 0.12 },
  payout: { f: [523.25, 659.25, 783.99, 1046.5, 1318.5], step: 0.085, len: 0.5, type: "triangle", gain: 0.14 },
  tick: { f: [1174.66], step: 0, len: 0.08, type: "sine", gain: 0.05 },
  error: { f: [220, 174.61], step: 0.12, len: 0.25, type: "sawtooth", gain: 0.05 },
};

const KEY = "roda.muted";
let ctx: AudioContext | undefined;
let muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
const listeners = new Set<() => void>();

export const isMuted = () => muted;
export const onMuteChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export function setMuted(value: boolean) {
  muted = value;
  localStorage.setItem(KEY, value ? "1" : "0");
  listeners.forEach((fn) => fn());
}

export function play(name: Name) {
  if (muted || typeof AudioContext === "undefined") return;
  // Browsers block audio before a user gesture; a suspended context just stays silent.
  if (!navigator.userActivation?.hasBeenActive) return;
  ctx ??= new AudioContext();
  const n = notes[name];
  n.f.forEach((freq, i) => {
    const at = ctx!.currentTime + i * n.step;
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = n.type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(n.gain, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + n.len);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(at);
    osc.stop(at + n.len + 0.02);
  });
}
