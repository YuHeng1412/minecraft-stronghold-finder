import {
  RINGS,
  TOTAL_STRONGHOLDS,
  generateStrongholds,
  nearestRing,
  resolveVersion,
  ringOf,
  ringRange,
} from '../src/stronghold.js';
import { assert, assertEqual, assertThrows, test } from './helpers.mjs';

/** Seeds used across the placement tests. */
const SEEDS = [0, 1, -1, 42, 123456789, '-4172144997902289642', 'hello', 'Minecraft'];

test('ring table matches the vanilla layout', () => {
  assertEqual(RINGS.length, 8, 'eight rings');
  assertEqual(
    RINGS.reduce((sum, entry) => sum + entry.count, 0),
    TOTAL_STRONGHOLDS,
    'the rings hold exactly 128 strongholds',
  );
  const expected = [
    [3, 1408, 2688],
    [6, 4480, 5760],
    [10, 7552, 8832],
    [15, 10624, 11904],
    [21, 13696, 14976],
    [28, 16768, 18048],
    [36, 19840, 21120],
    [9, 22912, 24192],
  ];
  RINGS.forEach((entry, index) => {
    assertEqual(entry.count, expected[index][0], `ring ${index + 1} count`);
    assertEqual(entry.min, expected[index][1], `ring ${index + 1} min`);
    assertEqual(entry.max, expected[index][2], `ring ${index + 1} max`);
    // Each ring starts 3072 blocks further out than the previous one.
    if (index > 0) {
      assertEqual(entry.min - RINGS[index - 1].min, 3072, `ring ${index + 1} spacing`);
    }
  });
});

test('1.19.3+ yields 128 strongholds split 3/6/10/15/21/28/36/9', () => {
  for (const seed of SEEDS) {
    const { strongholds, fullyPredictable } = generateStrongholds(seed, { version: 'modern' });
    assertEqual(fullyPredictable, true, 'the forked model predicts the whole layout');
    assertEqual(strongholds.length, TOTAL_STRONGHOLDS, `seed ${seed} count`);
    const perRing = RINGS.map((entry) => strongholds.filter((s) => s.ring === entry.ring).length);
    assertEqual(perRing.join('/'), '3/6/10/15/21/28/36/9', `seed ${seed} distribution`);
    assertEqual(
      strongholds.map((s) => s.index).join(','),
      Array.from({ length: TOTAL_STRONGHOLDS }, (_, i) => i + 1).join(','),
      'indexes are sequential',
    );
  }
});

test('older models report only the first stronghold and say so', () => {
  const expectedModel = { classic: 'shared', legacy: 'legacy' };
  for (const version of ['classic', 'legacy']) {
    for (const seed of SEEDS) {
      const result = generateStrongholds(seed, { version });
      assertEqual(result.fullyPredictable, false, `${version} cannot predict everything`);
      assertEqual(result.strongholds.length, 1, `${version} must not invent positions`);
      assertEqual(result.predictableCount, 1, `${version} predictable count`);
      assertEqual(result.model, expectedModel[version], `${version} placement model`);
      assertEqual(result.note, 'shared-biome-stream', `${version} must explain itself`);
    }
  }
  assertEqual(generateStrongholds(0, { version: 'classic' }).totalCount, 128);
  assertEqual(generateStrongholds(0, { version: 'legacy' }).totalCount, 3);
});

test('strongholds land inside the distance band of their ring', () => {
  // The published bands are chunk distances, so the rounded block position may
  // overshoot the band edge by up to half a chunk plus the chunk centre offset.
  const tolerance = 24;
  for (const seed of SEEDS) {
    for (const version of ['modern', 'classic']) {
      const { strongholds } = generateStrongholds(seed, { version });
      for (const stronghold of strongholds) {
        const range = ringRange(stronghold.ring);
        assert(
          stronghold.distance >= range.min - tolerance && stronghold.distance <= range.max + tolerance,
          `seed ${seed} ${version} stronghold #${stronghold.index} (ring ${stronghold.ring}) at ${stronghold.distance.toFixed(1)} blocks is outside ${range.min}-${range.max}`,
        );
        // Ring spacing is 3072 blocks, far wider than the tolerance, so the
        // ring a stronghold lands in is unambiguous.
        assertEqual(ringOf(stronghold.distance) ?? nearestRing(stronghold.distance), stronghold.ring, 'ring lookup');
      }
    }
  }
});

test('the ideal point and the staircase share a chunk', () => {
  const { strongholds } = generateStrongholds(424242, { version: 'modern' });
  for (const stronghold of strongholds.slice(0, 20)) {
    assertEqual(Math.floor(stronghold.x / 16), Math.floor(stronghold.staircaseX / 16), 'chunk x');
    assertEqual(Math.floor(stronghold.z / 16), Math.floor(stronghold.staircaseZ / 16), 'chunk z');
    assertEqual(stronghold.x, stronghold.chunkX * 16 + 8, 'chunk centre x');
    assertEqual(stronghold.z, stronghold.chunkZ * 16 + 8, 'chunk centre z');
    assertEqual(stronghold.staircaseX, stronghold.chunkX * 16 + 4, 'staircase x');
    assertEqual(stronghold.staircaseZ, stronghold.chunkZ * 16 + 4, 'staircase z');
  }
});

