/**
 * A faithful port of `java.util.Random` (the 48-bit linear congruential
 * generator) built on BigInt so that 48-bit arithmetic never loses precision.
 *
 * Minecraft uses this RNG for structure placement, including the concentric
 * ring layout of strongholds, so bit-exact reproduction of the stream is what
 * makes seed based predictions possible.
 */

const MASK_48 = (1n << 48n) - 1n;
const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;

/** 2^53, the denominator used by `nextDouble`. */
const TWO_POW_53 = 9007199254740992;
/** 2^27, the shift used by `nextDouble`. */
const TWO_POW_27 = 134217728;

/**
 * Java's `String.hashCode()`: `h = 31 * h + c` over UTF-16 code units with
 * 32-bit signed overflow. Minecraft falls back to this when the seed box does
 * not contain a plain number.
 *
 * @param {string} text
 * @returns {number} signed 32-bit hash
 */
export function javaStringHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Turns user input (number, bigint or text) into the 64-bit seed value that
 * Minecraft would use.
 *
 * @param {number|bigint|string} input
 * @returns {bigint}
 */
export function parseSeed(input) {
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError('Seed must be a finite number');
    return BigInt(Math.trunc(input));
  }
  const text = String(input ?? '').trim().replace(/^["']|["']$/g, '');
  if (text === '') throw new TypeError('Seed is empty');
  const numeric = text.replace(/^\+/, '');
  if (/^-?\d+$/.test(numeric)) return BigInt(numeric);
  return BigInt(javaStringHash(text));
}

/**
 * True when the input is a numeric seed rather than a text seed.
 *
 * @param {number|bigint|string} input
 */
export function isNumericSeed(input) {
  if (typeof input === 'number' || typeof input === 'bigint') return true;
  const text = String(input ?? '').trim().replace(/^["']|["']$/g, '').replace(/^\+/, '');
  return /^-?\d+$/.test(text);
}

export class JavaRandom {
  /** @param {number|bigint|string} [seed] */
  constructor(seed = 0) {
    this.setSeed(seed);
  }

  /**
   * @param {number|bigint|string} seed
   * @returns {this}
   */
  setSeed(seed) {
    this.seed = (parseSeed(seed) ^ MULTIPLIER) & MASK_48;
    return this;
  }

  /**
   * Java's `next(int bits)`: advances the LCG and returns the top `bits` bits.
   *
   * @param {number} bits 1..32
   * @returns {number} non-negative integer
   */
  next(bits) {
    this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK_48;
    return Number(this.seed >> BigInt(48 - bits));
  }

  /**
   * Java's `nextInt()`: a full signed 32-bit value.
   *
   * @returns {number}
   */
  nextInt() {
    return this.next(32) | 0;
  }

  /**
   * Java's `nextInt(bound)` including the power-of-two shortcut and the
   * modulo-rejection loop.
   *
   * @param {number} bound
   * @returns {number} value in `[0, bound)`
   */
  nextIntBounded(bound) {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError('bound must be a positive integer');
    }
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits;
    let val;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }

  /**
   * Java's `nextLong()`: two 32-bit draws, high word first. Both draws are
   * *signed* ints that sign-extend before they are combined, so a negative low
   * word carries into the high word - this is not a plain bit concatenation.
   * Returned as a BigInt because the result does not fit in a JS number.
   *
   * @returns {bigint}
   */
  nextLong() {
    const high = BigInt(this.next(32) | 0);
    const low = BigInt(this.next(32) | 0);
    const value = (high << 32n) + low;
    const wrapped = (((value % (1n << 64n)) + (1n << 64n)) % (1n << 64n));
    return wrapped >= 1n << 63n ? wrapped - (1n << 64n) : wrapped;
  }

  /**
   * Java's `nextDouble()`: `((next(26) << 27) + next(27)) / 2^53`.
   *
   * @returns {number} value in `[0, 1)`
   */
  nextDouble() {
    const high = this.next(26);
    const low = this.next(27);
    return (high * TWO_POW_27 + low) / TWO_POW_53;
  }

  /**
   * Java's `nextBoolean()`.
   *
   * @returns {boolean}
   */
  nextBoolean() {
    return this.next(1) !== 0;
  }

  /**
   * A copy of the current internal state, which makes it cheap to branch a
   * random stream (used by the tests and by callers that need to peek ahead).
   *
   * @returns {bigint}
   */
  getState() {
    return this.seed;
  }
}
