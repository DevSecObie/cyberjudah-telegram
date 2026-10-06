export class AudioIntent {
  generation: number;
  paused: boolean;
  start(): number;
  stop(): void;
  owns(generation: number): boolean;
  canPlay(generation: number): boolean;
}
export const AUDIO_RATES: number[];
export function audioRate(value: unknown): number;
