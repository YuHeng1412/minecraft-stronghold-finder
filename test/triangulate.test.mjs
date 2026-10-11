import { JavaRandom } from '../src/java-random.js';
import {
  DEFAULT_POSITION_SIGMA,
  directionFromYaw,
  lineFromPoints,
  lineFromYaw,
  solveLines,
  solveMeasurements,
  toLine,
  yawFromDirection,
} from '../src/triangulate.js';
import { assert, assertClose, assertEqual, test } from './helpers.mjs';

test('yaw 0 looks at +Z and yaw 90 at -X, like Minecraft', () => {
  const south = directionFromYaw(0);
  assertClose(south.dx, 0, 1e-12, 'south dx');
  assertClose(south.dz, 1, 1e-12, 'south dz');
  const west = directionFromYaw(90);
  assertClose(west.dx, -1, 1e-12, 'west dx');
  assertClose(west.dz, 0, 1e-12, 'west dz');
  const north = directionFromYaw(180);
  assertClose(north.dx, 0, 1e-12, 'north dx');
  assertClose(north.dz, -1, 1e-12, 'north dz');
  const east = directionFromYaw(-90);
  assertClose(east.dx, 1, 1e-12, 'east dx');
  assertClose(east.dz, 0, 1e-12, 'east dz');
});

test('yaw and direction round trip', () => {
  for (const yaw of [-180, -120, -90, -33.3, 0, 12.5, 90, 179.9]) {
    const { dx, dz } = directionFromYaw(yaw);
    const back = yawFromDirection(dx, dz);
    // Angles live on a circle: -180 and 180 are the same bearing.
    const delta = ((back - yaw + 540) % 360) - 180;
    assertClose(delta, 0, 1e-9, `round trip ${yaw} came back as ${back}`);
  }
});

test('two crossing lines meet exactly at the stronghold', () => {
  const stronghold = { x: 1720, z: -1345 };
  const first = lineFromPoints(0, 0, stronghold.x / 3, stronghold.z / 3);
  const second = lineFromPoints(400, -900, 400 + (stronghold.x - 400) / 3, -900 + (stronghold.z + 900) / 3);
  assert(first.ok && second.ok, 'lines must be valid');
  const result = solveLines([first.line, second.line]);
  assert(result.ok, `expected a solution, got ${result.code}`);
  assertClose(result.x, stronghold.x, 2, 'x');
  assertClose(result.z, stronghold.z, 2, 'z');
  assertEqual(result.ring, 1, 'ring');
  assert(result.warnings.includes('only-two'), 'two lines should be flagged as a rough estimate');
  assert(result.rms < 2, 'noiseless data must fit tightly');
});

test('the classic throw-then-stand-under-the-eye workflow recovers the target', () => {
  const stronghold = { x: -2600, z: -900 };
  const throws = [
    { x: 0, z: 0 },
    { x: -600, z: 700 },
    { x: 500, z: 300 },
  ];
  const measurements = throws.map((spot) => {
    // The eye flies straight at the stronghold; the player walks 60 blocks
    // along that line and records where the eye hovers overhead.
    const dx = stronghold.x - spot.x;
    const dz = stronghold.z - spot.z;
    const length = Math.hypot(dx, dz);
    return {
      type: 'points',
      x1: spot.x,
      z1: spot.z,
      x2: spot.x + (dx / length) * 60,
      z2: spot.z + (dz / length) * 60,
    };
  });
  const result = solveMeasurements(measurements);
  assert(result.ok, `expected a solution, got ${result.code}`);
  assertClose(result.x, stronghold.x, 5, 'x');
  assertClose(result.z, stronghold.z, 5, 'z');
  assertEqual(result.forward.join(','), 'true,true,true', 'every ray must point forwards');
  assertEqual(result.rejected.length, 0, 'nothing should be rejected');
});

