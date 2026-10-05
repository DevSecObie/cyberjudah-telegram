/** Synchronous playback intent: asynchronous media loads must honor the latest user action. */
export class AudioIntent {
  generation = 0;
  paused = false;
  start() { this.paused = false; return ++this.generation; }
  stop() { this.paused = false; this.generation++; }
  owns(generation) { return generation === this.generation; }
  canPlay(generation) { return this.owns(generation) && !this.paused; }
}

export const AUDIO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export function audioRate(value) {
  const rate = Number(value);
  return AUDIO_RATES.includes(rate) ? rate : 1;
}
