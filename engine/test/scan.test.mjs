// scan.mjs pure parts, on fixture objects shaped like GitHub REST responses. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregate, checkClaim, fenceFor, fileRecord, inFence, linkedIssue, markdownSummary,
  measurePr, outsideFiles, parsePrUrl, readPrList, reportText,
} from '../scan.mjs';

const TEST_PATCH = [
  '@@ -10,7 +10,7 @@ describe(\'formatDate\', () => {',
  '   it(\'formats an absolute date\', () => {',
  '-    expect(formatDate(d)).toBe(\'Mar 3, 2024\');',
  '+    expect(formatDate(d)).toBe(\'2 days ago\');',
  '   });',
].join('\n');

const WEAKEN_PATCH = [
  '@@ -1,6 +1,5 @@',
  '-  it(\'rejects bad input\', () => {',
  '+  it.skip(\'rejects bad input\', () => {',
  '-    expect(() => parse(\'\')).toThrow();',
  '-    assert.equal(parse(\'1\'), 1);',
  '+    // flaky',
].join('\n');

const ghFile = (filename, status, patch, extra = {}) => ({ filename, status, additions: 1, deletions: 1, patch, ...extra });

test('parsePrUrl and readPrList', () => {
  assert.deepEqual(parsePrUrl('https://github.com/acme/app/pull/42/files'), { owner: 'acme', repo: 'app', number: 42 });
  assert.equal(parsePrUrl('https://github.com/acme/app/issues/42'), null);
  assert.deepEqual(readPrList('# agent PRs\nhttps://github.com/a/b/pull/1\n\n  https://github.com/c/d/pull/2  # note\n'),
    ['https://github.com/a/b/pull/1', 'https://github.com/c/d/pull/2']);
});

test('linkedIssue: closing keywords, same-repo URLs, and nothing else', () => {
  assert.equal(linkedIssue('Fixes #123.', 'acme', 'app'), 123);
  assert.equal(linkedIssue('This PR closes #7 and more', 'acme', 'app'), 7);
  assert.equal(linkedIssue('Resolved: #9', 'acme', 'app'), 9);
  assert.equal(linkedIssue('fixes acme/app#31', 'acme', 'app'), 31);
  assert.equal(linkedIssue('See https://github.com/acme/app/issues/55 for context', 'acme', 'app'), 55);
  assert.equal(linkedIssue('See https://github.com/other/app/issues/55', 'acme', 'app'), null);
  assert.equal(linkedIssue('Mentions #12 without a keyword', 'acme', 'app'), null);
  assert.equal(linkedIssue('<!-- Fixes #99 -->', 'acme', 'app'), null);
  assert.equal(linkedIssue(null, 'acme', 'app'), null);
});

test('fileRecord: patch -> test rewrite detection with the engine rules', () => {
  const rewritten = fileRecord(ghFile('tests/formatDate.spec.ts', 'modified', TEST_PATCH));
  assert.equal(rewritten.isTest, true);
  assert.deepEqual(rewritten.test, { assertionsRemoved: 1, assertionsAdded: 1, skipsAdded: 0, rewritten: true, weakened: false });

  const weakened = fileRecord(ghFile('src/parse.test.js', 'modified', WEAKEN_PATCH));
  assert.equal(weakened.test.skipsAdded, 1);
  assert.equal(weakened.test.assertionsRemoved, 2);
  assert.equal(weakened.test.rewritten, false);
  assert.equal(weakened.test.weakened, true);

  const api = fileRecord(ghFile('src/api/articles.serializer.ts', 'removed', '@@ -1 +0,0 @@\n-x'));
  assert.equal(api.status, 'deleted');
  assert.equal(api.isApi, true);
  assert.equal(api.test, null);

  const binary = fileRecord(ghFile('tests/fixtures/logo.png', 'added', undefined));
  assert.equal(binary.noPatch, true);
  assert.equal(binary.test, null);

  const renamed = fileRecord(ghFile('src/b.ts', 'renamed', '', { previous_filename: 'src/a.ts' }));
  assert.equal(renamed.status, 'renamed');
  assert.equal(renamed.from, 'src/a.ts');
});

test('fence and outside use the build-city inFence rule', () => {
  assert.equal(inFence('src/articles/List.tsx', ['src/articles/']), true);
  assert.equal(inFence('src/articlesX/List.tsx', ['src/articles/']), false);
  assert.equal(inFence('README.md', ['README.md']), true);

  const tree = ['src/articles/List.tsx', 'src/comments/Card.tsx', 'src/shared/utils/formatDate.ts', 'tests/a.spec.ts'];
  const files = [
    { path: 'src/articles/List.tsx', status: 'modified' },
    { path: 'src/shared/utils/formatDate.ts', status: 'modified' },
    { path: 'src/profiles/new/Badge.tsx', status: 'added' },
  ];
  const fence = fenceFor(tree, files, 'Show relative dates in the article list. Profiles are out of scope.');
  // "article" -> src/articles/; "profile" matches the added folder, as build-city sees head files too.
  assert.deepEqual(fence, ['src/articles/', 'src/profiles/']);
  assert.deepEqual(outsideFiles(files, fence), ['src/shared/utils/formatDate.ts']);
  assert.equal(outsideFiles(files, []), null);
  assert.equal(outsideFiles(files, null), null);
});