test('generation is deterministic and seed dependent', () => {
  const a = generateStrongholds(777, { version: 'modern' });
  const b = generateStrongholds(777, { version: 'modern' });
  const c = generateStrongholds(778, { version: 'modern' });
  assertEqual(JSON.stringify(a.strongholds), JSON.stringify(b.strongholds), 'same seed, same layout');
  assert(JSON.stringify(a.strongholds) !== JSON.stringify(c.strongholds), 'different seeds must differ');
});

test('every model draws the first angle from the same seed, distances differ', () => {
  // The first angle is the very first draw of the stream, so all models share
  // it. The distance formula changed in 1.9, which is why the 1.8 stronghold
  // sits much closer to spawn.
  for (const seed of [0, 42, 123456789, '-4172144997902289642']) {
    const modern = generateStrongholds(seed, { version: 'modern' }).strongholds[0];
    const classic = generateStrongholds(seed, { version: 'classic' }).strongholds[0];
    const legacy = generateStrongholds(seed, { version: 'legacy' }).strongholds[0];
    assertEqual(modern.x, classic.x, `seed ${seed} classic x`);
    assertEqual(modern.z, classic.z, `seed ${seed} classic z`);
    assertEqual(legacy.angle, modern.angle, `seed ${seed} first angle`);
    assert(legacy.distance < modern.distance, `seed ${seed}: 1.8 keeps strongholds close to spawn`);
    assert(legacy.distance > 600 && legacy.distance < 1200, `seed ${seed} legacy distance ${legacy.distance}`);
  }
});

test('the forked model keeps the ring layout intact', () => {
  // Every ideal point of the forked model must stay in its own ring even
  // though the extra nextLong() shifts the jitter draws.
  const { strongholds } = generateStrongholds(-777, { version: 'modern' });
  const counts = [];
  for (const entry of strongholds) {
    assert(entry.distance >= 1400 && entry.distance <= 24200, `stronghold ${entry.index} radius ${entry.distance}`);
    counts.push(entry.ring);
  }
  assertEqual(counts.filter((r) => r === 1).length, 3, 'ring 1');
  assertEqual(counts.filter((r) => r === 2).length, 6, 'ring 2');
  assertEqual(counts.filter((r) => r === 8).length, 9, 'ring 8 holds the leftover nine');
  assertEqual(counts[counts.length - 1], 8, 'the last stronghold is in ring 8');
});

test('1.8 and older places its single known stronghold on a wide arc', () => {
  const { strongholds } = generateStrongholds(0, { version: '1.8' });
  assertEqual(strongholds.length, 1, 'only the first one is predictable');
  assertEqual(strongholds[0].ringRange, null, '1.8 has no rings');
  assert(strongholds[0].distance > 300 && strongholds[0].distance < 1200, 'between 1.25 and 2.25 chunks of 32');
});

test('text seeds are hashed like the game does', () => {
  const textSeed = generateStrongholds('hello', { version: 'modern' });
  const hashed = generateStrongholds(99162322, { version: 'modern' });
  assertEqual(textSeed.textSeed, true, 'flagged as a text seed');
  assertEqual(textSeed.seed, '99162322', 'seed shown as the resolved number');
  assertEqual(JSON.stringify(textSeed.strongholds), JSON.stringify(hashed.strongholds), 'hash must be used');
  assertEqual(generateStrongholds('-42').textSeed, false, 'numeric seeds are not text seeds');
});

test('version aliases resolve to the right placement generation', () => {
  assertEqual(resolveVersion('modern').id, 'modern');
  assertEqual(resolveVersion('1.21').id, 'modern');
  assertEqual(resolveVersion('1.20.4').id, 'modern');
  assertEqual(resolveVersion('1.19.3').id, 'modern');
  assertEqual(resolveVersion('1.19.2').id, 'classic');
  assertEqual(resolveVersion('1.16.5').id, 'classic');
  assertEqual(resolveVersion('1.12').id, 'classic');
  assertEqual(resolveVersion('1.8.9').id, 'legacy');
  assertEqual(resolveVersion('').id, 'modern');
  assertThrows(() => resolveVersion('1.9.9.9'), 'garbage versions must throw');
});

test('ring helpers agree with the table', () => {
  assertEqual(ringOf(2000), 1);
  assertEqual(ringOf(5000), 2);
  assertEqual(ringOf(3000), null, 'between rings');
  assertEqual(nearestRing(3000), 1);
  assertEqual(nearestRing(4000), 2);
  assertEqual(ringRange(1).min, 1408);
  assertEqual(ringRange(9), null);
});