test('more measurements shrink the confidence radius', () => {
  const stronghold = { x: 1500, z: 1500 };
  const random = new JavaRandom(2024);
  const makeMeasurement = (index, count) => {
    const angle = (index * 2 * Math.PI) / count;
    const spot = { x: Math.cos(angle) * 400, z: Math.sin(angle) * 400 };
    const length = Math.hypot(stronghold.x - spot.x, stronghold.z - spot.z);
    // Walk 200 blocks along the eye, then add one block of jitter.
    return {
      type: 'points',
      x1: spot.x,
      z1: spot.z,
      x2: spot.x + ((stronghold.x - spot.x) / length) * 200 + (random.nextDouble() - 0.5) * 2,
      z2: spot.z + ((stronghold.z - spot.z) / length) * 200 + (random.nextDouble() - 0.5) * 2,
    };
  };
  const two = solveMeasurements([0, 1].map((i) => makeMeasurement(i, 2)));
  const six = solveMeasurements([0, 1, 2, 3, 4, 5].map((i) => makeMeasurement(i, 6)));
  assert(two.ok && six.ok, 'both fits must succeed');
  assert(six.radius95 < two.radius95, `six lines (${six.radius95}) must beat two (${two.radius95})`);
  assert(six.sigmaMajor < two.sigmaMajor, 'the long axis of the error ellipse must shrink');
  assert(
    Math.hypot(six.x - stronghold.x, six.z - stronghold.z) <= six.radius95,
    'the estimate must sit inside its own 95% radius',
  );
  // Residuals have to be consistent with the per line noise the model assumed.
  assert(six.rms < Math.max(...six.sigmas), `residual ${six.rms} exceeds the assumed noise`);
});

test('a longer walk along the eye gives a tighter estimate', () => {
  const stronghold = { x: 2500, z: 0 };
  const build = (walk) => {
    const spot = { x: 0, z: 0 };
    const length = Math.hypot(stronghold.x, stronghold.z);
    const measurements = [];
    for (const offset of [0, 1, 2, 3]) {
      // Four throw spots spread over a few hundred blocks of terrain.
      const from = { x: spot.x, z: spot.z + offset * 250 };
      const dx = (stronghold.x - from.x) / length;
      const dz = (stronghold.z - from.z) / length;
      measurements.push({
        type: 'points',
        x1: from.x,
        z1: from.z,
        x2: from.x + dx * walk,
        z2: from.z + dz * walk,
      });
    }
    return solveMeasurements(measurements);
  };
  const shortWalk = build(20);
  const longWalk = build(400);
  assert(shortWalk.ok && longWalk.ok, 'both fits must succeed');
  assert(
    longWalk.radius95 < shortWalk.radius95 / 3,
    `walking 400 blocks instead of 20 must tighten the estimate (${shortWalk.radius95} -> ${longWalk.radius95})`,
  );
});

test('the 95% radius covers the true position for realistic jitter', () => {
  const random = new JavaRandom(7);
  let covered = 0;
  const trials = 60;
  for (let trial = 0; trial < trials; trial++) {
    const stronghold = { x: 1200 + random.nextDouble() * 800, z: -600 - random.nextDouble() * 800 };
    const measurements = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI * 2) / 4 + random.nextDouble() * 0.4;
      const spot = { x: Math.cos(angle) * 500, z: Math.sin(angle) * 500 };
      const length = Math.hypot(stronghold.x - spot.x, stronghold.z - spot.z);
      const jitter = () => (random.nextDouble() - 0.5) * 3; // +/-1.5 blocks
      measurements.push({
        type: 'points',
        x1: spot.x + jitter(),
        z1: spot.z + jitter(),
        x2: spot.x + ((stronghold.x - spot.x) / length) * 40 + jitter(),
        z2: spot.z + ((stronghold.z - spot.z) / length) * 40 + jitter(),
      });
    }
    const result = solveMeasurements(measurements, { sigma: DEFAULT_POSITION_SIGMA });
    if (!result.ok) continue;
    if (Math.hypot(result.x - stronghold.x, result.z - stronghold.z) <= result.radius95) covered++;
  }
  assert(covered >= trials * 0.85, `the 95% radius should cover the truth, covered ${covered}/${trials}`);
});

