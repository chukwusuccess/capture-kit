import assert from 'node:assert';
import { groupPages, pagePath } from './src/pages.js';

const o = 'https://site.test';
const groups = groupPages([
  `${o}/blog/b`, `${o}/`, `${o}/blog/a`, `${o}/about`, `${o}/careers/eng`, `${o}/blog`, `${o}/docs/x?v=2`, `${o}/docs/y/`,
]);
assert.deepStrictEqual(groups.map((g) => g.label), ['Main pages', '/blog', '/docs']);
assert.deepStrictEqual(groups[0].urls.map(pagePath), ['/', '/about', '/careers/eng']);
assert.deepStrictEqual(groups[1].urls.map(pagePath), ['/blog', '/blog/a', '/blog/b']);
assert.deepStrictEqual(groups[2].urls.map(pagePath), ['/docs/x?v=2', '/docs/y']);
assert.deepStrictEqual(groupPages([]), []);
console.log('apps/extension tests passed: page grouping');
