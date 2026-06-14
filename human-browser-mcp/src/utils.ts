export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between actions: 300–800 ms */
export async function humanDelay(): Promise<void> {
  await sleep(300 + Math.random() * 500);
}

/** Box-Muller Gaussian sample */
export function gaussianRandom(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const sample = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(20, Math.round(mean + stdDev * sample));
}

/** Per-character delay: Gaussian around 70 ms, σ=25 */
export function typingDelay(): number {
  return gaussianRandom(70, 25);
}

/** Occasional long pause between words/bursts */
export async function randomPause(): Promise<void> {
  if (Math.random() < 0.12) {
    await sleep(200 + Math.random() * 300);
  }
}

/** Scroll chunk sizes with slight randomness */
export function scrollChunk(total: number, steps: number, index: number): number {
  const base = total / steps;
  const jitter = (Math.random() - 0.5) * base * 0.3;
  return base + jitter;
}
