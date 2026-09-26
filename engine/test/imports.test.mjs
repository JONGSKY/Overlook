// Import tracking beyond JavaScript: Go packages and Python modules feed "may be affected" (SPEC 3.1 importedBy).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collect, goImports, pythonImports } from '../collect.mjs';
import { buildCity } from '../build-city.mjs';

process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Overlook Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Overlook Test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

let tmp, repo, base, head;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlook-imports-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  write('go.mod', 'module example.com/app\n\ngo 1.22\n');
  write('pkg/util/strings.go', 'package util\n\nfunc Upper(s string) string { return s }\n');
  write('pkg/util/strings_test.go', 'package util\n');
  write('cmd/server/main.go', 'package main\n\nimport (\n\t"fmt"\n\tu "example.com/app/pkg/util"\n)\n\nfunc main() { fmt.Println(u.Upper("x")) }\n');
  write('internal/api/handler.go', 'package api\n\nimport "example.com/app/pkg/util"\n\nvar _ = util.Upper\n');
  write('app/core/rules.py', 'def check(x):\n    return x\n');
  write('app/core/__init__.py', '');
  write('app/web/views.py', 'from app.core.rules import check\n');
  write('app/web/forms.py', 'from ..core import rules\n');
  write('app/web/__init__.py', '');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  base = git('rev-parse', 'HEAD');
  write('pkg/util/strings.go', 'package util\n\nimport "strings"\n\nfunc Upper(s string) string { return strings.ToUpper(s) }\n');
  write('app/core/rules.py', 'def check(x):\n    return bool(x)\n');
  git('add', '-A'); git('commit', '-q', '-m', 'change util and rules');
  head = git('rev-parse', 'HEAD');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('import parsers: Go blocks and aliases, Python from/import and relative', () => {
  assert.deepEqual(goImports('import (\n\t"fmt"\n\tu "example.com/app/pkg/util"\n)\n'), ['fmt', 'example.com/app/pkg/util']);
  assert.deepEqual(goImports('import "example.com/app/pkg/util"\n'), ['example.com/app/pkg/util']);
  const py = pythonImports('from app.core.rules import check\nimport os, app.core\nfrom ..core import rules\n');
  assert.deepEqual(py.map((x) => x.mod), ['app.core.rules', '..core', 'os', 'app.core']);
  assert.deepEqual(py[1].names, ['rules']);
});

test('Go and Python importers of a change outside the fence may be affected', () => {
  const e = collect({ repo, base, head, src: '.', graph: false });
  const by = Object.fromEntries(e.files.map((f) => [f.path, f]));
  // Go: both packages that import pkg/util depend on its file; its own test does not count
  assert.deepEqual(by['pkg/util/strings.go'].importedBy, ['cmd/server/main.go', 'internal/api/handler.go']);
  assert.equal(by['cmd/server/main.go'].uses['pkg/util/strings.go'], 'import "example.com/app/pkg/util"');
  // Python: absolute and relative imports both resolve to the module file
  assert.deepEqual(by['app/core/rules.py'].importedBy, ['app/web/forms.py', 'app/web/views.py']);
  const city = buildCity(e, { kind: 'overlook.audit/v1', request: { title: 't' }, fence: { paths: ['docs/'] }, claims: [] });
  const affected = city.files.filter((f) => f.kind === 'affected').map((f) => f.path).sort();
  assert.deepEqual(affected, ['app/web/forms.py', 'app/web/views.py', 'cmd/server/main.go', 'internal/api/handler.go']);
});