test('parallel rays are rejected instead of reporting a wild guess', () => {
  const first = lineFromYaw(0, 0, 30);
  const second = lineFromYaw(500, 800, 30.00001);
  const result = solveLines([first.line, second.line]);
  assertEqual(result.ok, false, 'must not report a solution');
  assertEqual(result.code, 'parallel');
});

test('a single measurement is not enough', () => {
  const result = solveMeasurements([{ type: 'yaw', x: 0, z: 0, yaw: 10 }]);
  assertEqual(result.ok, false);
  assertEqual(result.code, 'need-two');
  assertEqual(result.rejected.length, 0, 'a lone measurement is valid, just not sufficient');
});

test('rays pointing away from the fit are flagged', () => {
  // The eye from (1000, 0) flies towards +X, so it can never lead to the
  // intersection at the origin: the second eye is the believable one.
  const first = lineFromPoints(1000, 0, 1100, 0);
  const second = lineFromPoints(0, 1000, 0, 900);
  const result = solveLines([first.line, second.line]);
  assert(result.ok, 'geometrically there is still an intersection');
  assertClose(result.x, 0, 1, 'x');
  assertClose(result.z, 0, 1, 'z');
  assert(result.warnings.includes('backwards'), 'the backwards warning must fire');
  assertEqual(result.forward.join(','), 'false,true', 'only the second ray points forwards');
});

test('degenerate measurements are rejected with a reason', () => {
  assertEqual(lineFromPoints(10, 10, 11, 11).code, 'baseline-too-short');
  assertEqual(lineFromPoints(0, 0, Number.NaN, 5).code, 'nan');
  assertEqual(lineFromYaw(0, 0, Number.NaN).code, 'nan');
  assertEqual(toLine({ type: 'nonsense' }).code, 'unknown');
  const result = solveMeasurements([
    { type: 'points', x1: 0, z1: 0, x2: 0, z2: 1 },
    { type: 'yaw', x: 0, z: 0, yaw: 90 },
    { type: 'yaw', x: 0, z: 900, yaw: 80 },
  ]);
  assertEqual(result.rejected.length, 1, 'the degenerate measurement must be reported');
  assertEqual(result.rejected[0].code, 'baseline-too-short');
  assert(result.ok, 'the remaining two lines still produce a solution');
});

test('yaw based measurements work and match the two point form', () => {
  const stronghold = { x: 3000, z: 1000 };
  const spot = { x: -200, z: 400 };
  const yaw = yawFromDirection(stronghold.x - spot.x, stronghold.z - spot.z);
  const viaYaw = lineFromYaw(spot.x, spot.z, yaw);
  const distance = Math.hypot(stronghold.x - spot.x, stronghold.z - spot.z);
  const viaPoints = lineFromPoints(
    spot.x,
    spot.z,
    spot.x + ((stronghold.x - spot.x) / distance) * 1000,
    spot.z + ((stronghold.z - spot.z) / distance) * 1000,
  );
  assertClose(viaYaw.line.dx, viaPoints.line.dx, 1e-9, 'dx');
  assertClose(viaYaw.line.dz, viaPoints.line.dz, 1e-9, 'dz');
});

test('a triangulated point can be checked against the ring table', () => {
  const result = solveMeasurements([
    { type: 'yaw', x: 0, z: 0, yaw: 45 },
    { type: 'yaw', x: 1200, z: -400, yaw: 62 },
  ]);
  assert(result.ok, 'expected a solution');
  assert(result.distance > 0, 'distance from origin');
  assert(result.nearestRing >= 1 && result.nearestRing <= 8, 'ring in range');
});
