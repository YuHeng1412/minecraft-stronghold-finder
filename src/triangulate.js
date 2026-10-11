/**
 * Eye of Ender triangulation.
 *
 * A thrown Eye of Ender travels towards the stronghold it belongs to, so the
 * line that goes through the point where the eye was thrown and the point where
 * the eye hovers directly above the player points at the stronghold. Two such
 * lines from well separated spots intersect at the stronghold; with three or
 * more lines the intersection is found with a weighted least squares fit, which
 * also produces an honest uncertainty estimate.
 */

import { MAX_STRONGHOLD_RADIUS, nearestRing, ringOf, ringRange } from './stronghold.js';

/** Default uncertainty of a position the player reads off the F3 screen. */
export const DEFAULT_POSITION_SIGMA = 1.5;
/** Default uncertainty of an eye angle taken from a HUD/mod. */
export const DEFAULT_YAW_SIGMA_DEG = 0.25;
/** 95% of a chi-squared distribution with two degrees of freedom. */
const CHI2_95_2DF = 5.991;

/**
 * Direction the eye travels for a Minecraft yaw in degrees.
 * In Minecraft yaw 0 looks towards +Z (south) and yaw 90 towards -X (west).
 *
 * @param {number} yaw degrees
 * @returns {{dx: number, dz: number}} unit vector
 */
export function directionFromYaw(yaw) {
  const radians = (yaw * Math.PI) / 180;
  return { dx: -Math.sin(radians), dz: Math.cos(radians) };
}

/**
 * Inverse of {@link directionFromYaw}.
 *
 * @param {number} dx
 * @param {number} dz
 * @returns {number} yaw in degrees, in (-180, 180]
 */
export function yawFromDirection(dx, dz) {
  return (Math.atan2(-dx, dz) * 180) / Math.PI;
}

/**
 * Builds a line from two points: where the eye was thrown and where the player
 * stood while the eye hovered overhead.
 *
 * @param {number} x1 throw position
 * @param {number} z1
 * @param {number} x2 position under the hovering eye
 * @param {number} z2
 * @param {{sigma?: number}} [options]
 * @returns {{ok: true, line: object}|{ok: false, code: string}}
 */
export function lineFromPoints(x1, z1, x2, z2, options = {}) {
  const sigma = positive(options.sigma, DEFAULT_POSITION_SIGMA);
  if (![x1, z1, x2, z2].every(Number.isFinite)) return { ok: false, code: 'nan' };
  const dx = x2 - x1;
  const dz = z2 - z1;
  const baseline = Math.hypot(dx, dz);
  if (baseline < 4) return { ok: false, code: 'baseline-too-short', baseline };
  // Two independently measured points, so the direction carries
  // sqrt(2) * sigma of lateral error over the baseline length.
  const sigmaAngle = Math.atan((sigma * Math.SQRT2) / baseline);
  return {
    ok: true,
    line: {
      kind: 'points',
      x: x1,
      z: z1,
      dx: dx / baseline,
      dz: dz / baseline,
      baseline,
      sigma,
      sigmaAngle,
      sigmaYawDeg: (sigmaAngle * 180) / Math.PI,
      from: { x: x1, z: z1 },
      to: { x: x2, z: z2 },
    },
  };
}

/**
 * Builds a line from a position and the yaw of the eye.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} yaw degrees
 * @param {{sigma?: number, yawSigma?: number}} [options]
 * @returns {{ok: true, line: object}|{ok: false, code: string}}
 */
export function lineFromYaw(x, z, yaw, options = {}) {
  const sigma = positive(options.sigma, DEFAULT_POSITION_SIGMA);
  const yawSigma = positive(options.yawSigma, DEFAULT_YAW_SIGMA_DEG);
  if (![x, z, yaw].every(Number.isFinite)) return { ok: false, code: 'nan' };
  const { dx, dz } = directionFromYaw(yaw);
  return {
    ok: true,
    line: {
      kind: 'yaw',
      x,
      z,
      dx,
      dz,
      baseline: null,
      sigma,
      sigmaAngle: (yawSigma * Math.PI) / 180,
      sigmaYawDeg: yawSigma,
      from: { x, z },
      to: null,
      yaw,
    },
  };
}

