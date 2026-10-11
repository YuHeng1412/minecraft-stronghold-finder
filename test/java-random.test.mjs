import { JavaRandom, isNumericSeed, javaStringHash, parseSeed } from '../src/java-random.js';
import { assert, assertClose, assertEqual, assertThrows, test } from './helpers.mjs';

// Reference values published for java.util.Random: `new Random(0)` must
// reproduce them bit for bit, otherwise no seed based prediction can be right.
test('matches java.util.Random(0) reference values', () => {
  assertEqual(new JavaRandom(0).nextInt(), -1155484576, 'nextInt()');
  assertClose(new JavaRandom(0).nextDouble(), 0.730967787376657, 1e-15, 'nextDouble()');
  assertEqual(new JavaRandom(0).nextLong(), -4962768465676381896n, 'nextLong()');
  assertEqual(new JavaRandom(0).nextBoolean(), true, 'nextBoolean()');
});

test('nextLong() advances the stream by exactly two 32 bit draws', () => {
  const viaLong = new JavaRandom(12345);
  const viaNext = new JavaRandom(12345);
  viaLong.nextLong();
  viaNext.next(32);
  viaNext.next(32);
  assertEqual(viaLong.getState(), viaNext.getState(), 'stream position after nextLong');
  assertEqual(viaLong.nextDouble(), viaNext.nextDouble(), 'following value must match');
});

test('nextLong() combines two signed draws instead of concatenating bits', () => {
  const value = new JavaRandom(0).nextLong();
  const reference = new JavaRandom(0);
  const high = reference.next(32) | 0;
  const low = reference.next(32) | 0;
  // Plain arithmetic on the signed halves: this is what java.util.Random does.
  const signedComposition = BigInt(high) * 4294967296n + BigInt(low);
  assertEqual(value, signedComposition, 'java.util.Random(0).nextLong()');

  // A naive high/low bit concatenation gives a different (wrong) answer for
  // this very seed, which is what makes the check meaningful.
  const naive = new JavaRandom(0);
  const concat = ((BigInt(naive.next(32)) << 32n) + BigInt(naive.next(32))) % (1n << 64n);
  const naiveSigned = concat >= 1n << 63n ? concat - (1n << 64n) : concat;
  assert(naiveSigned !== value, 'the naive concatenation must be distinguishable');
  assertEqual(naiveSigned, -4962768461381414600n, 'documented naive result');
});

test('nextInt(bound) matches the Java algorithm', () => {
  // Power of two bounds take the shift shortcut, other bounds use rejection.
  const random = new JavaRandom(42);
  for (const bound of [2, 16, 256, 3, 10, 100, 1000]) {
    const value = random.nextIntBounded(bound);
    assert(Number.isInteger(value) && value >= 0 && value < bound, `nextInt(${bound}) out of range: ${value}`);
  }
  const powerOfTwo = new JavaRandom(7);
  const reference = new JavaRandom(7);
  assertEqual(powerOfTwo.nextIntBounded(64), Number((64n * BigInt(reference.next(31))) >> 31n));
  assertThrows(() => new JavaRandom(1).nextIntBounded(0));
});

test('the generator is deterministic and seed dependent', () => {
  const a = new JavaRandom(987654321);
  const b = new JavaRandom(987654321);
  const c = new JavaRandom(987654322);
  const sequenceA = Array.from({ length: 8 }, () => a.nextDouble());
  const sequenceB = Array.from({ length: 8 }, () => b.nextDouble());
  const sequenceC = Array.from({ length: 8 }, () => c.nextDouble());
  assertEqual(sequenceA.join(','), sequenceB.join(','), 'same seed must give the same stream');
  assert(sequenceA.join(',') !== sequenceC.join(','), 'different seeds must differ');
});

test('large 64 bit seeds stay exact when they arrive as text', () => {
  // 2^62 + 12345 does not survive a double round trip, so it must be handled
  // through BigInt (which is what the UI and CLI pass along).
  const seed = 4611686018427387904n + 12345n;
  const random = new JavaRandom(seed);
  assertEqual(random.getState(), (seed ^ 0x5deece66dn) & ((1n << 48n) - 1n), 'internal state');
  const fromText = new JavaRandom(seed.toString());
  assertEqual(random.nextDouble(), fromText.nextDouble(), 'text and BigInt seeds agree');
  assert(parseSeed('4611686018427387904') === 4611686018427387904n, 'huge seeds parse exactly');
  // Only 48 bits of the seed are ever used, so a Number that has already lost
  // precision must not be trusted - the API asks for a string or BigInt.
  assert(Number(seed) !== seed, 'a JS number cannot represent this seed exactly');
});

test('javaStringHash() matches Java String.hashCode()', () => {
  assertEqual(javaStringHash('hello'), 99162322);
  assertEqual(javaStringHash(''), 0);
  assertEqual(javaStringHash('a'), 97);
  assertEqual(javaStringHash('abc'), (97 * 31 * 31 + 98 * 31 + 99) | 0);
});

test('parseSeed() accepts numbers, big integers and text seeds', () => {
  assertEqual(parseSeed('0'), 0n);
  assertEqual(parseSeed('-1'), -1n);
  assertEqual(parseSeed('+17'), 17n);
  assertEqual(parseSeed('  42  '), 42n);
  assertEqual(parseSeed('"-99"'), -99n);
  assertEqual(parseSeed(1234), 1234n);
  assertEqual(parseSeed(1234n), 1234n);
  assertEqual(parseSeed('hello'), 99162322n);
  assertThrows(() => parseSeed(''), 'an empty seed must throw');
});

test('isNumericSeed() distinguishes numbers from text seeds', () => {
  assert(isNumericSeed('12345'));
  assert(isNumericSeed('-42'));
  assert(!isNumericSeed('hello'));
  assert(!isNumericSeed('1234abc'));
});
