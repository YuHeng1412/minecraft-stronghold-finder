/**
 * Test entry point: `npm test` / `node test/run.mjs`.
 *
 * Test files register themselves on import, then everything is executed by the
 * tiny harness in `helpers.mjs` (no test runner dependency needed).
 */

import './java-random.test.mjs';
import './stronghold.test.mjs';
import './triangulate.test.mjs';
import './ui-smoke.test.mjs';
import './cli.test.mjs';

import { runAll } from './helpers.mjs';

const failures = await runAll();
process.exitCode = failures === 0 ? 0 : 1;