/**
 * Turns a plain measurement object into a line.
 * Supported shapes:
 *   { type: 'points', x1, z1, x2, z2, sigma? }
 *   { type: 'yaw', x, z, yaw, sigma?, yawSigma? }
 *
 * @param {object} measurement
 * @param {{sigma?: number, yawSigma?: number}} [options]
 */
export function toLine(measurement, options = {}) {
  if (!measurement || typeof measurement !== 'object') return { ok: false, code: 'unknown' };
  if (measurement.type === 'points') {
    return lineFromPoints(
      Number(measurement.x1),
      Number(measurement.z1),
      Number(measurement.x2),
      Number(measurement.z2),
      { sigma: measurement.sigma ?? options.sigma },
    );
  }
  if (measurement.type === 'yaw') {
    return lineFromYaw(Number(measurement.x), Number(measurement.z), Number(measurement.yaw), {
      sigma: measurement.sigma ?? options.sigma,
      yawSigma: measurement.yawSigma ?? options.yawSigma,
    });
  }
  if ('x1' in measurement && 'x2' in measurement) {
    return toLine({ ...measurement, type: 'points' }, options);
  }
  if ('yaw' in measurement) {
    return toLine({ ...measurement, type: 'yaw' }, options);
  }
  return { ok: false, code: 'unknown' };
}

/**
 * Weighted least squares intersection of two or more lines.
 *
 * @param {Array<object>} lines lines produced by {@link lineFromPoints} or {@link lineFromYaw}
 * @param {{maxRadius?: number}} [options]
 * @returns {object} result, with `ok: false` and a `code` when it cannot be solved
 */
export function solveLines(lines, options = {}) {
  const usable = lines.filter(Boolean);
  if (usable.length < 2) return { ok: false, code: 'need-two', lineCount: usable.length };

  // The perpendicular uncertainty of a line grows with the distance to the
  // stronghold (a small angular error becomes a large offset far away), so the
  // weights depend on the solution and the fit is iterated a few times.
  let solution = null;
  let normal = null;
  for (let iteration = 0; iteration < 5; iteration++) {
    normal = buildNormalEquations(usable, solution);
    if (!(normal.det > 0) || normal.eigenMinor <= 0) {
      return { ok: false, code: 'parallel', lineCount: usable.length, condition: Infinity };
    }
    const candidate = solveNormalEquations(normal);
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) {
      return { ok: false, code: 'diverged', lineCount: usable.length };
    }
    const moved = solution ? Math.hypot(candidate.x - solution.x, candidate.z - solution.z) : Infinity;
    solution = candidate;
    if (moved < 1e-9) break;
  }
  normal = buildNormalEquations(usable, solution);

  const { a, b, d, e, f, det, eigenMajor, eigenMinor } = normal;
  const condition = eigenMajor / eigenMinor;
  if (condition > 1e6) {
    return { ok: false, code: 'parallel', lineCount: usable.length, condition };
  }

  const sigmaMajor = Math.sqrt(eigenMajor / det);
  const sigmaMinor = 1 / Math.sqrt(eigenMajor);
  const radius95 = Math.sqrt(CHI2_95_2DF * (eigenMajor / det));

  const residuals = usable.map((line) => perpendicularOffset(solution, line));
  const sigmas = normal.sigmas;
  const weightedResiduals = residuals.map((value, index) => (sigmas[index] ? value / sigmas[index] : value));
  const rms = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);
  const forward = usable.map((line) => {
    const along = (solution.x - line.x) * line.dx + (solution.z - line.z) * line.dz;
    return along > 0;
  });
  const distance = Math.hypot(solution.x, solution.z);
  const maxRadius = options.maxRadius ?? MAX_STRONGHOLD_RADIUS + 512;
  const ring = ringOf(distance);
  const warnings = [];
  if (forward.includes(false)) warnings.push('backwards');
  if (distance > maxRadius) warnings.push('out-of-range');
  if (condition > 60) warnings.push('weak-geometry');
  if (rms > 25) warnings.push('noisy');
  if (usable.length === 2) warnings.push('only-two');

  const pairAngles = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const cross = Math.abs(usable[i].dx * usable[j].dz - usable[i].dz * usable[j].dx);
      pairAngles.push((Math.asin(Math.min(1, cross)) * 180) / Math.PI);
    }
  }

  return {
    ok: true,
    code: 'ok',
    x: solution.x,
    z: solution.z,
    // Chunk the estimate falls into, handy for a /tp or for planning.
    chunkX: Math.floor(solution.x / 16),
    chunkZ: Math.floor(solution.z / 16),
    distance,
    ring,
    ringRange: ring ? ringRange(ring) : null,
    nearestRing: nearestRing(distance),
    sigmaMajor,
    sigmaMinor,
    radius95,
    condition,
    rms,
    sigmas,
    residuals,
    weightedResiduals,
    forward,
    lineCount: usable.length,
    minPairAngleDeg: pairAngles.length ? Math.min(...pairAngles) : null,
    warnings,
    matrix: { a, b, d, e, f, det },
  };
}

