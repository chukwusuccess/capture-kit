import assert from 'node:assert/strict';
import { parseFidelityArgs } from './src/cli.js';
import { suiteFailures, type FidelityCaseResult } from './src/suite.js';
import type { FidelityReport } from './src/index.js';

// Gate inputs are measured report data, not browser/serializer replacements.
function measurement(name: string, score: number): FidelityCaseResult {
  const report: FidelityReport = {
    score, strictScore: score, mismatchedPixels: 20, totalPixels: 100,
    nonWhitePixels: 80, nonWhiteScore: score,
    width: 10, height: 10, widthDelta: 0, heightDelta: 0, nodeCount: 0,
    hotspots: [], destination: 'html', diagnostics: [],
    sourceSize: { width: 10, height: 10 }, renderedSize: { width: 10, height: 10 },
    files: { original: '', rendered: '', mask: '', html: '', capture: '' },
  };
  return { name, status: 'measured', report };
}

const expected = ['desktop', 'mobile'];
const measured = [measurement('desktop', 96), measurement('mobile', 84)];
assert.deepEqual(suiteFailures(expected, measured, 84), []);
assert.deepEqual(suiteFailures(expected, measured, 90), ['mobile: score 84% < requested 90%']);
assert.deepEqual(suiteFailures(expected, measured.slice(0, 1), 0), ['mobile: expected one result, received 0']);
assert.deepEqual(suiteFailures(['desktop'], [measured[0], measured[0]], 0), ['desktop: expected one result, received 2']);
assert.deepEqual(suiteFailures(['mobile'], [{ name: 'mobile', status: 'error', error: 'Chrome capture failed', artifacts: '/artifacts' }], 0), ['mobile: Chrome capture failed']);
assert.deepEqual(suiteFailures(['mobile'], [measurement('mobile', NaN)], 0), ['mobile: invalid pixel measurement']);
assert.deepEqual(suiteFailures(['mobile'], [measurement('mobile', 0)]), []);
assert.deepEqual(suiteFailures([], []), ['No cases were requested']);
assert.deepEqual(suiteFailures(['desktop'], [measured[0]], NaN), ['Minimum score must be a finite percentage from 0 to 100']);

assert.deepEqual(parseFidelityArgs(['--width=390', 'https://example.test/', '--min=0', '--mobile']), {
  suite: false, help: false, width: 390, url: 'https://example.test/', minimum: 0, mobile: true,
});
assert.deepEqual(parseFidelityArgs(['--suite', '--min=92.5']), { suite: true, help: false, minimum: 92.5 });
for (const args of [
  ['--min=NaN'], ['--min=Infinity'], ['--min='], ['--min=-1'], ['--min=101'],
  ['--width=0'], ['--height=2.5'], ['--tolerance=256'], ['--timeout=-1'],
  ['--min=90', '--min=80'], ['--suite', '--width=390'],
  ['--suite', 'https://example.test/'], ['--suite', '--scroll-stitch'], ['--unknown'],
]) {
  assert.throws(() => parseFidelityArgs(args), `Invalid CLI input was accepted: ${args.join(' ')}`);
}
console.log('Fidelity CLI and measured-result gate behavior passed');
