/**
 * Browser UI.
 *
 * Three screens: eye of ender triangulation (the main tool), seed based
 * prediction, and a walkthrough. All state lives in localStorage and can be
 * shared through the URL hash, so the page works offline and can be linked.
 */

import {
  MAX_STRONGHOLD_RADIUS,
  RELOCATION_RADIUS,
  RINGS,
  VERSIONS,
  generateStrongholds,
} from './stronghold.js';
import {
  DEFAULT_POSITION_SIGMA,
  DEFAULT_YAW_SIGMA_DEG,
  solveMeasurements,
} from './triangulate.js';

const STORAGE_KEY = 'minecraft-stronghold-finder:v1';

const MESSAGES = {
  zh: {
    'result.empty': '至少需要两条测量记录才能定位。',
    'result.title': '估计位置',
    'result.chunk': '区块',
    'result.distance': '距原点',
    'result.ring': '所在环',
    'result.ringBetween': '不在环内，最接近第 {ring} 环',
    'result.radius95': '95% 置信半径',
    'result.rms': '拟合残差',
    'result.lines': '视线数量',
    'result.sigma': '每条视线误差',
    'result.hint': '到目标点附近寻找楼梯口，进入要塞后请认准末地传送门房间。',
    'warn.only-two': '只有两条视线，结果就是两线交点，无法自我校验，建议再测一条。',
    'warn.backwards': '有视线的反方向才指向交点：可能瞄到了另一个要塞，或数据输错了。',
    'warn.out-of-range': '结果落在要塞可能出现的范围之外，可信度很低。',
    'warn.weak-geometry': '两条视线夹角太小，交点对误差极其敏感，请把两次抛眼的位置拉开。',
    'warn.noisy': '拟合残差较大，说明测量本身不够准，多测几条可以互相抵消。',
    'code.need-two': '至少需要两条有效测量。',
    'code.parallel': '视线几乎平行，无法求交点：请换一个方向再抛一次末影之眼。',
    'code.diverged': '无法求解，请检查输入数据。',
    'code.baseline-too-short': '起点和末影之眼正下方的距离太近（至少 4 格），朝向角不可靠。',
    'code.nan': '有输入不是数字。',
    'code.unknown': '这条测量的格式无法识别。',
    'table.empty': '还没有测量记录。抛一次末影之眼，把数据填到左边即可。',
    'table.rejected': '已忽略',
    'toast.copied': '已复制到剪贴板',
    'toast.invalid': '请填写完整的数字',
    'toast.imported': '已导入 {count} 条测量',
    'toast.importFailed': '导入失败：文件格式不正确',
    'toast.empty': '没有可复制的内容',
    'seed.textSeed': '文本种子已按 Java String.hashCode 转换为 {seed}',
    'seed.predictable': '可推算 {predictable} / {total} 个要塞，理想点误差 ±{radius} 格',
    'seed.partial': '该版本的生物群系搜索会消耗同一个随机数流，所以只有第 1 个要塞可以精确推算，其余取决于地形。想拿到全部 128 个坐标请选 1.19.3 – 26.3，或者直接用末影之眼定位。',
    'seed.ringInfo': '第 {ring} 环：{count} 个要塞，距原点 {min} - {max} 格',
    'seed.all': '全部',
    'seed.ring': '{ring} 环',
    'seed.large': '这个种子很大，已按文本种子处理；如果想按数字种子计算请检查是否输入完整。',
    'map.origin': '原点',
    'map.solution': '估计位置',
    'map.throw': '抛眼位置',
    'map.ray': '视线',
    'map.rings': '要塞分布环',
  },
  en: {
    'result.empty': 'Add at least two measurements to locate the stronghold.',
    'result.title': 'Estimated position',
    'result.chunk': 'Chunk',
    'result.distance': 'From origin',
    'result.ring': 'Ring',
    'result.ringBetween': 'between rings, closest is ring {ring}',
    'result.radius95': '95% confidence radius',
    'result.rms': 'Fit residual',
    'result.lines': 'Lines',
    'result.sigma': 'Per line error',
    'result.hint': 'Look for the staircase near that point; inside, aim for the end portal room.',
    'warn.only-two': 'Only two lines: the result is their exact crossing and cannot be checked, a third throw helps.',
    'warn.backwards': 'At least one eye points away from the crossing: it may belong to another stronghold.',
    'warn.out-of-range': 'The result is outside the area strongholds can occupy, so it is probably wrong.',
    'warn.weak-geometry': 'The rays are nearly parallel, which magnifies every error. Walk further sideways and throw again.',
    'warn.noisy': 'The fit residual is large, so the measurements themselves are imprecise. More throws average out.',
    'code.need-two': 'At least two valid measurements are needed.',
    'code.parallel': 'The rays are almost parallel, so there is no reliable crossing. Throw from another direction.',
    'code.diverged': 'No solution, please check the numbers.',
    'code.baseline-too-short': 'The throw point and the point under the eye are closer than 4 blocks, so the bearing is unreliable.',
    'code.nan': 'One of the values is not a number.',
    'code.unknown': 'This measurement could not be read.',
    'table.empty': 'No measurements yet. Throw an eye of ender and fill in the form on the left.',
    'table.rejected': 'ignored',
    'toast.copied': 'Copied to clipboard',
    'toast.invalid': 'Please fill in complete numbers',
    'toast.imported': 'Imported {count} measurements',
    'toast.importFailed': 'Import failed: unexpected file contents',
    'toast.empty': 'Nothing to copy',
    'seed.textSeed': 'Text seed resolved to {seed} via Java String.hashCode',
    'seed.predictable': 'Can predict {predictable} of {total} strongholds, ideal point within ±{radius} blocks',
    'seed.partial': 'In this version the biome search draws from the same random stream, so only the first stronghold is predictable and the rest depend on terrain. Choose 1.19.3 - 26.3 for all 128, or just use eye triangulation.',
    'seed.ringInfo': 'Ring {ring}: {count} strongholds, {min} - {max} blocks from the origin',
    'seed.all': 'All',
    'seed.ring': 'Ring {ring}',
    'seed.large': 'That seed was treated as text; check the digits if you meant a number.',
    'map.origin': 'origin',
    'map.solution': 'estimate',
    'map.throw': 'throw',
    'map.ray': 'line of sight',
    'map.rings': 'stronghold rings',
  },
};

