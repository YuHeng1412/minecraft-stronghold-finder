/**
 * Optional cross check against a second, independently written implementation
 * of the same vanilla algorithm: PrismarineJS/prismarine-rng.
 *
 *     git clone --depth 1 https://github.com/PrismarineJS/prismarine-rng /tmp/prismarine-rng
 *     node test/cross-check.mjs /tmp/prismarine-rng
 *
 * prismarine-rng asks a biome provider where to relocate each stronghold. By
 * handing it a provider that consumes exactly one `nextLong()` - which is what
 * vanilla's `RandomSource.fork()` does on 1.19.3+ - and then reports "no
 * relocation", the two implementations must agree on all 128 ideal points for
 * any seed. This is not part of `npm test` because it needs that external
 * checkout.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { JavaRandom } from '../src/java-random.js';
import { generateStrongholds } from '../src/stronghold.js';

const require = createRequire(import.meta.url);
const location = path.resolve(process.argv[2] || process.env.PRISMARINE_RNG_PATH || '');

if (!location) {
  console.log('usage: node test/cross-check.mjs <path to a prismarine-rng checkout>');
  process.exitCode = 2;
} else if (!existsSync(path.join(location, 'lib/structures/strongholds.js'))) {
  console.error(`no lib/structures/strongholds.js inside ${location}`);
  process.exitCode = 2;
} else {
  const StrongholdProducer = require(path.join(location, 'lib/structures/strongholds.js'));

  /** Emulates a 1.19.3+ world: fork one long per stronghold, never relocate. */
  const makeProvider = (seed) => ({
    worldSeed: seed,
    mcData: {
      isOlderThan: () => false,
      biomesArray: [],
      biomesByName: {},
    },
    findValidLocation: (x, z, radius, biomes, random) => {
      random.nextLong();
      return null;
    },
  });

  const seeds = [0, 1, -1, 42, 123456789, -4172144997902289642n];
  const random = new JavaRandom(20240611);
  for (let i = 0; i < 150; i++) {
    seeds.push(BigInt(Math.trunc((random.nextDouble() - 0.5) * 2 * 9.2e18)));
  }

  let compared = 0;
  const mismatches = [];
  for (const seed of seeds) {
    const normalized = BigInt.asIntN(64, BigInt(seed));
    const mine = generateStrongholds(normalized, { version: 'modern' }).strongholds;
    // prismarine-rng works on the same signed 64 bit seed.
    const reference = new StrongholdProducer(makeProvider(normalized)).getStrongholds();
    if (reference.length !== mine.length) {
      mismatches.push(`seed ${seed}: length ${reference.length} vs ${mine.length}`);
      continue;
    }
    for (let i = 0; i < mine.length; i++) {
      compared++;
      if (reference[i].x !== mine[i].staircaseX || reference[i].z !== mine[i].staircaseZ) {
        mismatches.push(
          `seed ${seed} stronghold #${i + 1}: prismarine (${reference[i].x}, ${reference[i].z}) vs ours (${mine[i].staircaseX}, ${mine[i].staircaseZ})`,
        );
      }
    }
  }

  console.log(`compared ${compared} ideal stronghold positions over ${seeds.length} seeds`);
  if (mismatches.length) {
    console.error(`${mismatches.length} mismatches:`);
    for (const line of mismatches.slice(0, 20)) console.error(`  ${line}`);
    process.exitCode = 1;
  } else {
    console.log('OK: both implementations agree on every position');
  }
}
