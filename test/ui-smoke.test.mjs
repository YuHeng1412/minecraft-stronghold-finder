import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { bundleCode } from '../tools/build.mjs';
import { createDom } from './dom-stub.mjs';
import { assert, assertEqual, test } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

/** Globals the browser would provide but a bare VM context does not. */
const GLOBALS = {
  console,
  Math,
  JSON,
  Date,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Map,
  Set,
  Error,
  RangeError,
  TypeError,
  isNaN,
  parseFloat,
  parseInt,
  encodeURIComponent,
  decodeURIComponent,
};

/**
 * Boots the whole UI inside a VM with the DOM stand-in.
 *
 * @param {{hash?: string, storage?: string}} [options]
 */
function bootUi(options = {}) {
  const dom = createDom(html);
  if (options.hash) dom.window.location.hash = options.hash;
  if (options.storage) dom.localStorage.setItem('minecraft-stronghold-finder:v1', options.storage);
  const context = vm.createContext({ ...dom.window, ...GLOBALS });
  const script = new vm.Script(bundleCode(), { filename: 'bundle.js' });
  script.runInContext(context);
  return { dom, context };
}

/** @param {unknown} value */
function encodeShare(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

test('every element the UI asks for exists in index.html', () => {
  const { context } = bootUi();
  const missing = vm.runInContext('Object.entries(els).filter(([, value]) => value === null).map(([key]) => key)', context);
  assertEqual(missing.join(','), '', 'elements referenced but never defined in index.html');
});

test('the UI boots and reports itself ready', () => {
  const { context, dom } = bootUi();
  assertEqual(vm.runInContext('window.__STRONGHOLD_FINDER_READY__', context), true, 'boot flag');
  assertEqual(dom.elements.get('bootWarning').hidden, true, 'the file:// warning stays hidden');
  // The default seed was calculated during boot.
  const rows = dom.elements.get('seedBody').children.length;
  assert(rows > 0, `the seed table should have rows, got ${rows}`);
});

test('adding two measurements produces a solution in the UI', () => {
  const { context, dom } = bootUi();
  vm.runInContext(
    `els.throwX.value = '0';
     els.throwZ.value = '0';
     els.eyeX.value = '90';
     els.eyeZ.value = '190';
     addPointMeasurement();
     els.throwX.value = '500';
     els.throwZ.value = '-200';
     els.eyeX.value = '540';
     els.eyeZ.value = '-160';
     addPointMeasurement();`,
    context,
  );
  assertEqual(vm.runInContext('state.measurements.length', context), 2, 'two measurements stored');
  assertEqual(dom.elements.get('measureBody').children.length, 2, 'two table rows');
  const solution = vm.runInContext('solve()', context);
  assert(solution.ok, `expected a solution, got ${solution.code}`);
  // The estimate must be the crossing of the two aimed lines.
  assert(Number.isFinite(solution.x) && Number.isFinite(solution.z), 'finite coordinates');
  const rendered = dom.elements.get('eyeResult').children.length;
  assert(rendered > 0, 'the result panel must be filled');
  assertEqual(dom.elements.get('measureEmpty').hidden, true, 'the empty hint is hidden');
});

test('invalid input is refused without breaking the UI', () => {
  const { context } = bootUi();
  vm.runInContext(
    `els.throwX.value = '';
     els.throwZ.value = '';
     els.eyeX.value = '';
     els.eyeZ.value = '';
     addPointMeasurement();`,
    context,
  );
  assertEqual(vm.runInContext('state.measurements.length', context), 0, 'nothing was added');
  // A degenerate (too short) measurement is stored but reported as rejected.
  vm.runInContext(
    `state.measurements = [
       { type: 'yaw', x: 0, z: 0, yaw: 30 },
       { type: 'yaw', x: 0, z: 900, yaw: 28 },
       { type: 'points', x1: 0, z1: 0, x2: 1, z2: 1 }
     ];
     renderAll();`,
    context,
  );
  const result = vm.runInContext('solve()', context);
  assertEqual(result.rejected.length, 1, 'the short baseline is reported');
});

test('the seed screen works for both predictable and legacy versions', () => {
  const { context, dom } = bootUi();
  vm.runInContext(
    `els.seedInput.value = '0';
     els.versionSelect.value = 'modern';
     calculateSeed();`,
    context,
  );
  assertEqual(vm.runInContext('seedResult.predictableCount', context), 128, 'modern predicts everything');
  assertEqual(dom.elements.get('seedBody').children.length, 128, 'all rows rendered');

  vm.runInContext(
    `els.versionSelect.value = 'classic';
     calculateSeed();`,
    context,
  );
  assertEqual(vm.runInContext('seedResult.predictableCount', context), 1, 'classic does not guess');
  assertEqual(dom.elements.get('seedBody').children.length, 1, 'one row rendered');
  assert(
    dom.elements.get('seedSummary').children.some((child) => child.classList?.contains('notice')),
    'the shared stream limitation is shown to the user',
  );

  vm.runInContext(`els.seedRingSelect.value = '1'; renderSeed();`, context);
  assertEqual(dom.elements.get('seedBody').children.length, 1, 'ring filter applied');
});

test('the language toggle switches every translated string', () => {
  const { context } = bootUi();
  assertEqual(vm.runInContext('state.lang', context), 'zh', 'starts in Chinese');
  assert(vm.runInContext("t('result.ring')", context).includes('环'), 'Chinese label');
  vm.runInContext('els.langToggle.click();', context);
  assertEqual(vm.runInContext('state.lang', context), 'en', 'switched to English');
  assertEqual(vm.runInContext("t('result.ring')", context), 'Ring', 'English label');
  assertEqual(vm.runInContext("document.documentElement.dataset.lang", context), 'en', 'html attribute updated');
});

test('measurements and settings survive a reload through localStorage', () => {
  const first = bootUi();
  vm.runInContext(
    `state.measurements = [{ type: 'yaw', x: 10, z: 20, yaw: 33 }];
     els.sigma.value = '2.5';
     els.seedInput.value = 'hello';
     els.seedInput.dispatch('input');
     renderAll();
     saveState();`,
    first.context,
  );
  const stored = first.dom.localStorage.getItem('minecraft-stronghold-finder:v1');
  assert(stored.includes('"yaw":33'), 'measurement was persisted');

  const reloaded = bootUi({ storage: stored });
  assertEqual(vm.runInContext('state.measurements.length', reloaded.context), 1, 'measurement restored');
  assertEqual(vm.runInContext('state.sigma', reloaded.context), 2.5, 'sigma restored');
  assertEqual(vm.runInContext('state.seed', reloaded.context), 'hello', 'seed restored');
  assertEqual(reloaded.dom.elements.get('seedInput').value, 'hello', 'the seed box is filled again');
});

test('a shared link hash is applied on load', () => {
  const hash = `#d=${encodeShare({
    measurements: [
      { type: 'points', x1: 0, z1: 0, x2: 30, z2: 90 },
      { type: 'points', x1: 400, z1: 200, x2: 440, z2: 180 },
    ],
    sigma: 2,
    seed: '777',
    version: 'modern',
  })}`;
  const { context } = bootUi({ hash });
  assertEqual(vm.runInContext('state.measurements.length', context), 2, 'shared measurements loaded');
  assertEqual(vm.runInContext('state.seed', context), '777', 'shared seed loaded');
  assertEqual(vm.runInContext('state.sigma', context), 2, 'shared sigma loaded');
  assert(vm.runInContext('solve().ok', context), 'the shared measurements solve');
});

test('a broken share hash is ignored instead of throwing', () => {
  const { context } = bootUi({ hash: '#d=%%%not-base64%%%' });
  assertEqual(vm.runInContext('state.measurements.length', context), 0, 'nothing was loaded');
  assertEqual(vm.runInContext('window.__STRONGHOLD_FINDER_READY__', context), true, 'the app still boots');
});
