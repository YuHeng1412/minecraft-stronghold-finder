#!/usr/bin/env node
/**
 * Renders docs/example.svg: the geometry of one triangulation, produced with
 * the very same solver the app uses. This is an illustration of the maths, not
 * a screenshot of the UI.
 *
 *     node tools/make-example-svg.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RINGS, MAX_STRONGHOLD_RADIUS } from '../src/stronghold.js';
import { solveMeasurements } from '../src/triangulate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A stronghold at (-1800, 1450) and three measurements taken from far apart,
// each with a small, realistic error.
const target = { x: -1800, z: 1450 };
const spots = [
  { x: 0, z: 0, walk: 420, drift: 2 },
  { x: 900, z: -400, walk: 380, drift: -3 },
  { x: -300, z: 1100, walk: 460, drift: 1 },
];
const measurements = spots.map((spot) => {
  const dx = target.x - spot.x;
  const dz = target.z - spot.z;
  const length = Math.hypot(dx, dz);
  const nx = -dz / length;
  const nz = dx / length;
  return {
    type: 'points',
    x1: spot.x,
    z1: spot.z,
    x2: Math.round(spot.x + (dx / length) * spot.walk + nx * spot.drift),
    z2: Math.round(spot.z + (dz / length) * spot.walk + nz * spot.drift),
  };
});

const result = solveMeasurements(measurements, { sigma: 1.5 });
if (!result.ok) throw new Error(`example did not solve: ${result.code}`);

const WIDTH = 1000;
const HEIGHT = 470;
const PANEL = { left: 20, top: 20, width: 600, height: 430 };
const MINI = { cx: 820, cy: 235, radius: 185 };

/** @param {number} value */
const round = (value) => Math.round(value * 10) / 10;

// --- main panel ------------------------------------------------------------
const points = [];
for (const line of result.lines) points.push({ x: line.from.x, z: line.from.z }, { x: line.to.x, z: line.to.z });
points.push({ x: result.x, z: result.z });

const spanX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
const spanZ = Math.max(...points.map((p) => p.z)) - Math.min(...points.map((p) => p.z));
const span = Math.max(spanX, spanZ, 400) * 1.35;
const centre = {
  x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
  z: (Math.min(...points.map((p) => p.z)) + Math.max(...points.map((p) => p.z))) / 2,
};
const scale = Math.min(PANEL.width / span, PANEL.height / span);
const toX = (x) => round(PANEL.left + PANEL.width / 2 + (x - centre.x) * scale);
const toY = (z) => round(PANEL.top + PANEL.height / 2 + (z - centre.z) * scale);

const parts = [];
parts.push(`<rect x="${PANEL.left}" y="${PANEL.top}" width="${PANEL.width}" height="${PANEL.height}" rx="12" fill="#0a0f16" stroke="#263241"/>`);

// Coordinate grid every 250 blocks.
const step = 250;
const minX = centre.x - PANEL.width / 2 / scale;
const maxX = centre.x + PANEL.width / 2 / scale;
const minZ = centre.z - PANEL.height / 2 / scale;
const maxZ = centre.z + PANEL.height / 2 / scale;
for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
  parts.push(`<line x1="${toX(x)}" y1="${PANEL.top}" x2="${toX(x)}" y2="${PANEL.top + PANEL.height}" stroke="#ffffff" stroke-opacity="0.05"/>`);
  parts.push(`<text x="${toX(x) + 4}" y="${PANEL.top + PANEL.height - 8}" fill="#6d7c8c" font-size="11" font-family="monospace">${x}</text>`);
}
for (let z = Math.ceil(minZ / step) * step; z <= maxZ; z += step) {
  parts.push(`<line x1="${PANEL.left}" y1="${toY(z)}" x2="${PANEL.left + PANEL.width}" y2="${toY(z)}" stroke="#ffffff" stroke-opacity="0.05"/>`);
  parts.push(`<text x="${PANEL.left + 6}" y="${toY(z) - 5}" fill="#6d7c8c" font-size="11" font-family="monospace">${z}</text>`);
}

// Confidence circle.
parts.push(
  `<circle cx="${toX(result.x)}" cy="${toY(result.z)}" r="${round(Math.max(6, result.radius95 * scale))}" fill="#43d17a" fill-opacity="0.12" stroke="#43d17a" stroke-opacity="0.55" stroke-dasharray="6 5"/>`,
);

