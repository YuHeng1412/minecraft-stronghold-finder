#!/usr/bin/env node
/**
 * Command line interface.
 *
 *   stronghold-finder eye --measure 0,0,60,-300 --measure 400,120,460,-160
 *   stronghold-finder eye --yaw 0,0,45.5 --yaw 500,200,-30
 *   stronghold-finder seed 12345 --version 1.21 --ring 1
 *   stronghold-finder rings
 */

import process from 'node:process';

import { RINGS, RELOCATION_RADIUS, generateStrongholds, resolveVersion } from './stronghold.js';
import {
  DEFAULT_POSITION_SIGMA,
  DEFAULT_YAW_SIGMA_DEG,
  solveMeasurements,
  yawFromDirection,
} from './triangulate.js';

const VERSION = '1.0.1';

const HELP = `末地要塞定位器 · Minecraft Stronghold Finder v${VERSION}

用法:
  stronghold-finder eye   [选项]        用末影之眼三角定位
  stronghold-finder seed  <种子> [选项]  由世界种子推算要塞理想点
  stronghold-finder rings               打印各环的距离区间

eye 选项:
  --measure x1,z1,x2,z2   抛眼位置 与 末影之眼正下方位置（可重复）
  --yaw x,z,yaw           抛眼位置 与 视线朝向角 yaw（0=南/+Z, 90=西/-X，可重复）
  --sigma <格>            记录位置的误差，默认 ${DEFAULT_POSITION_SIGMA}
  --yaw-sigma <度>        角度误差（配合 --yaw），默认 ${DEFAULT_YAW_SIGMA_DEG}
  --json                  输出 JSON

seed 选项:
  --version <版本>        modern | classic | legacy | 26.3 | 1.21 | 1.16.5 ...（默认 modern）
  --ring <1-8>            只看某一环
  --limit <n>             最多输出 n 个
  --csv                   输出 CSV
  --json                  输出 JSON

示例:
  stronghold-finder eye --measure 0,0,-217,336 --measure 700,250,406,521
  stronghold-finder eye --yaw 0,0,32.9 --yaw 700,250,47.4
  stronghold-finder seed -4172144997902289642 --ring 1
  stronghold-finder seed "hello world" --limit 5
`;

/**
 * @param {string[]} argv
 * @returns {{command: string, positional: string[], options: Map<string, string[]>}}
 */
function parseArgs(argv) {
  const positional = [];
  const options = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=');
      let value = inline;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          value = next;
          i++;
        } else {
          value = 'true';
        }
      }
      if (!options.has(name)) options.set(name, []);
      options.get(name).push(value);
    } else {
      positional.push(token);
    }
  }
  return { command: positional.shift() ?? '', positional, options };
}

/** @param {Map<string, string[]>} options @param {string} name */
function flag(options, name) {
  return options.has(name);
}

/** @param {Map<string, string[]>} options @param {string} name @param {string} [fallback] */
function option(options, name, fallback) {
  const values = options.get(name);
  return values && values.length ? values[values.length - 1] : fallback;
}

/** @param {string} value @param {string} label */
function parseNumbers(value, label) {
  const parts = String(value)
    .split(/[,\s]+/)
    .filter((part) => part !== '')
    .map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} 需要数字，收到 "${value}"`);
  }
  return parts;
}

/** @param {number} value */
function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** @param {number} value @param {number} width */
function pad(value, width) {
  return String(value).padStart(width);
}

/** @param {string} value @param {number} width */
function padEnd(value, width) {
  return String(value).padEnd(width);
}

/** @param {number} value */
function signed(value) {
  return `${value >= 0 ? '' : '-'}${Math.abs(value)}`;
}

/** @param {{id: string, label: string}} version */
function describeVersion(version) {
  return `${version.id} (${version.label})`;
}

/**
 * @param {object} result
 * @param {object[]} lines
 */
function printSolution(result, lines) {
  if (!result.ok) {
    const messages = {
      'need-two': '至少需要 2 条测量记录（建议 3 条以上）。',
      parallel: '这些视线几乎平行，无法求交点。请把两次抛眼的位置分得远一些。',
      diverged: '无法求解，请检查输入数据。',
    };
    console.error(`✗ ${messages[result.code] ?? result.code}`);
    return 1;
  }

  const { x, z, distance, ring, nearestRing: nearest, radius95, rms, condition, sigmas, residuals, warnings } = result;

  console.log('测量记录');
  lines.forEach((line, index) => {
    const baseline = line.baseline ? `${round(line.baseline)} 格` : `yaw ${round(line.yaw, 2)}°`;
    const anchor = `(${signed(round(line.x))}, ${signed(round(line.z))})`;
    // Same convention as the yaw input: 0 = south (+Z), 90 = west (-X).
    const bearing = `${round(yawFromDirection(line.dx, line.dz), 1)}°`;
    console.log(
      `  #${pad(index + 1, 2)} 起点 ${padEnd(anchor, 18)} 方向 ${padEnd(bearing, 8)} ${padEnd(baseline, 12)} 残差 ${round(residuals[index], 1)} 格`,
    );
  });
  console.log('');
  console.log('估计结果');
  console.log(`  坐标        X = ${round(x)}   Z = ${round(z)}`);
  console.log(`  区块        (${Math.floor(x / 16)}, ${Math.floor(z / 16)})`);
  console.log(`  距原点      ${round(distance)} 格`);
  if (ring) {
    console.log(`  所在环      第 ${ring} 环`);
  } else {
    console.log(`  所在环      不在任何环内，最接近第 ${nearest} 环`);
  }
  console.log(`  95% 置信半径 ± ${round(radius95)} 格`);
  console.log(`  拟合残差    ${round(rms, 1)} 格（共 ${lines.length} 条视线，条件数 ${round(condition, 1)}）`);
  console.log(`  每条视线 σ  ${sigmas.map((sigma) => round(sigma, 1)).join(', ')} 格`);
  if (warnings.length) {
    const explanation = {
      'only-two': '只有两条视线：结果精确到两条线的交点，但误差无法自我校验，建议再测一条。',
      backwards: '有视线的反方向才指向交点，可能瞄的是另一个要塞或数据输错了。',
      'out-of-range': '结果落在要塞可能出现的范围之外，可信度低。',
      'weak-geometry': '两两夹角偏小，交点对误差很敏感，走远一点再测。',
      noisy: '拟合残差偏大，说明测量本身误差较大。',
    };
    console.log('');
    console.log('提示');
    for (const warning of warnings) console.log(`  ! ${explanation[warning] ?? warning}`);
  }
  console.log('');
  console.log(`到 X=${round(x)} Z=${round(z)} 附近寻找楼梯口（要塞楼梯在主世界坐标为区块内的 (4,4)）。`);
  console.log('注意：末影之眼指向要塞的生成点，实际楼梯可能有几十格偏差，接近后请再抛眼确认。');
  return 0;
}

