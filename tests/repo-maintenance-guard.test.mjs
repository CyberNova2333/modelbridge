import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guardPath = fileURLToPath(new URL('../tools/repo_maintenance_guard.py', import.meta.url));
const python = ['python', 'python3'].find(command => {
  const probe = spawnSync(command, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { stdio: 'ignore' });
  return probe.status === 0;
});
assert.ok(python, 'Maintenance guard regression tests require Python 3.10+');
const marker = 'AKIA' + 'ABCDEFGHIJKLMNOP'; // Inert fixture, assembled to avoid embedding a token-shaped literal.
const fixtureContent = marker + '\n';
const digest = createHash('sha256').update(fixtureContent).digest('hex');
const allowName = '.repo-security-allowlist.json';
const allowed = path => ({ [path]: { sha256: digest, reason: 'Inert local regression fixture' } });

async function repository(t, path = 'fixture.txt', initialExceptions = allowed(path)) {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-guard-test-'));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('modelbridge-guard-test-'));
    await rm(target, { recursive: true, force: true });
  });
  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + join(directory, '.disabled-hooks'), '-c', 'commit.gpgsign=false', ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Isolated Git operation failed: ' + args[0]);
    return result.stdout.trim();
  }
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.name', 'Local Regression Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.autocrlf', 'false');
  const setAllowlist = exceptions => writeFile(join(directory, allowName), JSON.stringify(exceptions));
  const stage = () => git('add', '-A');
  const commit = () => { stage(); git('commit', '-qm', 'test(guard): exercise local fixture'); return git('rev-parse', 'HEAD'); };
  await writeFile(join(directory, path), fixtureContent);
  await setAllowlist(initialExceptions);
  const baseline = commit();
  function check(command, input) {
    const result = spawnSync(python, ['-B', '-X', 'utf8', guardPath, command], { cwd: directory, encoding: 'utf8', input });
    assert.equal(result.error, undefined, 'Guard process must start');
    assert.equal((result.stdout + result.stderr).includes(marker), false, 'Diagnostics must never print fixture contents');
    return { status: result.status, output: result.stdout + result.stderr };
  }
  const precommit = () => check('pre-commit');
  const prepush = (head = git('rev-parse', 'HEAD'), remote = baseline) => check('pre-push', `refs/heads/main ${head} refs/heads/main ${remote}\n`);
  return { directory, path, git, stage, commit, baseline, setAllowlist, precommit, prepush };
}

function expectBlocked(result) {
  assert.equal(result.status, 1);
  assert.match(result.output, /aws-access-key/);
}

test('revoking an exception rescans the unchanged index and pushed file', async t => {
  const h = await repository(t);
  await h.setAllowlist({});
  h.stage();
  // A permissive unstaged file cannot override the staged revocation.
  await h.setAllowlist(allowed(h.path));
  const before = await readFile(join(h.directory, h.path));
  expectBlocked(h.precommit());
  assert.deepEqual(await readFile(join(h.directory, h.path)), before);
  h.git('commit', '-qm', 'test(guard): revoke fixture exception');
  expectBlocked(h.prepush());
});

test('a changed exception hash rescans unchanged content for commit and push', async t => {
  const h = await repository(t);
  await h.setAllowlist({ [h.path]: { sha256: '0'.repeat(64), reason: 'Different content no longer authorizes this fixture' } });
  h.stage();
  expectBlocked(h.precommit());
  h.commit();
  expectBlocked(h.prepush());
});

test('deleting the entire exception file also rescans retained content', async t => {
  const h = await repository(t);
  await rm(join(h.directory, allowName));
  h.stage();
  expectBlocked(h.precommit());
  h.commit();
  expectBlocked(h.prepush());
});

test('a still-valid exact exception continues to allow unchanged content', async t => {
  const h = await repository(t);
  await h.setAllowlist({ [h.path]: { sha256: digest, reason: 'Reviewed reason updated without broadening content' } });
  h.stage();
  assert.equal(h.precommit().status, 0);
  h.commit();
  assert.equal(h.prepush().status, 0);
});

test('revocation does not rescan deleted files or unrelated worktree files', async t => {
  const h = await repository(t);
  await h.setAllowlist({});
  await rm(join(h.directory, h.path));
  h.stage();
  await writeFile(join(h.directory, 'untracked.txt'), fixtureContent);
  assert.equal(h.precommit().status, 0);
  h.git('commit', '-qm', 'test(guard): remove fixture and its exception');
  assert.equal(h.prepush().status, 0);
});

test('a later restored exception cannot hide an intermediate revoked commit', async t => {
  const h = await repository(t);
  await h.setAllowlist({});
  h.commit();
  await h.setAllowlist(allowed(h.path));
  h.commit();
  expectBlocked(h.prepush());
});

test('a merge must check revocations relative to every parent', async t => {
  // The remote already has a legacy unexcepted fixture. The second parent adds an
  // exception, then a merge retains the first parent's tree and revokes that exception.
  const h = await repository(t, 'fixture.txt', {});
  await h.setAllowlist(allowed(h.path));
  const second = h.commit();
  const firstTree = h.git('rev-parse', h.baseline + '^{tree}');
  const merge = h.git('commit-tree', firstTree, '-p', h.baseline, '-p', second, '-m', 'test(guard): merge with revoked second-parent exception');
  expectBlocked(h.prepush(merge));
});

test('exception paths are matched literally rather than as Git pathspecs', async t => {
  const h = await repository(t, 'fixture[1].txt');
  await h.setAllowlist({});
  h.stage();
  expectBlocked(h.precommit());
  h.commit();
  expectBlocked(h.prepush());
});

test('revocation retains the documented large-object content scan boundary', async t => {
  const h = await repository(t);
  const large = Buffer.alloc(8 * 1024 * 1024 + 1, 97);
  await writeFile(join(h.directory, 'large.txt'), large);
  await h.setAllowlist({ ...allowed(h.path), 'large.txt': { sha256: createHash('sha256').update(large).digest('hex'), reason: 'Large inert fixture' } });
  const baseline = h.commit();
  await h.setAllowlist(allowed(h.path));
  h.stage();
  const staged = h.precommit();
  assert.equal(staged.status, 0);
  assert.match(staged.output, /大型对象未作内容扫描/);
  h.commit();
  const pushed = h.prepush(undefined, baseline);
  assert.equal(pushed.status, 0);
  assert.match(pushed.output, /大型对象未作内容扫描/);
});