const state = {
  lang: 'zh',
  tab: 'eye',
  measurements: [],
  sigma: DEFAULT_POSITION_SIGMA,
  yawSigma: DEFAULT_YAW_SIGMA_DEG,
  seed: '0',
  version: 'modern',
  seedRingFilter: 'all',
};

let seedResult = null;

/** @param {string} key @param {Record<string, string|number>} [vars] */
function t(key, vars) {
  let text = MESSAGES[state.lang][key] ?? MESSAGES.zh[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** @param {number} value */
function fmt(value) {
  return Math.round(value).toLocaleString(state.lang === 'zh' ? 'zh-CN' : 'en-US');
}

/** @param {number} value @param {number} digits */
function fmtFixed(value, digits) {
  return value.toLocaleString(state.lang === 'zh' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const els = {};

function collectElements() {
  const ids = [
    'langToggle', 'tabs', 'tab-eye', 'tab-seed', 'tab-guide',
    'throwX', 'throwZ', 'eyeX', 'eyeZ', 'yaw', 'sigma', 'yawSigma',
    'addPointMeasurement', 'addYawMeasurement', 'clearMeasurements', 'loadSample',
    'exportData', 'importData', 'importFile', 'shareLink',
    'measureBody', 'measureEmpty', 'eyeResult',
    'mapCanvas', 'overviewCanvas', 'mapLegend',
    'seedInput', 'versionSelect', 'seedRingSelect', 'calcSeed', 'copySeedCsv', 'seedSummary', 'seedBody',
    'toast', 'bootWarning', 'toolVersion',
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        measurements: state.measurements,
        sigma: state.sigma,
        yawSigma: state.yawSigma,
        seed: state.seed,
        version: state.version,
        lang: state.lang,
      }),
    );
  } catch {
    /* private mode: keep working without persistence */
  }
}

function loadState() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  if (stored && typeof stored === 'object') {
    if (Array.isArray(stored.measurements)) state.measurements = stored.measurements.filter(isMeasurement);
    if (Number.isFinite(stored.sigma)) state.sigma = stored.sigma;
    if (Number.isFinite(stored.yawSigma)) state.yawSigma = stored.yawSigma;
    if (typeof stored.seed === 'string') state.seed = stored.seed;
    if (typeof stored.version === 'string') state.version = stored.version;
    if (stored.lang === 'zh' || stored.lang === 'en') state.lang = stored.lang;
  } else {
    const preferred = navigator.language || 'zh';
    state.lang = preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  const shared = readShareHash();
  if (shared) {
    if (Array.isArray(shared.measurements)) state.measurements = shared.measurements.filter(isMeasurement);
    if (Number.isFinite(shared.sigma)) state.sigma = shared.sigma;
    if (typeof shared.seed === 'string') state.seed = shared.seed;
    if (typeof shared.version === 'string') state.version = shared.version;
  }
}

/** @param {unknown} value */
function isMeasurement(value) {
  if (!value || typeof value !== 'object') return false;
  const item = /** @type {Record<string, unknown>} */ (value);
  if (item.type === 'points') return ['x1', 'z1', 'x2', 'z2'].every((key) => Number.isFinite(Number(item[key])));
  if (item.type === 'yaw') return ['x', 'z', 'yaw'].every((key) => Number.isFinite(Number(item[key])));
  return false;
}

function readShareHash() {
  const match = /[#&]d=([A-Za-z0-9\-_]+)/.exec(location.hash);
  if (!match) return null;
  try {
    return JSON.parse(decodeBase64(match[1]));
  } catch {
    return null;
  }
}

/** @param {string} text */
function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @param {string} text */
function decodeBase64(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Language and tabs
// ---------------------------------------------------------------------------

function applyLanguage() {
  document.documentElement.dataset.lang = state.lang;
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  els.langToggle.textContent = state.lang === 'zh' ? 'EN' : '中文';
  saveState();
}

/** @param {string} name */
function showTab(name) {
  state.tab = name;
  for (const button of els.tabs.querySelectorAll('button[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
  for (const section of ['eye', 'seed', 'guide']) {
    const element = document.getElementById(`tab-${section}`);
    if (element) element.hidden = section !== name;
  }
  if (name === 'seed' && !seedResult) calculateSeed();
  if (name === 'eye') drawMap();
}

/** @param {string} message */
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 1900);
}

/** @param {string} text */
async function copyText(text) {
  if (!text) {
    toast(t('toast.empty'));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copied'));
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast(t('toast.copied'));
    } catch {
      toast(t('toast.empty'));
    }
    area.remove();
  }
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

/** Reads an input as a number, treating an empty box as "not filled in". */
function readNumber(input) {
  const raw = String(input.value ?? '').trim();
  if (raw === '') return Number.NaN;
  return Number(raw);
}

function currentInputs() {
  return {
    throwX: readNumber(els.throwX),
    throwZ: readNumber(els.throwZ),
    eyeX: readNumber(els.eyeX),
    eyeZ: readNumber(els.eyeZ),
    yaw: readNumber(els.yaw),
    sigma: readNumber(els.sigma),
  };
}

function addPointMeasurement() {
  const { throwX, throwZ, eyeX, eyeZ } = currentInputs();
  if (![throwX, throwZ, eyeX, eyeZ].every(Number.isFinite)) {
    toast(t('toast.invalid'));
    return;
  }
  state.measurements.push({ type: 'points', x1: throwX, z1: throwZ, x2: eyeX, z2: eyeZ });
  renderAll();
}

function addYawMeasurement() {
  const { throwX, throwZ, yaw } = currentInputs();
  if (![throwX, throwZ, yaw].every(Number.isFinite)) {
    toast(t('toast.invalid'));
    return;
  }
  state.measurements.push({ type: 'yaw', x: throwX, z: throwZ, yaw });
  renderAll();
}

/** @param {number} index */
function removeMeasurement(index) {
  state.measurements.splice(index, 1);
  renderAll();
}

function loadSample() {
  // Three throws at a stronghold near (1720, -1345), each recorded after
  // walking a few hundred blocks along the eye, with a little human error.
  const target = { x: 1720, z: -1345 };
  const spots = [
    { x: 0, z: 0, walk: 420, drift: 2 },
    { x: 640, z: 320, walk: 380, drift: -3 },
    { x: 220, z: -700, walk: 460, drift: 1 },
  ];
  state.measurements = spots.map((spot) => {
    const dx = target.x - spot.x;
    const dz = target.z - spot.z;
    const length = Math.hypot(dx, dz);
    const normal = { x: -dz / length, z: dx / length };
    return {
      type: 'points',
      x1: spot.x,
      z1: spot.z,
      x2: Math.round(spot.x + (dx / length) * spot.walk + normal.x * spot.drift),
      z2: Math.round(spot.z + (dz / length) * spot.walk + normal.z * spot.drift),
    };
  });
  renderAll();
}

function clearMeasurements() {
  state.measurements = [];
  renderAll();
}

function exportData() {
  const payload = { measurements: state.measurements, sigma: state.sigma, seed: state.seed, version: state.version };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stronghold-measurements.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** @param {File} file */
async function importData(file) {
  try {
    const payload = JSON.parse(await file.text());
    const list = Array.isArray(payload) ? payload : payload.measurements;
    const valid = (list ?? []).filter(isMeasurement);
    if (!valid.length) throw new Error('empty');
    state.measurements = valid;
    if (Number.isFinite(payload.sigma)) state.sigma = payload.sigma;
    if (typeof payload.seed === 'string') state.seed = payload.seed;
    if (typeof payload.version === 'string') state.version = payload.version;
    renderAll();
    toast(t('toast.imported', { count: valid.length }));
  } catch {
    toast(t('toast.importFailed'));
  }
}

function shareLink() {
  const payload = { measurements: state.measurements, sigma: state.sigma, seed: state.seed, version: state.version };
  const url = `${location.origin}${location.pathname}#d=${encodeBase64(JSON.stringify(payload))}`;
  history.replaceState(null, '', `#d=${encodeBase64(JSON.stringify(payload))}`);
  copyText(url);
}

// ---------------------------------------------------------------------------
// Rendering: eye tab
// ---------------------------------------------------------------------------

function solve() {
  return solveMeasurements(state.measurements, { sigma: state.sigma, yawSigma: state.yawSigma });
}

function renderMeasurements(result) {
  const body = els.measureBody;
  body.textContent = '';
  els.measureEmpty.hidden = state.measurements.length > 0;

  state.measurements.forEach((measurement, index) => {
    const row = document.createElement('tr');
    const anchor = measurement.type === 'points'
      ? `(${fmt(measurement.x1)}, ${fmt(measurement.z1)})`
      : `(${fmt(measurement.x)}, ${fmt(measurement.z)})`;
    const detail = measurement.type === 'points'
      ? `→ (${fmt(measurement.x2)}, ${fmt(measurement.z2)})`
      : `yaw ${measurement.yaw}°`;

    const cells = [String(index + 1), anchor, detail];
    for (const text of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    }

    const baselineCell = document.createElement('td');
    baselineCell.className = 'num';
    baselineCell.textContent = measurement.type === 'points'
      ? fmt(Math.hypot(measurement.x2 - measurement.x1, measurement.z2 - measurement.z1))
      : '—';
    row.appendChild(baselineCell);

    const residualCell = document.createElement('td');
    residualCell.className = 'num';
    const lineIndex = result.lines.findIndex((line) => line.from.x === (measurement.x1 ?? measurement.x) && line.from.z === (measurement.z1 ?? measurement.z));
    if (result.ok && lineIndex >= 0) {
      residualCell.textContent = fmtFixed(Math.abs(result.residuals[lineIndex]), 1);
      if (result.forward[lineIndex] === false) residualCell.classList.add('muted');
      if (result.forward[lineIndex] === false) residualCell.textContent += ' ⚠';
    } else {
      residualCell.textContent = '—';
    }
    row.appendChild(residualCell);

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.className = 'tiny danger';
    remove.textContent = '✕';
    remove.title = 'delete';
    remove.addEventListener('click', () => removeMeasurement(index));
    actionCell.appendChild(remove);
    row.appendChild(actionCell);

    if (result.rejected.some((entry) => entry.index === index)) row.classList.add('muted');
    body.appendChild(row);
  });
}

function renderResult(result) {
  const box = els.eyeResult;
  box.textContent = '';

  if (state.measurements.length < 2) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('result.empty');
    box.appendChild(empty);
    return;
  }

  if (!result.ok) {
    const error = document.createElement('p');
    error.className = 'warning';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '⚠';
    error.append(icon, document.createTextNode(t(`code.${result.code}`)));
    box.appendChild(error);
    return;
  }

  const title = document.createElement('h2');
  title.textContent = t('result.title');
  box.appendChild(title);

  const value = document.createElement('div');
  value.className = 'result-value';
  value.textContent = `X ${fmt(result.x)}   Z ${fmt(result.z)}`;
  box.appendChild(value);

  const copyRow = document.createElement('div');
  copyRow.className = 'row buttons';
  const copyTp = document.createElement('button');
  copyTp.className = 'tiny';
  copyTp.textContent = '/tp 指令';
  copyTp.addEventListener('click', () => copyText(`/tp @s ${Math.round(result.x)} ~ ${Math.round(result.z)}`));
  const copyXz = document.createElement('button');
  copyXz.className = 'tiny';
  copyXz.textContent = 'X Z';
  copyXz.addEventListener('click', () => copyText(`${Math.round(result.x)} ${Math.round(result.z)}`));
  const copyNether = document.createElement('button');
  copyNether.className = 'tiny';
  copyNether.textContent = '地狱坐标';
  copyNether.addEventListener('click', () => copyText(`${Math.round(result.x / 8)} ${Math.round(result.z / 8)}`));
  copyRow.append(copyTp, copyXz, copyNether);
  box.appendChild(copyRow);

  const ringText = result.ring
    ? `${result.ring} / 8`
    : t('result.ringBetween', { ring: result.nearestRing });
  const lines = [
    [t('result.chunk'), `(${Math.floor(result.x / 16)}, ${Math.floor(result.z / 16)})`],
    [t('result.distance'), `${fmt(result.distance)} 格`],
    [t('result.ring'), ringText],
    [t('result.radius95'), `± ${fmt(result.radius95)} 格`],
    [t('result.rms'), `${fmtFixed(result.rms, 1)} 格`],
    [t('result.lines'), `${result.lineCount}`],
    [t('result.sigma'), result.sigmas.map((sigma) => fmtFixed(sigma, 1)).join(', ')],
  ];
  for (const [label, text] of lines) {
    const row = document.createElement('div');
    row.className = 'result-line';
    const name = document.createElement('span');
    name.className = 'muted';
    name.textContent = label;
    const data = document.createElement('b');
    data.textContent = text;
    row.append(name, data);
    box.appendChild(row);
  }

  if (result.warnings.length) {
    const warnings = document.createElement('div');
    warnings.className = 'warnings';
    for (const warning of result.warnings) {
      const item = document.createElement('div');
      item.className = 'warning';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = '⚠';
      const text = document.createElement('span');
      text.textContent = t(`warn.${warning}`);
      item.append(icon, text);
      warnings.appendChild(item);
    }
    box.appendChild(warnings);
  }

  const hint = document.createElement('p');
  hint.className = 'small muted';
  hint.textContent = t('result.hint');
  box.appendChild(hint);
}

function renderAll() {
  state.sigma = readNumber(els.sigma) || DEFAULT_POSITION_SIGMA;
  state.yawSigma = readNumber(els.yawSigma) || DEFAULT_YAW_SIGMA_DEG;
  const result = solve();
  renderMeasurements(result);
  renderResult(result);
  drawMap(result);
  saveState();
}

// ---------------------------------------------------------------------------
// Rendering: map
// ---------------------------------------------------------------------------

/** @param {HTMLCanvasElement} canvas */
function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = Math.round(width * (canvas.height / canvas.width));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

/** Rounds a grid spacing up to a readable value (10, 20, 50, 100, ...). */
function niceStep(target) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const step of steps) if (step >= target) return step;
  return 50000;
}

/** @param {object} result */
function drawMap(result = solve()) {
  drawMainMap(result);
  drawOverview(result);
}

/** @param {object} result */
function drawMainMap(result) {
  const canvas = els.mapCanvas;
  if (!canvas) return;
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const points = [];
  for (const line of result.lines ?? []) {
    points.push({ x: line.from.x, z: line.from.z });
    if (line.to) points.push({ x: line.to.x, z: line.to.z });
  }
  if (result.ok) points.push({ x: result.x, z: result.z });
  if (!points.length) {
    ctx.fillStyle = '#93a1b1';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('—', 16, 28);
    return;
  }

  const minContentX = Math.min(...points.map((p) => p.x));
  const maxContentX = Math.max(...points.map((p) => p.x));
  const minContentZ = Math.min(...points.map((p) => p.z));
  const maxContentZ = Math.max(...points.map((p) => p.z));

  // Fit the content, then derive the visible world window from the canvas
  // aspect ratio so the plot uses the whole panel without distorting angles.
  const pad = 38;
  const spanX = Math.max(maxContentX - minContentX, 120);
  const spanZ = Math.max(maxContentZ - minContentZ, 120);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ) * 0.9;
  const centreX = (minContentX + maxContentX) / 2;
  const centreZ = (minContentZ + maxContentZ) / 2;
  const halfW = width / 2 / scale;
  const halfH = height / 2 / scale;
  const minX = centreX - halfW;
  const maxX = centreX + halfW;
  const minZ = centreZ - halfH;
  const maxZ = centreZ + halfH;
  const toScreenX = (x) => (x - centreX) * scale + width / 2;
  const toScreenY = (z) => (z - centreZ) * scale + height / 2;

  // Grid
  const step = niceStep(Math.max(maxX - minX, maxZ - minZ) / 8);
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, Consolas, monospace';
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    const sx = toScreenX(x);
    ctx.strokeStyle = x === 0 ? 'rgba(162,115,242,0.5)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(sx, pad - 12);
    ctx.lineTo(sx, height - pad + 12);
    ctx.stroke();
    ctx.fillStyle = '#6d7c8c';
    ctx.fillText(String(Math.round(x)), sx + 3, height - 8);
  }
  for (let z = Math.ceil(minZ / step) * step; z <= maxZ; z += step) {
    const sy = toScreenY(z);
    ctx.strokeStyle = z === 0 ? 'rgba(162,115,242,0.5)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(pad - 12, sy);
    ctx.lineTo(width - pad + 12, sy);
    ctx.stroke();
    ctx.fillStyle = '#6d7c8c';
    ctx.fillText(String(Math.round(z)), 4, sy - 3);
  }

  // Confidence circle
  if (result.ok) {
    ctx.beginPath();
    ctx.arc(toScreenX(result.x), toScreenY(result.z), Math.max(3, result.radius95 * scale), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(67,209,122,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(67,209,122,0.55)';
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Rays
  const reach = Math.hypot(maxX - minX, maxZ - minZ) * 1.6;
  result.lines?.forEach((line, index) => {
    const x0 = toScreenX(line.from.x);
    const y0 = toScreenY(line.from.z);
    ctx.strokeStyle = '#5aa9e6';
    ctx.lineWidth = 2;
    if (line.to) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(toScreenX(line.to.x), toScreenY(line.to.z));
      ctx.stroke();
    }
    const forward = result.ok ? result.forward?.[index] !== false : true;
    ctx.strokeStyle = forward ? 'rgba(90,169,230,0.45)' : 'rgba(255,107,107,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + line.dx * reach * scale * (forward ? 1 : -1), y0 + line.dz * reach * scale * (forward ? 1 : -1));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(x0, y0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#5aa9e6';
    ctx.fill();
    ctx.fillStyle = '#93a1b1';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.fillText(`#${index + 1}`, x0 + 7, y0 - 6);
  });

  // Solution
  if (result.ok) {
    const sx = toScreenX(result.x);
    const sy = toScreenY(result.z);
    ctx.strokeStyle = '#43d17a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx - 11, sy);
    ctx.lineTo(sx + 11, sy);
    ctx.moveTo(sx, sy - 11);
    ctx.lineTo(sx, sy + 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#43d17a';
    ctx.fill();
  }

  // Origin marker
  if (minX < 0 && maxX > 0 && minZ < 0 && maxZ > 0) {
    const ox = toScreenX(0);
    const oy = toScreenY(0);
    ctx.strokeStyle = 'rgba(162,115,242,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox - 9, oy);
    ctx.lineTo(ox + 9, oy);
    ctx.moveTo(ox, oy - 9);
    ctx.lineTo(ox, oy + 9);
    ctx.stroke();
  }
}

/** @param {object} result */
function drawOverview(result) {
  const canvas = els.overviewCanvas;
  if (!canvas) return;
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const centre = { x: width / 2, y: height / 2 };
  const radius = Math.min(width, height) / 2 - 14;
  const world = MAX_STRONGHOLD_RADIUS * 1.08;
  const scale = radius / world;
  const toScreen = (x, z) => ({ x: centre.x + x * scale, y: centre.y + z * scale });

  ctx.lineWidth = 1;
  for (const band of RINGS) {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, band.max * scale, 0, Math.PI * 2);
    ctx.arc(centre.x, centre.y, band.min * scale, 0, Math.PI * 2, true);
    ctx.fillStyle = band.ring % 2 ? 'rgba(90,169,230,0.10)' : 'rgba(162,115,242,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(centre.x - radius, centre.y);
  ctx.lineTo(centre.x + radius, centre.y);
  ctx.moveTo(centre.x, centre.y - radius);
  ctx.lineTo(centre.x, centre.y + radius);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centre.x, centre.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(162,115,242,0.95)';
  ctx.fill();

  for (const line of result.lines ?? []) {
    const point = toScreen(line.from.x, line.from.z);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#5aa9e6';
    ctx.fill();
  }

  if (result.ok) {
    const point = toScreen(result.x, result.z);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#43d17a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(67,209,122,0.6)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(6, result.radius95 * scale), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#6d7c8c';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(`±${fmt(MAX_STRONGHOLD_RADIUS)}`, centre.x + 4, centre.y - radius + 10);
}

// ---------------------------------------------------------------------------
// Rendering: seed tab
// ---------------------------------------------------------------------------

function renderVersionSelect() {
  els.versionSelect.textContent = '';
  for (const version of VERSIONS) {
    const option = document.createElement('option');
    option.value = version.id;
    option.textContent = state.lang === 'zh' ? (version.labelZh ?? version.label) : version.label;
    els.versionSelect.appendChild(option);
  }
  els.versionSelect.value = state.version;

  els.seedRingSelect.textContent = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = t('seed.all');
  els.seedRingSelect.appendChild(all);
  for (const band of RINGS) {
    const option = document.createElement('option');
    option.value = String(band.ring);
    option.textContent = t('seed.ring', { ring: band.ring });
    els.seedRingSelect.appendChild(option);
  }
  els.seedRingSelect.value = state.seedRingFilter;
}

function calculateSeed() {
  state.seed = els.seedInput.value.trim() || '0';
  els.seedInput.value = state.seed;
  state.version = els.versionSelect.value;
  try {
    seedResult = generateStrongholds(state.seed, { version: state.version });
  } catch {
    seedResult = null;
    els.seedSummary.textContent = '';
    els.seedBody.textContent = '';
    toast(t('toast.invalid'));
    return;
  }
  saveState();
  renderSeed();
}

function renderSeed() {
  if (!seedResult) return;
  const summary = els.seedSummary;
  summary.textContent = '';

  const head = document.createElement('div');
  head.className = 'result-line';
  const seedLabel = document.createElement('b');
  seedLabel.className = 'mono';
  seedLabel.textContent = `seed ${seedResult.seed}`;
  head.appendChild(seedLabel);
  const versionPill = document.createElement('span');
  versionPill.className = 'pill';
  versionPill.textContent = seedResult.versionLabel;
  head.appendChild(versionPill);
  summary.appendChild(head);

  if (seedResult.textSeed) {
    const line = document.createElement('p');
    line.className = 'small muted';
    line.textContent = t('seed.textSeed', { seed: seedResult.seed });
    summary.appendChild(line);
  }

  const capability = document.createElement('p');
  capability.className = 'small';
  capability.textContent = t('seed.predictable', {
    predictable: seedResult.predictableCount,
    total: seedResult.totalCount,
    radius: RELOCATION_RADIUS,
  });
  summary.appendChild(capability);

  if (!seedResult.fullyPredictable) {
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = t('seed.partial');
    summary.appendChild(notice);
  }

  const filter = els.seedRingSelect.value;
  const body = els.seedBody;
  body.textContent = '';
  const rows = seedResult.strongholds.filter((entry) => filter === 'all' || String(entry.ring) === filter);
  for (const entry of rows) {
    const row = document.createElement('tr');
    const cells = [
      String(entry.index),
      String(entry.ring),
      `${fmt(entry.x)}, ${fmt(entry.z)}`,
      `${fmt(entry.staircaseX)}, ${fmt(entry.staircaseZ)}`,
      fmt(entry.distance),
      `${fmtFixed(entry.bearing, 1)}°`,
    ];
    cells.forEach((text, index) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (index >= 2) cell.className = 'num';
      row.appendChild(cell);
    });
    const action = document.createElement('td');
    const copy = document.createElement('button');
    copy.className = 'tiny';
    copy.textContent = '⧉';
    copy.addEventListener('click', () => copyText(`${entry.x} ${entry.z}`));
    action.appendChild(copy);
    row.appendChild(action);
    body.appendChild(row);
  }

  if (filter !== 'all') {
    const band = RINGS[Number(filter) - 1];
    const info = document.createElement('p');
    info.className = 'small muted';
    info.textContent = t('seed.ringInfo', { ring: band.ring, count: band.count, min: band.min, max: band.max });
    summary.appendChild(info);
  }
}

function copySeedCsv() {
  if (!seedResult) return;
  const lines = ['index,ring,x,z,staircaseX,staircaseZ,distance,bearing'];
  for (const entry of seedResult.strongholds) {
    lines.push(
      [entry.index, entry.ring, entry.x, entry.z, entry.staircaseX, entry.staircaseZ, Math.round(entry.distance), entry.bearing.toFixed(1)].join(','),
    );
  }
  copyText(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  els.langToggle.addEventListener('click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    applyLanguage();
    renderVersionSelect();
    renderSeed();
    renderAll();
  });

  for (const button of els.tabs.querySelectorAll('button[data-tab]')) {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  }

  els.addPointMeasurement.addEventListener('click', addPointMeasurement);
  els.addYawMeasurement.addEventListener('click', addYawMeasurement);
  els.clearMeasurements.addEventListener('click', clearMeasurements);
  els.loadSample.addEventListener('click', loadSample);
  els.exportData.addEventListener('click', exportData);
  els.shareLink.addEventListener('click', shareLink);
  els.importData.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = '';
  });
  els.sigma.addEventListener('input', renderAll);
  els.yawSigma.addEventListener('input', renderAll);

  els.calcSeed.addEventListener('click', calculateSeed);
  els.copySeedCsv.addEventListener('click', copySeedCsv);
  els.versionSelect.addEventListener('change', () => {
    state.version = els.versionSelect.value;
    calculateSeed();
  });
  els.seedRingSelect.addEventListener('change', () => {
    state.seedRingFilter = els.seedRingSelect.value;
    renderSeed();
  });
  els.seedInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') calculateSeed();
  });
  els.seedInput.addEventListener('input', () => {
    state.seed = els.seedInput.value;
    saveState();
  });

  window.addEventListener('resize', () => drawMap());
}

function boot() {
  collectElements();
  loadState();
  applyLanguage();
  renderVersionSelect();
  els.sigma.value = String(state.sigma);
  els.yawSigma.value = String(state.yawSigma);
  els.seedInput.value = state.seed;
  wire();
  showTab('eye');
  renderAll();
  calculateSeed();
  if (els.toolVersion) els.toolVersion.textContent = 'v1.0.1';
  if (els.bootWarning) els.bootWarning.hidden = true;
  window.__STRONGHOLD_FINDER_READY__ = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { state, solve, t };