/** @param {object} result */
function printSeedResult(result, ringFilter, limit, asCsv) {
  if (asCsv) {
    console.log('index,ring,x,z,staircaseX,staircaseZ,distance');
    for (const entry of result.strongholds) {
      console.log([entry.index, entry.ring, entry.x, entry.z, entry.staircaseX, entry.staircaseZ, round(entry.distance)].join(','));
    }
    return 0;
  }

  console.log(`种子 ${result.seed}${result.textSeed ? '（文本种子，已按 Java String.hashCode 转换）' : ''}`);
  console.log(`版本 ${result.versionLabel}`);
  console.log('');
  if (!result.fullyPredictable) {
    console.log('! 该版本中每个要塞的生物群系搜索都会消耗同一个随机数流，');
    console.log('  因此只有第 1 个要塞可以精确推算，后续要塞取决于地形。');
    console.log('  想拿到全部 128 个坐标请使用 1.19.3 及更新版本（含 26.x），或直接用末影之眼三角定位。');
    console.log('');
  }
  console.log(`能力: 可推算 ${result.predictableCount} / ${result.totalCount} 个要塞，理想点误差 ±${RELOCATION_RADIUS} 格`);
  console.log('');
  console.log('  #    环      理想点               楼梯口估计           距原点');
  let shown = 0;
  for (const entry of result.strongholds) {
    if (ringFilter && entry.ring !== ringFilter) continue;
    if (limit && shown >= limit) break;
    shown++;
    const ideal = `${signed(entry.x)}, ${signed(entry.z)}`;
    const stair = `${signed(entry.staircaseX)}, ${signed(entry.staircaseZ)}`;
    console.log(
      `  ${pad(entry.index, 4)} ${pad(entry.ring, 3)}   ${padEnd(ideal, 20)} ${padEnd(stair, 20)} ${round(entry.distance)}`,
    );
  }
  if (shown === 0) console.log('  （没有符合条件的要塞）');
  console.log('');
  if (ringFilter) {
    const band = RINGS[ringFilter - 1];
    console.log(`第 ${ringFilter} 环：${band.count} 个要塞，距离区间 ${band.min}-${band.max} 格`);
  }
  return 0;
}

function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  if (!command || flag(options, 'help') || command === 'help') {
    console.log(HELP);
    return 0;
  }

  if (command === 'rings') {
    console.log('环   要塞数量   距原点区间（格）');
    for (const entry of RINGS) {
      console.log(`  ${entry.ring}  ${pad(entry.count, 8)}   ${pad(entry.min, 6)} - ${entry.max}`);
    }
    return 0;
  }

  if (command === 'eye') {
    const sigma = Number(option(options, 'sigma', DEFAULT_POSITION_SIGMA));
    const yawSigma = Number(option(options, 'yaw-sigma', DEFAULT_YAW_SIGMA_DEG));
    const measurements = [];

    for (const raw of options.get('measure') ?? []) {
      const [x1, z1, x2, z2] = parseNumbers(raw, '--measure');
      measurements.push({ type: 'points', x1, z1, x2, z2 });
    }
    for (const raw of options.get('yaw') ?? []) {
      const [x, z, yaw] = parseNumbers(raw, '--yaw');
      measurements.push({ type: 'yaw', x, z, yaw });
    }

    if (measurements.length === 0) {
      console.error('✗ 至少要给一条 --measure 或 --yaw，用 --help 查看用法。');
      return 1;
    }

    const result = solveMeasurements(measurements, { sigma, yawSigma });
    if (flag(options, 'json')) {
      console.log(JSON.stringify({ ...result, lines: result.lines }, null, 2));
      return result.ok ? 0 : 1;
    }
    return printSolution(result, result.lines);
  }

  if (command === 'seed') {
    const seedInput = positional[0];
    if (seedInput === undefined) {
      console.error('✗ 缺少种子，例如: stronghold-finder seed 12345');
      return 1;
    }
    let result;
    try {
      result = generateStrongholds(seedInput, { version: option(options, 'version', 'modern') });
    } catch (error) {
      console.error(`✗ ${error.message}`);
      return 1;
    }
    const ringFilter = option(options, 'ring') ? Number(option(options, 'ring')) : null;
    const limit = option(options, 'limit') ? Number(option(options, 'limit')) : null;

    if (flag(options, 'json')) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    return printSeedResult(result, ringFilter, limit, flag(options, 'csv'));
  }

  console.error(`✗ 未知命令 "${command}"，用 --help 查看用法。`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
}

export { describeVersion, parseArgs, parseNumbers, resolveVersion };
