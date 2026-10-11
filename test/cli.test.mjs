/**
 * End to end checks of the command line interface: argument parsing, exit
 * codes and the shape of the printed report.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, assertEqual, test } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src', 'cli.mjs');

/**
 * @param {string[]} args
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('cli: two measurements solve and report the crossing', () => {
  // Both rays aim at a stronghold near (-1420, 2200); rounding the walk
  // endpoints shifts the answer by a few blocks, which is expected.
  const { status, stdout } = run(['eye', '--measure', '0,0,-217,336', '--measure', '700,250,406,521']);
  assertEqual(status, 0, 'exit code');
  assert(/X = -14\d\d\s+Z = 2[12]\d\d/.test(stdout), `expected the crossing in the report:\n${stdout}`);
  assert(stdout.includes('所在环'), 'ring information is printed');
  assert(!stdout.includes('NaN'), 'no NaN leaked into the report');
});

test('cli: yaw based measurements follow Minecraft yaw', () => {
  const { status, stdout } = run(['eye', '--yaw', '0,0,32.9', '--yaw', '700,250,47.4']);
  assertEqual(status, 0, 'exit code');
  assert(/X = -14\d\d/.test(stdout), `expected roughly X = -1420:\n${stdout}`);
  assert(stdout.includes('yaw 32.9'), 'the bearing is echoed back');
});

test('cli: a single measurement fails with a clear message', () => {
  const { status, stderr } = run(['eye', '--measure', '0,0,-217,336']);
  assertEqual(status, 1, 'exit code');
  assert(stderr.includes('2 条测量记录'), `expected an explanation, got: ${stderr}`);
});

test('cli: nearly parallel rays are refused', () => {
  const { status, stderr } = run(['eye', '--yaw', '0,0,30', '--yaw', '500,800,30.00001']);
  assertEqual(status, 1, 'exit code');
  assert(stderr.includes('平行'), `expected a parallel-ray message, got: ${stderr}`);
});

test('cli: seed prediction prints a table and honours --ring/--limit', () => {
  const all = run(['seed', '0', '--limit', '3']);
  assertEqual(all.status, 0, 'exit code');
  assert(all.stdout.includes('种子 0'), 'seed echoed');
  assert(all.stdout.includes('1.19.3 - 26.3'), 'version echoed');
  assert(all.stdout.includes('可推算 128 / 128'), 'capability line');
  assertEqual(all.stdout.split('\n').filter((line) => /^\s+\d+\s+\d+\s+-?\d/.test(line)).length, 3, 'three rows');

  const ring1 = run(['seed', '0', '--ring', '1', '--json']);
  assertEqual(ring1.status, 0, 'json exit code');
  const payload = JSON.parse(ring1.stdout);
  assertEqual(payload.strongholds.length, 128, 'json always carries everything');
  assertEqual(payload.strongholds[0].x, -200, 'first ideal point');
  assertEqual(payload.strongholds[0].staircaseX, -204, 'first staircase');
});

test('cli: legacy versions warn that only one stronghold is predictable', () => {
  const { status, stdout } = run(['seed', '12345', '--version', '1.16.5']);
  assertEqual(status, 0, 'exit code');
  assert(stdout.includes('只有第 1 个要塞'), 'the limitation is spelled out');
  assert(stdout.includes('可推算 1 / 128'), 'capability line');
  assertEqual(stdout.split('\n').filter((line) => /^\s+\d+\s+\d+\s+-?\d/.test(line)).length, 1, 'one row');
});

test('cli: text seeds are hashed like the game does', () => {
  const { status, stdout } = run(['seed', 'hello']);
  assertEqual(status, 0, 'exit code');
  assert(stdout.includes('文本种子'), 'text seed notice');
  assert(stdout.includes('种子 99162322'), 'resolved hash');
});

test('cli: csv and rings output stay machine friendly', () => {
  const csv = run(['seed', '42', '--csv']);
  assertEqual(csv.status, 0, 'exit code');
  const lines = csv.stdout.trim().split('\n');
  assertEqual(lines[0], 'index,ring,x,z,staircaseX,staircaseZ,distance', 'header');
  assertEqual(lines.length, 129, 'one header plus 128 strongholds');
  assertEqual(lines[1].split(',').length, 7, 'seven columns');

  const rings = run(['rings']);
  assertEqual(rings.status, 0, 'exit code');
  assert(rings.stdout.includes('22912 - 24192'), 'the outermost ring is listed');
});

test('cli: bad input is reported instead of crashing', () => {
  assertEqual(run(['seed']).status, 1, 'missing seed');
  assertEqual(run(['seed', '1', '--version', '1.2.3.4']).status, 1, 'unknown version');
  assertEqual(run(['eye']).status, 1, 'no measurements');
  assertEqual(run(['eye', '--measure', 'a,b,c,d']).status, 1, 'non numeric measurement');
  assertEqual(run(['nonsense']).status, 1, 'unknown command');
  assertEqual(run(['--help']).status, 0, 'help is not an error');
  assertEqual(run(['rings']).status, 0, 'rings is not an error');
});
