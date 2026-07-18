/** Lightweight synthesized race/UI sounds; no external assets or network requests. */
export class GameAudio {
  private context: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private rumbleOsc: OscillatorNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private driftGain: GainNode | null = null;
  private driftOsc: OscillatorNode | null = null;
  private engineStarted = false;
  private boundUnlock = false;

  /** Call once at startup — browsers require a user gesture before audio runs. */
  bindUnlock() {
    if (this.boundUnlock) return;
    this.boundUnlock = true;
    const unlock = () => {
      void this.unlock().then(() => {
        this.ensureEngine();
        this.go();
      });
    };
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const Ctor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context ??= new Ctor();
      if (this.context.state === "suspended") await this.context.resume();
      // Create the output bus during the gesture.  Previously the first
      // unlock called ensureEngine() before this bus existed, so the engine
      // could remain silent until a later event (or forever in a stationary
      // arena).
      if (this.context.state === "running" && !this.master) {
        this.master = this.context.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.context.destination);
      }
    })();
    return this.ready;
  }

  private async ctx(): Promise<AudioContext | null> {
    await this.unlock();
    const context = this.context;
    if (!context || context.state !== "running") return null;
    if (!this.master) {
      this.master = context.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(context.destination);
    }
    return context;
  }

  private ensureEngine() {
    if (this.engineStarted) return;
    const context = this.context;
    if (!context || context.state !== "running" || !this.master) return;

    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    this.rumbleOsc = context.createOscillator();
    this.rumbleOsc.type = "sawtooth";
    this.rumbleOsc.frequency.value = 52;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.55;
    this.rumbleOsc.connect(rumbleGain).connect(this.engineGain);

    this.whineOsc = context.createOscillator();
    this.whineOsc.type = "triangle";
    this.whineOsc.frequency.value = 160;
    const whineGain = context.createGain();
    whineGain.gain.value = 0.35;
    this.whineOsc.connect(whineGain).connect(this.engineGain);

    this.driftGain = context.createGain();
    this.driftGain.gain.value = 0;
    this.driftGain.connect(this.master);
    this.driftOsc = context.createOscillator();
    this.driftOsc.type = "square";
    this.driftOsc.frequency.value = 90;
    const driftFilter = context.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.frequency.value = 420;
    driftFilter.Q.value = 2.2;
    this.driftOsc.connect(driftFilter).connect(this.driftGain);

    const now = context.currentTime;
    this.rumbleOsc.start(now);
    this.whineOsc.start(now);
    this.driftOsc.start(now);
    this.engineStarted = true;
  }

  updateEngine(speed: number, throttle: number, handbrake: boolean, grounded: boolean) {
    void this.ctx().then((context) => {
      if (!context) return;
      this.ensureEngine();
      if (!this.engineGain || !this.rumbleOsc || !this.whineOsc || !this.driftGain) return;
      const now = context.currentTime;
      const speedNorm = Math.min(1, speed / 34);
      const vol = grounded
        ? 0.028 + speedNorm * 0.075 + throttle * 0.03
        : 0.012 + speedNorm * 0.022;
      this.engineGain.gain.setTargetAtTime(vol, now, 0.06);
      this.rumbleOsc.frequency.setTargetAtTime(48 + speedNorm * 38 + throttle * 12, now, 0.08);
      this.whineOsc.frequency.setTargetAtTime(130 + speedNorm * 220 + throttle * 40, now, 0.06);
      const drift = grounded && handbrake && speed > 6 ? Math.min(0.035, 0.008 + speedNorm * 0.028) : 0;
      this.driftGain.gain.setTargetAtTime(drift, now, handbrake ? 0.04 : 0.12);
    });
  }

  private async tone(
    frequency: number,
    duration: number,
    volume = 0.045,
    type: OscillatorType = "square",
  ) {
    const context = await this.ctx();
    if (!context || !this.master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private async playJump() {
    await this.tone(320, 0.08, 0.04, "sine");
    window.setTimeout(() => void this.tone(520, 0.1, 0.032, "sine"), 40);
  }

  private async playLand() {
    await this.tone(140, 0.07, 0.05, "triangle");
    window.setTimeout(() => void this.tone(95, 0.09, 0.035, "sine"), 30);
  }

  countdown() {
    void this.tone(440, 0.12);
  }

  go() {
    void this.tone(660, 0.16, 0.04, "sine");
    window.setTimeout(() => void this.tone(880, 0.28, 0.038, "sine"), 120);
  }

  chat() {
    void this.tone(740, 0.06, 0.03, "sine");
  }

  jump() {
    void this.playJump();
  }

  land() {
    void this.playLand();
  }

  ctfSolved() {
    void this.tone(523, 0.12, 0.035, "sine");
    window.setTimeout(() => void this.tone(659, 0.12, 0.035, "sine"), 100);
    window.setTimeout(() => void this.tone(784, 0.22, 0.04, "sine"), 200);
  }
}
