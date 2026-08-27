export const BREEDING_PRNG_VERSION = "splitmix64-v1";

const MASK_64 = (1n << 64n) - 1n;
const GAMMA = 0x9e3779b97f4a7c15n;
const MULTIPLIER_1 = 0xbf58476d1ce4e5b9n;
const MULTIPLIER_2 = 0x94d049bb133111ebn;
const TWO_POW_53 = 9_007_199_254_740_992;
const TWO_POW_64 = 1n << 64n;

function parseSeed(seed) {
  if (typeof seed !== "string" || !/^(0|[1-9]\d*)$/.test(seed)) {
    throw new Error("SplitMix64 seed must be an unsigned decimal string");
  }
  const value = BigInt(seed);
  if (value > MASK_64) throw new Error("SplitMix64 seed exceeds 64 bits");
  return value;
}

/** Versioned, cross-browser SplitMix64 generator for breeding randomness only. */
export class SplitMix64 {
  constructor(seed) {
    this.version = BREEDING_PRNG_VERSION;
    this.seed = seed;
    this.state = parseSeed(seed);
  }

  nextUint64() {
    this.state = (this.state + GAMMA) & MASK_64;
    let value = this.state;
    value = ((value ^ (value >> 30n)) * MULTIPLIER_1) & MASK_64;
    value = ((value ^ (value >> 27n)) * MULTIPLIER_2) & MASK_64;
    return (value ^ (value >> 31n)) & MASK_64;
  }

  /** Return a deterministic double in [0, 1) using the high 53 random bits. */
  nextFloat() {
    return Number(this.nextUint64() >> 11n) / TWO_POW_53;
  }

  /** Sample an unbiased integer from 0 (inclusive) to maxExclusive (exclusive). */
  nextInteger(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
      throw new Error("SplitMix64 integer bound must be a positive safe integer");
    }
    const bound = BigInt(maxExclusive);
    const limit = TWO_POW_64 - (TWO_POW_64 % bound);
    let value;
    do value = this.nextUint64(); while (value >= limit);
    return Number(value % bound);
  }

  /** Sample a deterministic continuous value from [minimum, maximum). */
  nextRange(minimum, maximum) {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
      throw new Error("SplitMix64 range must contain finite ascending bounds");
    }
    if (minimum === maximum) return minimum;
    return minimum + this.nextFloat() * (maximum - minimum);
  }
}