test('reportText makes Markdown bullets separate sentences and drops quoted prompts', () => {
  const body = [
    '## Summary',
    '- Only changed the date formatter',
    '- [x] All tests pass',
    '<!-- START AGENT TIPS -->', 'Tip: do not edit API files', '<!-- END AGENT TIPS -->',
    '> [!NOTE]',
    '> No API changes',
    '<details><summary>Original prompt</summary>',
    'Do not add new files.',
    '</details>',
    '```',
    'npm test # all tests pass',
    '```',
    '| Command | Result |',
    '|---|---|',
    '| `npm test` | 12 passed |',
  ].join('\n');
  const text = reportText(body);
  assert.equal(text, 'Summary.\nOnly changed the date formatter.\nAll tests pass.\nNo API changes.\nCommand | Result.\n`npm test` | 12 passed.');
});

test('checkClaim follows build-city verdicts', () => {
  const files = [
    fileRecord(ghFile('src/articles/List.tsx', 'modified', '@@ -1 +1 @@\n-a\n+b')),
    fileRecord(ghFile('src/api/routes.ts', 'modified', '@@ -1 +1 @@\n-a\n+b')),
    fileRecord(ghFile('tests/formatDate.spec.ts', 'modified', TEST_PATCH)),
    fileRecord(ghFile('src/articles/New.tsx', 'added', '@@ -0,0 +1 @@\n+x')),
  ];
  const fence = ['src/articles/'];
  const v = (type) => checkClaim({ text: 't', type }, files, fence);
  assert.equal(v('scope').verdict, 'false');
  assert.match(v('scope').detail, /2 file\(s\) changed outside/);
  assert.equal(v('no_api_change').verdict, 'false');
  assert.equal(v('tests_pass').verdict, 'partial');
  assert.equal(v('no_new_files').verdict, 'false');
  assert.equal(v('feature').verdict, 'unverified');
  // Without a fence a scope claim cannot be checked.
  assert.equal(checkClaim({ text: 't', type: 'scope' }, files, null).verdict, 'unverified');
  // Clean change: everything git can check holds; a pass claim stays unverified because nothing was run.
  const clean = [fileRecord(ghFile('src/articles/List.tsx', 'modified', '@@ -1 +1 @@\n-a\n+b'))];
  for (const type of ['scope', 'no_api_change', 'no_new_files']) {
    assert.equal(checkClaim({ text: 't', type }, clean, fence).verdict, 'true', type);
  }
  assert.equal(checkClaim({ text: 't', type: 'tests_pass' }, clean, fence).verdict, 'unverified');
});

test('measurePr end to end on fixtures, then aggregate and summary', () => {
  const pr = {
    html_url: 'https://github.com/acme/app/pull/5',
    title: 'Relative dates in article list',
    body: 'Changes:\n- Only changed the article list\n- No API changes\n- All tests pass\n\nFixes #4',
    user: { login: 'Copilot' },
    state: 'closed',
    merged_at: '2026-09-01T00:00:00Z',
    base: { sha: 'b'.repeat(40) },
    head: { sha: 'h'.repeat(40) },
    changed_files: 3,
  };
  const files = [
    ghFile('src/articles/List.tsx', 'modified', '@@ -1 +1 @@\n-a\n+b'),
    ghFile('src/shared/formatDate.ts', 'modified', '@@ -1 +1 @@\n-a\n+b'),
    ghFile('tests/formatDate.spec.ts', 'modified', TEST_PATCH),
  ];
  const issue = { number: 4, title: 'Article list shows absolute dates', body: 'Use relative dates in the article list.', html_url: 'https://github.com/acme/app/issues/4' };
  const tree = { truncated: false, tree: [{ type: 'tree', path: 'src' }, { type: 'blob', path: 'src/articles/List.tsx' }, { type: 'blob', path: 'src/shared/formatDate.ts' }] };

  const r = measurePr({ url: pr.html_url, pr, files, issue, tree });
  assert.equal(r.repo, 'acme/app');
  assert.equal(r.state, 'merged');
  assert.deepEqual(r.request, { source: 'issue', number: 4, title: issue.title, url: issue.html_url });
  assert.deepEqual(r.fence.paths, ['src/articles/']);
  assert.deepEqual(r.outside, { count: 2, paths: ['src/shared/formatDate.ts', 'tests/formatDate.spec.ts'] });
  assert.equal(r.tests.rewrittenOrWeakened.length, 1);
  assert.deepEqual(r.apiFiles, []);
  const checked = Object.fromEntries(r.claims.filter((c) => c.type !== 'feature').map((c) => [c.type, c.verdict]));
  assert.deepEqual(checked, { scope: 'false', no_api_change: 'true', tests_pass: 'partial' });

  const noIssue = measurePr({ url: 'https://github.com/acme/app/pull/6', pr: { ...pr, html_url: 'https://github.com/acme/app/pull/6', body: 'Only changed the list.' }, files: files.slice(0, 1) });
  assert.equal(noIssue.request.source, 'missing');
  assert.equal(noIssue.fence, null);
  assert.equal(noIssue.outside, null);
  assert.equal(noIssue.claims[0].verdict, 'unverified');

  const a = aggregate([r, noIssue]);
  assert.equal(a.prs, 2);
  assert.equal(a.withChanges, 2);
  assert.equal(a.withFence, 1);
  assert.equal(a.outsideFence, 1);
  assert.equal(a.rewroteOrWeakenedTest, 1);
  assert.equal(a.checkableClaims, 4);
  assert.equal(a.checkedClaims, 3);
  assert.equal(a.contradicted, 1);
  assert.equal(a.partial, 1);
  assert.equal(a.held, 1);

  const md = markdownSummary([r, noIssue]);
  assert.ok(md.includes('| [acme/app#5](https://github.com/acme/app/pull/5) | Copilot | #4 | 3 |'));
  assert.ok(md.includes('Changed files outside the suggested fence: 1 of 1 PRs'));
});
