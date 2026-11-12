// Exact port of .NET's System.Random(int seed) (Knuth subtractive generator, the legacy seeded implementation).
// Unity's MazeGenerator uses `new System.Random(seed)` + `rng.Next(count)`, so the same seed gives the same maze here.
const MBIG = 2147483647;
const MSEED = 161803398;

export class DotNetRandom {
  constructor(seed) {
    const a = new Array(56).fill(0);
    const subtraction = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = MSEED - subtraction;
    a[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      a[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MBIG;
      mj = a[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        a[i] -= a[1 + ((i + 30) % 55)];
        if (a[i] < 0) a[i] += MBIG;
      }
    }
    this.a = a;
    this.inext = 0;
    this.inextp = 21;
  }

  internalSample() {
    if (++this.inext >= 56) this.inext = 1;
    if (++this.inextp >= 56) this.inextp = 1;
    let r = this.a[this.inext] - this.a[this.inextp];
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    this.a[this.inext] = r;
    return r;
  }

  sample() { return this.internalSample() * (1.0 / MBIG); }

  /** Next(maxValue): integer in [0, maxValue). */
  next(maxValue) { return Math.floor(this.sample() * maxValue); }
}
