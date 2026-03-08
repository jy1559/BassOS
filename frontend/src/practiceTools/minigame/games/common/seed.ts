export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type SeededRng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(arr: T[]) => T;
  bool: (probability?: number) => boolean;
};

export function createSeededRng(seedText: string): SeededRng {
  const next = mulberry32(hashSeed(seedText));
  return {
    next,
    int(min: number, max: number): number {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return Math.floor(next() * (hi - lo + 1)) + lo;
    },
    pick<T>(arr: T[]): T {
      if (!arr.length) {
        throw new Error("Cannot pick from empty array");
      }
      return arr[Math.floor(next() * arr.length)] as T;
    },
    bool(probability = 0.5): boolean {
      return next() < probability;
    },
  };
}