/**
 * Weighted normal equations of the perpendicular-distance fit.
 *
 * @param {Array<object>} lines
 * @param {{x: number, z: number}|null} point current estimate, used to size the weights
 */
function buildNormalEquations(lines, point) {
  let a = 0;
  let b = 0;
  let d = 0;
  let e = 0;
  let f = 0;
  const sigmas = [];
  for (const line of lines) {
    const reach = point ? Math.hypot(line.x - point.x, line.z - point.z) : 0;
    const sigma = Math.hypot(line.sigma, reach * Math.tan(line.sigmaAngle));
    sigmas.push(sigma);
    const weight = 1 / (sigma * sigma);
    a += weight * line.dz * line.dz;
    b += -weight * line.dx * line.dz;
    d += weight * line.dx * line.dx;
    const cross = line.x * line.dz - line.z * line.dx;
    e += weight * line.dz * cross;
    f += -weight * line.dx * cross;
  }
  const det = a * d - b * b;
  const mean = 0.5 * (a + d);
  const spread = Math.hypot(0.5 * (a - d), b);
  return { a, b, d, e, f, det, eigenMajor: mean + spread, eigenMinor: mean - spread, sigmas };
}

/** @param {object} normal */
function solveNormalEquations({ a, b, d, e, f, det }) {
  return {
    x: (e * d - b * f) / det,
    z: (a * f - b * e) / det,
  };
}

/**
 * Signed perpendicular distance between a point and a line.
 *
 * @param {{x: number, z: number}} point
 * @param {{x: number, z: number, dx: number, dz: number}} line
 */
export function perpendicularOffset(point, line) {
  return (point.x - line.x) * line.dz - (point.z - line.z) * line.dx;
}

/**
 * Runs the whole pipeline for a list of measurements and reports per
 * measurement problems as well.
 *
 * @param {Array<object>} measurements
 * @param {{sigma?: number, yawSigma?: number}} [options]
 */
export function solveMeasurements(measurements, options = {}) {
  const lines = [];
  const rejected = [];
  measurements.forEach((measurement, index) => {
    const result = toLine(measurement, options);
    if (result.ok) lines.push(result.line);
    else rejected.push({ index, code: result.code, measurement });
  });
  const solution = solveLines(lines, options);
  return { ...solution, lines, rejected };
}

/** @param {unknown} value @param {number} fallback */
function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