// Rays: the measured segment plus the dashed continuation.
const reach = Math.hypot(PANEL.width, PANEL.height) * 1.4;
result.lines.forEach((line, index) => {
  parts.push(
    `<line x1="${toX(line.from.x)}" y1="${toY(line.from.z)}" x2="${toX(line.to.x)}" y2="${toY(line.to.z)}" stroke="#5aa9e6" stroke-width="2.5"/>`,
  );
  const endX = line.from.x + line.dx * (reach / scale);
  const endZ = line.from.z + line.dz * (reach / scale);
  parts.push(
    `<line x1="${toX(line.from.x)}" y1="${toY(line.from.z)}" x2="${toX(endX)}" y2="${toY(endZ)}" stroke="#5aa9e6" stroke-opacity="0.45" stroke-width="1.4" stroke-dasharray="7 6"/>`,
  );
  parts.push(`<circle cx="${toX(line.from.x)}" cy="${toY(line.from.z)}" r="4.5" fill="#5aa9e6"/>`);
  parts.push(
    `<text x="${toX(line.from.x) + 8}" y="${toY(line.from.z) - 7}" fill="#93a1b1" font-size="12" font-family="monospace">#${index + 1}</text>`,
  );
});

// Solution.
parts.push(
  `<line x1="${toX(result.x) - 12}" y1="${toY(result.z)}" x2="${toX(result.x) + 12}" y2="${toY(result.z)}" stroke="#43d17a" stroke-width="3"/>`,
  `<line x1="${toX(result.x)}" y1="${toY(result.z) - 12}" x2="${toX(result.x)}" y2="${toY(result.z) + 12}" stroke="#43d17a" stroke-width="3"/>`,
  `<circle cx="${toX(result.x)}" cy="${toY(result.z)}" r="5" fill="#43d17a"/>`,
  `<text x="${toX(result.x) + 14}" y="${toY(result.z) + 22}" fill="#43d17a" font-size="13" font-family="monospace">X=${round(result.x)} Z=${round(result.z)} ±${Math.round(result.radius95)}</text>`,
);

// --- ring overview ---------------------------------------------------------
parts.push(`<circle cx="${MINI.cx}" cy="${MINI.cy}" r="${MINI.radius}" fill="#0a0f16" stroke="#263241"/>`);
const miniScale = MINI.radius / (MAX_STRONGHOLD_RADIUS * 1.1);
for (const band of RINGS) {
  parts.push(
    `<circle cx="${MINI.cx}" cy="${MINI.cy}" r="${round(band.max * miniScale)}" fill="${band.ring % 2 ? '#5aa9e6' : '#a273f2'}" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.07"/>`,
  );
}
for (const line of result.lines) {
  parts.push(`<circle cx="${round(MINI.cx + line.from.x * miniScale)}" cy="${round(MINI.cy + line.from.z * miniScale)}" r="2.5" fill="#5aa9e6"/>`);
}
parts.push(`<circle cx="${MINI.cx}" cy="${MINI.cy}" r="3" fill="#a273f2"/>`);
parts.push(
  `<circle cx="${round(MINI.cx + result.x * miniScale)}" cy="${round(MINI.cy + result.z * miniScale)}" r="5" fill="#43d17a"/>`,
  `<circle cx="${round(MINI.cx + result.x * miniScale)}" cy="${round(MINI.cy + result.z * miniScale)}" r="${round(Math.max(6, result.radius95 * miniScale))}" fill="none" stroke="#43d17a" stroke-opacity="0.6"/>`,
);
parts.push(
  `<text x="${MINI.cx}" y="${MINI.cy - MINI.radius - 10}" fill="#93a1b1" font-size="12" font-family="monospace" text-anchor="middle">8 stronghold rings · ±${MAX_STRONGHOLD_RADIUS} blocks</text>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Stronghold triangulation example">
<rect width="${WIDTH}" height="${HEIGHT}" fill="#111823"/>
${parts.join('\n')}
</svg>
`;

mkdirSync(path.join(root, 'docs'), { recursive: true });
writeFileSync(path.join(root, 'docs', 'example.svg'), svg);

console.log(`solution X=${round(result.x)} Z=${round(result.z)} ±${round(result.radius95)} (ring ${result.ring ?? result.nearestRing})`);
console.log(`residual ${round(result.rms)} blocks, ${result.lines.length} lines, condition ${round(result.condition)}`);
console.log('wrote docs/example.svg');
