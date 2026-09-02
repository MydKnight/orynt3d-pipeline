import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const GIT_SYNC = resolve(__dirname, '../../docker/lib/git-sync.sh')

// Run one git-sync.sh function in `cwd`. Returns stdout.
function call(cwd: string, fn: string, ...args: string[]): string {
  const script = `set -euo pipefail; source "${GIT_SYNC.replace(/\\/g, '/')}"; ${fn} ${args.map(a => `'${a}'`).join(' ')}`
  return execFileSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_NAME: 'test', GIT_EMAIL: 'test@test', GIT_TERMINAL_PROMPT: '0' },
  })
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let dir: string
let bare: string   // the "remote"
let work: string   // the container checkout

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitsync-'))
  bare = join(dir, 'remote.git')
  work = join(dir, 'work')

  // seed the remote with an initial commit (a repo with data/pipeline.db + code)
  const seed = join(dir, 'seed')
  await mkdir(join(seed, 'data'), { recursive: true })
  await mkdir(join(seed, 'src'), { recursive: true })
  await writeFile(join(seed, 'data/pipeline.db'), 'v1')
  await writeFile(join(seed, 'src/cli.ts'), '// code')
  git(seed, 'init', '-q', '-b', 'master')
  git(seed, 'config', 'user.name', 'seed'); git(seed, 'config', 'user.email', 's@s')
  git(seed, 'add', '-A'); git(seed, 'commit', '-qm', 'initial')
  execFileSync('git', ['clone', '-q', '--bare', seed, bare])

  await mkdir(work)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const remoteUrl = () => `file://${bare.replace(/\\/g, '/')}`

describe('git-sync.sh', () => {
  it('git_setup clones into an empty dir, then is idempotent', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    expect(await readFile(join(work, 'data/pipeline.db'), 'utf8')).toBe('v1')
    // second call on a populated dir just re-points the remote
    call(work, 'git_setup', remoteUrl(), 'master')
    expect(git(work, 'remote', 'get-url', 'origin')).toBe(remoteUrl())
  })

  it('git_sync hard-resets to origin, discarding local cruft', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    await writeFile(join(work, 'data/pipeline.db'), 'LOCAL EDIT')
    await writeFile(join(work, 'junk.txt'), 'x')
    call(work, 'git_sync', 'master')
    expect(await readFile(join(work, 'data/pipeline.db'), 'utf8')).toBe('v1')
  })

  it('git_sync picks up a commit pushed elsewhere (laptop dev loop)', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    // someone pushes a code change to the remote
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '-q', remoteUrl(), other])
    git(other, 'config', 'user.name', 'o'); git(other, 'config', 'user.email', 'o@o')
    await writeFile(join(other, 'src/cli.ts'), '// new code')
    git(other, 'commit', '-qam', 'code change'); git(other, 'push', '-q')

    call(work, 'git_sync', 'master')
    expect(await readFile(join(work, 'src/cli.ts'), 'utf8')).toBe('// new code')
  })

  it('git_commit_db pushes a changed pipeline.db', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    call(work, 'git_sync', 'master')
    await writeFile(join(work, 'data/pipeline.db'), 'v2 with new rows')
    const out = call(work, 'git_commit_db', 'master', 'chore(tracker): pipeline')
    expect(out).toMatch(/pushed tracker DB snapshot/)
    // the remote advanced
    const check = join(dir, 'check')
    execFileSync('git', ['clone', '-q', remoteUrl(), check])
    expect(await readFile(join(check, 'data/pipeline.db'), 'utf8')).toBe('v2 with new rows')
    expect(git(check, 'log', '-1', '--pretty=%s')).toBe('chore(tracker): pipeline')
  })

  it('git_commit_db recovers when the remote advanced mid-run (stale lease)', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    call(work, 'git_sync', 'master')
    await writeFile(join(work, 'data/pipeline.db'), 'v2 with new rows')

    // laptop pushes a code change to the remote while the container "runs"
    const other = join(dir, 'other')
    execFileSync('git', ['clone', '-q', remoteUrl(), other])
    git(other, 'config', 'user.name', 'o'); git(other, 'config', 'user.email', 'o@o')
    await writeFile(join(other, 'src/cli.ts'), '// laptop code change')
    git(other, 'commit', '-qam', 'laptop code'); git(other, 'push', '-q')

    const out = call(work, 'git_commit_db', 'master', 'chore(tracker): pipeline')
    expect(out).toMatch(/pushed tracker DB snapshot/)

    const check = join(dir, 'check')
    execFileSync('git', ['clone', '-q', remoteUrl(), check])
    expect(await readFile(join(check, 'data/pipeline.db'), 'utf8')).toBe('v2 with new rows')
    expect(await readFile(join(check, 'src/cli.ts'), 'utf8')).toBe('// laptop code change')
  })

  it('git_commit_db is a no-op when pipeline.db is unchanged', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    call(work, 'git_sync', 'master')
    const out = call(work, 'git_commit_db', 'master', 'chore(tracker): pipeline')
    expect(out).toMatch(/unchanged -- nothing to commit/)
    expect(git(bare, 'log', '-1', '--pretty=%s')).toBe('initial')
  })

  it('git_commit_db only commits data/pipeline.db, not other dirty files', async () => {
    call(work, 'git_setup', remoteUrl(), 'master')
    call(work, 'git_sync', 'master')
    await writeFile(join(work, 'data/pipeline.db'), 'v2')
    await writeFile(join(work, 'src/cli.ts'), '// accidental local edit')
    call(work, 'git_commit_db', 'master', 'chore(tracker): pipeline')
    const check = join(dir, 'check')
    execFileSync('git', ['clone', '-q', remoteUrl(), check])
    expect(await readFile(join(check, 'src/cli.ts'), 'utf8')).toBe('// code') // unchanged on remote
  })
})
