/** Lightweight synthesized race/UI sounds; no external assets or network requests. */
export class GameAudio {
  private context: AudioContext | null = null;

  unlock() {
    const Ctor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.context ??= new Ctor();
    if (this.context.state === "suspended") void this.context.resume();
  }

  tone(frequency: number, duration: number, volume = 0.045) {
    this.unlock();
    const ctx = this.context;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  countdown() { this.tone(440, 0.12); }
  go() {
    this.tone(660, 0.16);
    window.setTimeout(() => this.tone(880, 0.28), 120);
  }
  chat() { this.tone(740, 0.06, 0.025); }
  jump() {
    this.tone(320, 0.08, 0.035);
    window.setTimeout(() => this.tone(520, 0.1, 0.028), 40);
  }
}
