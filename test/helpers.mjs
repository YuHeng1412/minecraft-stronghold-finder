/**
 * Minimal dependency-free test harness so the suite runs on a bare Node
 * install (`node test/run.mjs`) as well as through `npm test`.
 */

const registry = [];

/**
 * Registers a test case.
 *
 * @param {string} name
 * @param {() => void|Promise<void>} fn
 */
export function test(name, fn) {
  registry.push({ name, fn });
}

/** @param {unknown} value @param {string} [message] */
export function assert(value, message = 'expected a truthy value') {
  if (!value) throw new Error(message);
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${format(expected)}\n  actual:   ${format(actual)}`);
  }
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tolerance
 * @param {string} [message]
 */
export function assertClose(actual, expected, tolerance, message = '') {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message}\n  expected: ${expected} +/- ${tolerance}\n  actual:   ${actual}`);
  }
}

/**
 * @param {() => unknown} fn
 * @param {string} [message]
 */
export function assertThrows(fn, message = 'expected the call to throw') {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

/** @param {unknown} value */
function format(value) {
  return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value);
}

/**
 * Runs every registered test and prints a summary.
 *
 * @returns {Promise<number>} number of failures
 */
export async function runAll() {
  let failures = 0;
  let passed = 0;
  const started = Date.now();
  for (const { name, fn } of registry) {
    try {
      await fn();
      passed++;
      console.log(`  \u001b[32mPASS\u001b[0m ${name}`);
    } catch (error) {
      failures++;
      console.log(`  \u001b[31mFAIL\u001b[0m ${name}`);
      console.log(`       ${String(error && error.message ? error.message : error).replace(/\n/g, '\n       ')}`);
    }
  }
  const duration = Date.now() - started;
  console.log('');
  console.log(`${passed} passed, ${failures} failed (${duration} ms)`);
  return failures;
}
