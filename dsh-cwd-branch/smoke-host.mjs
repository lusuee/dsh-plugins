// Smoke test for the host half: no server, no DSH — just the git probe and the
// routing helpers.
import { __internals } from './lib/index.js'

const { reportFor, checkoutsFor, resolveGit, usableDirectory, usableBranch } = __internals

const version = await resolveGit()
console.log('git =', version)

for (const dir of [
  'D:\\dsh',
  'D:\\github\\fdm-crm',
  'D:\\github',
  'C:\\Users\\fm',
  'D:\\does-not-exist',
  'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module',
  'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module\\src',
]) {
  const started = Date.now()
  const report = await reportFor(dir)
  console.log(`${((Date.now() - started) / 1000).toFixed(2)}s`, JSON.stringify(report))
}

console.log('\ncheckouts of fdm-crm:')
console.log(JSON.stringify(await checkoutsFor('D:\\github\\fdm-crm'), null, 2))

console.log('\ncheckouts of a non-repository:')
console.log(JSON.stringify(await checkoutsFor('D:\\dsh')))

console.log('\nguards:')
for (const value of ['D:\\github\\fdm-crm', 'D:\\does-not-exist', 'github\\fdm-crm', '', 'D:\\dsh\\lib\\index.js']) {
  console.log('  dir ', JSON.stringify(value), '→', usableDirectory(value))
}
for (const value of ['feat/x', 'fix/self02', '-x', 'a..b', 'a b', 'a\\b', 'x~1', 'main']) {
  console.log('  ref ', JSON.stringify(value), '→', usableBranch(value))
}
