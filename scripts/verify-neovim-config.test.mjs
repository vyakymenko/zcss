import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  expectedNeovimRelease,
  neovimCommand,
  neovimZigcssPath,
} from './test-neovim-integration.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

test('Neovim uses the built-in CSS-only LSP configuration API', () => {
  const entry = read('neovim-config/init.lua')
  const config = read('neovim-config/lsp/zigcss.lua')

  assert.match(entry, /vim\.lsp\.enable\('zigcss'\)/)
  assert.doesNotMatch(entry + config, /require\(['"]lspconfig/)
  assert.match(config, /cmd = \{ server_command\(\), '--lsp' \}/)
  assert.match(config, /filetypes = \{ 'css' \}/)
  assert.match(config, /root_markers = \{ '\.git' \}/)
  assert.match(config, /workspace_required = false/)
  for (const unavailable of ['scss', 'sass', 'less', 'stylus', 'formatting()', 'code_action()']) {
    assert.doesNotMatch(config, new RegExp(unavailable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('binary selection is absolute executable and fail-closed', () => {
  const config = read('neovim-config/lsp/zigcss.lua')

  assert.match(config, /ZIGCSS_LSP_PATH/)
  assert.match(config, /maximum_path_length = 65536/)
  assert.match(config, /maximum_path_entries = 1024/)
  assert.match(config, /maximum_path_extensions = 64/)
  assert.match(config, /path:find\('\\0', 1, true\)/)
  assert.match(config, /stat\.type ~= 'file'/)
  assert.match(config, /vim\.fn\.executable\(normalized\) ~= 1/)
  assert.match(config, /must resolve to an absolute path/)
  assert.match(config, /if #directory <= maximum_path_length and is_absolute\(directory\)/)
  assert.match(config, /vim\.env\.PATHEXT/)
  assert.match(config, /client:supports_method\('textDocument\/completion'\)/)
})

test('documentation matches the implemented command and capability boundary', () => {
  const readme = read('neovim-config/README.md')

  assert.match(readme, /Neovim 0\.11\.7 or later/)
  assert.match(readme, /exact 0\.11\.7 minimum and current 0\.12\.4 release/)
  assert.match(readme, /vim\.lsp\.enable\('zigcss'\)/)
  assert.match(readme, /\/absolute\/path\/to\/zigcss --lsp/)
  assert.match(readme, /Pull diagnostics/)
  assert.match(readme, /Document\/workspace symbols/)
  assert.match(readme, /Declaration, implementation, signature help, code actions, formatting/)
  assert.match(readme, /Relative and workspace-local paths are not executed implicitly/)
  assert.doesNotMatch(readme, /Neovim 0\.5|filetypes = \{'css', 'scss'/)
})

test('CI pins and runs the real headless integration without a plugin framework', () => {
  const workflow = read('.github/workflows/build.yml')
  const manifest = JSON.parse(read('package.json'))
  const integration = read('scripts/test-neovim-integration.mjs')

  assert.equal(
    manifest.scripts['test:neovim'],
    'node --test scripts/verify-neovim-config.test.mjs && node scripts/test-neovim-integration.mjs',
  )
  assert.match(workflow, /releases\/download\/v\$version\/nvim-linux-x86_64\.tar\.gz/)
  assert.match(workflow, /install_neovim 0\.11\.7 38a7c6317f94503841096c00e8fde05ef04b9472fc9d7d62b6e033cecd6f7991/)
  assert.match(workflow, /install_neovim 0\.12\.4 012bf3fcac5ade43914df3f174668bf64d05e049a4f032a388c027b1ebd78628/)
  assert.match(workflow, /npm run test:neovim/)
  assert.match(integration, /expectedNeovimRelease/)
  assert.match(integration, /ZIGCSS_NEOVIM_CONFIG_ROOT/)
  assert.match(integration, /NEOVIM_REJECTION_PASS/)
  assert.match(integration, /NEOVIM_SMOKE_PASS/)
  assert.doesNotMatch(workflow, /nvim-lspconfig/)
})

test('integration tool selection is finite and repository-bound', () => {
  assert.equal(expectedNeovimRelease(), '0.12.4')
  assert.equal(expectedNeovimRelease(undefined), '0.12.4')
  assert.equal(expectedNeovimRelease('0.11.7'), '0.11.7')
  assert.throws(() => expectedNeovimRelease('nightly'), /exactly 0\.11\.7 or 0\.12\.4/)
  assert.equal(neovimCommand(undefined, '0.12.4'), 'nvim')
  assert.equal(neovimCommand(), 'nvim')
  assert.equal(
    neovimCommand('/home/runner/work/_temp/nvim-0.11.7/bin/nvim', '0.11.7'),
    '/home/runner/work/_temp/nvim-0.11.7/bin/nvim',
  )
  assert.throws(
    () => neovimCommand('/tmp/attacker-controlled-nvim', '0.12.4'),
    /finite reviewed Neovim installation/,
  )
  const expectedZigcss = path.join(repositoryRoot, 'zig-out', 'bin', process.platform === 'win32' ? 'zigcss.exe' : 'zigcss')
  assert.equal(neovimZigcssPath(), expectedZigcss)
  assert.equal(neovimZigcssPath(repositoryRoot, undefined), expectedZigcss)
  assert.equal(neovimZigcssPath(repositoryRoot, expectedZigcss), expectedZigcss)
  assert.throws(
    () => neovimZigcssPath(repositoryRoot, '/tmp/attacker-controlled-zigcss'),
    /repository ReleaseFast binary/,
  )
})

test('Neovim helper defaults stay pure while main explicitly validates hosted and hostile environments', () => {
  const probe = [
    "import assert from 'node:assert/strict'",
    "import childProcess from 'node:child_process'",
    "import path from 'node:path'",
    "import { syncBuiltinESMExports } from 'node:module'",
    'const expected = JSON.parse(process.argv[3])',
    'const calls = []',
    'childProcess.spawnSync = (command, args) => {',
    '  calls.push({ command, args })',
    '  return {',
    '    status: expected.versionSucceeds ? 0 : 1,',
    "    stdout: `NVIM v${expected.release || '0.12.4'}\\n`,",
    "    stderr: 'intentional version probe stop',",
    '  }',
    '}',
    'syncBuiltinESMExports()',
    'const { expectedNeovimRelease, neovimCommand, neovimZigcssPath, main } = await import(process.argv[1])',
    'const root = process.argv[2]',
    "const zigcss = path.join(root, 'zig-out', 'bin', process.platform === 'win32' ? 'zigcss.exe' : 'zigcss')",
    "assert.equal(expectedNeovimRelease(), '0.12.4')",
    "assert.equal(expectedNeovimRelease(undefined), '0.12.4')",
    "assert.equal(neovimCommand(), 'nvim')",
    "assert.equal(neovimCommand(undefined, '0.12.4'), 'nvim')",
    'assert.equal(neovimZigcssPath(), zigcss)',
    'assert.equal(neovimZigcssPath(root, undefined), zigcss)',
    'assert.throws(() => main(), error => error.message.includes(expected.error))',
    'assert.deepEqual(calls, expected.command === null ? [] : [{ command: expected.command, args: [\'--version\'] }])',
    "process.stdout.write('explicit environment selection verified')",
  ].join('\n')
  const fixtures = [
    {
      env: {},
      expected: { release: '0.12.4', command: 'nvim', error: 'Neovim version check failed' },
    },
    ...['0.11.7', '0.12.4'].map(release => ({
      env: {
        NEOVIM_TEST_VERSION: release,
        NVIM: `/home/runner/work/_temp/nvim-${release}/bin/nvim`,
      },
      expected: {
        release,
        command: `/home/runner/work/_temp/nvim-${release}/bin/nvim`,
        error: 'Neovim version check failed',
      },
    })),
    {
      env: { NEOVIM_TEST_VERSION: 'nightly', NVIM: '/tmp/unreviewed-nvim', ZIGCSS_LSP_PATH: '/tmp/unreviewed-zigcss' },
      expected: { command: null, error: 'NEOVIM_TEST_VERSION must be exactly 0.11.7 or 0.12.4' },
    },
    {
      env: { NEOVIM_TEST_VERSION: '0.12.4', NVIM: '/tmp/unreviewed-nvim' },
      expected: { command: null, error: 'finite reviewed Neovim installation' },
    },
    {
      env: { NEOVIM_TEST_VERSION: '0.12.4', NVIM: '/home/runner/work/_temp/nvim-0.11.7/bin/nvim' },
      expected: { command: null, error: 'finite reviewed Neovim installation' },
    },
    {
      env: { ZIGCSS_LSP_PATH: '/tmp/unreviewed-zigcss' },
      expected: { release: '0.12.4', command: 'nvim', versionSucceeds: true, error: 'repository ReleaseFast binary' },
    },
  ]
  for (const fixture of fixtures) {
    const env = { ...process.env }
    for (const name of ['NEOVIM_TEST_VERSION', 'NVIM', 'ZIGCSS_LSP_PATH', 'NODE_OPTIONS']) delete env[name]
    Object.assign(env, fixture.env)
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe,
      pathToFileURL(path.join(repositoryRoot, 'scripts', 'test-neovim-integration.mjs')).href,
      repositoryRoot,
      JSON.stringify(fixture.expected),
    ], { encoding: 'utf8', env, timeout: 5_000, maxBuffer: 64 * 1024 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'explicit environment selection verified')
    assert.equal(result.stderr, '')
  }
})
