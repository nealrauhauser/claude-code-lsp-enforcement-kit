#!/usr/bin/env node
'use strict';

/**
 * lsp-first-glob-guard.js — PreToolUse hook (matcher: Glob)
 *
 * HARD BLOCK: Glob patterns that search for code symbols by filename.
 * Closes the gap where an agent bypasses lsp-first-guard (Grep matcher)
 * and lsp-first-read-guard (Read matcher) by using Glob to locate files
 * containing a symbol name.
 *
 * Allowed:
 *   - Extension patterns:        src/**\/*.ts, *.tsx, **\/*.json
 *   - Concept patterns:          *subdomain*, *auth*, **\/middleware*
 *   - Short / all-lowercase:     *modal*, *form*, auth/**
 *   - Config / framework files:  tsconfig.json, next.config.ts
 *
 * Blocked:
 *   - PascalCase symbol:         *UserService*, **\/*Modal.tsx, *TabsClient*
 *   - camelCase symbol:          *createOrder*, *handleSubmit*
 *   - snake_case function (3+):  *get_user_sessions*, *write_audit_log*
 *
 * Philosophy: if you know the symbol name, use LSP
 *   (mcp__cclsp__find_workspace_symbols). Glob is for broad file discovery
 *   by extension or concept, not for symbol-based search.
 */

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  if (data.tool_name !== 'Glob') process.exit(0);

  const pattern = (data.tool_input?.pattern || '').trim();
  if (!pattern) process.exit(0);

  const searchPath = (data.tool_input?.path || '').trim();

  // ── Allow: non-code paths ────────────────────────────────────────────────
  if (/knowledge-vault|\.task[\\/]|\.claude[\\/]|node_modules|supabase[\\/]migrations|\.git[\\/]/i.test(searchPath)) {
    process.exit(0);
  }
  if (/knowledge-vault|\.task[\\/]|\.claude[\\/]|node_modules|supabase[\\/]migrations/i.test(pattern)) {
    process.exit(0);
  }

  // Extract alphabetic tokens from the pattern (strip *, /, ., brackets, etc.)
  const tokens = pattern
    .split(/[*/.\\{}\[\]()!?,\s|+-]+/)
    .map(t => t.trim())
    .filter(Boolean);

  const symbolTokens = tokens.filter(t => isCodeSymbol(t));
  if (symbolTokens.length === 0) process.exit(0);

  const suggestions = symbolTokens.map(sym => {
    const isPascal = /^[A-Z]/.test(sym);
    return isPascal
      ? `  mcp__cclsp__find_workspace_symbols("${sym}")  → locate in project\n  mcp__cclsp__find_definition("${sym}")          → go to definition`
      : `  mcp__cclsp__find_references("${sym}")          → all usages\n  mcp__cclsp__find_definition("${sym}")          → go to definition`;
  }).join('\n');

  const msg =
    `\n⛔ LSP-FIRST BLOCK: Glob pattern contains ${symbolTokens.length} code symbol(s)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Pattern: ${pattern}\n` +
    `Symbols: ${symbolTokens.join(', ')}\n\n` +
    `LSP is always connected. Searching files by symbol name is LSP territory:\n` +
    `${suggestions}\n\n` +
    `If you need to find files by extension or concept, use lowercase\n` +
    `(e.g. "*subdomain*", "src/**/*.ts") — those are allowed.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  process.stderr.write(msg);

  console.log(JSON.stringify({
    decision: 'block',
    reason: `LSP-FIRST: Glob pattern contains code symbol(s) [${symbolTokens.join(', ')}]. Use LSP tools instead of filename-based symbol search.`,
  }));
});

function isCodeSymbol(s) {
  if (!s || s.length < 4) return false;
  if (/\s/.test(s)) return false;

  // File extensions and directory/framework keywords — always allowed
  const skipExact = new Set([
    // extensions
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java',
    'vue', 'svelte', 'md', 'mdx', 'json', 'jsonc', 'yaml', 'yml', 'sql',
    'sh', 'bash', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml',
    'toml', 'ini', 'env', 'lock', 'log', 'txt', 'csv',
    // common dirs / file stems
    'src', 'app', 'lib', 'libs', 'hooks', 'utils', 'util', 'types',
    'components', 'pages', 'api', 'server', 'client', 'public', 'docs',
    'tests', 'test', 'spec', 'specs', 'dist', 'build', 'out', 'next',
    'turbo', 'cache', 'node_modules', 'coverage', 'scripts', 'config',
    'assets', 'styles', 'fonts', 'images', 'icons', 'locales', 'i18n',
    'middleware', 'services', 'service', 'models', 'model', 'schemas',
    'schema', 'routes', 'route', 'views', 'view', 'store', 'stores',
    'actions', 'action', 'reducers', 'slices', 'providers', 'contexts',
    'layouts', 'layout', 'templates', 'template', 'helpers', 'helper',
    'constants', 'const', 'configs', 'fixtures', 'mocks', 'mock',
    'validations', 'validators', 'transformers',
    // common filenames
    'index', 'main', 'page', 'error', 'loading', 'not-found', 'global',
    'root', 'readme', 'license', 'changelog', 'dockerfile', 'makefile',
    'tsconfig', 'jsconfig', 'package', 'pnpm-lock', 'yarn', 'npm-lock',
    // framework / tool config stems
    'next', 'vite', 'webpack', 'rollup', 'babel', 'jest', 'vitest',
    'tailwind', 'postcss', 'eslint', 'prettier', 'playwright', 'cypress',
    'drizzle', 'prisma', 'supabase', 'turbo', 'nx', 'bun', 'deno',
    // directives / keywords
    'todo', 'fixme', 'hack', 'xxx', 'note', 'import', 'export', 'from',
    'require', 'http', 'https',
  ]);
  if (skipExact.has(s.toLowerCase())) return false;

  // Short all-lowercase (≤8 chars) — too generic to be a symbol
  if (/^[a-z]{1,8}$/.test(s)) return false;

  // SCREAMING_SNAKE — constants / env vars / acronyms
  if (/^[A-Z_]{3,}$/.test(s)) return false;

  // kebab-case — filename conventions, not symbols
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(s)) return false;

  // Now the actual symbol detection:
  const isCamelCase    = /^[a-z][a-zA-Z0-9]{3,}$/.test(s) && /[A-Z]/.test(s);
  const isPascalCase   = /^[A-Z][a-zA-Z][a-zA-Z0-9]{2,}$/.test(s);
  const isSnakeCaseFn  = /^[a-z]+(_[a-z]+){2,}$/.test(s) && s.length >= 9;

  return isCamelCase || isPascalCase || isSnakeCaseFn;
}
