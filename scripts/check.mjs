// Repository checks, no dependencies: node scripts/check.mjs
// 1. plugin.json, marketplace.json and gemini-extension.json agree on name and version.
// 2. Every skills/**/*.js file and every ```js block in the skills' markdown parses as a script.
// 3. The connector is pinned to one version everywhere (.mcp.json, gemini-extension.json, skills).
// 4. SKILL.md frontmatter: name matches the folder, description under 1024 characters, license MIT.
// 5. No local path (a /Volumes/, /Users/<name>/ or C:\Users\ path) in any published file.
// 6. If a local .denylist exists (gitignored, one term per line), no published file contains a term.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath, e.name)));

const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
const gemini = JSON.parse(read('gemini-extension.json'));
const market = JSON.parse(read('.claude-plugin/marketplace.json'));
const mcp = JSON.parse(read('.mcp.json'));
if (gemini.version !== plugin.version) problems.push(`gemini-extension.json version ${gemini.version} != plugin.json ${plugin.version}`);
if (gemini.name !== plugin.name) problems.push(`gemini-extension.json name ${gemini.name} != plugin.json ${plugin.name}`);
if (!market.plugins.some((p) => p.name === plugin.name)) problems.push('marketplace.json does not list the plugin');

function parses(code, where) {
  try {
    new vm.Script(code, { filename: where });
  } catch (e) {
    const line = /:(\d+)\n/.exec(String(e.stack))?.[1];
    problems.push(`${where}${line ? `:${line}` : ''}: ${e.message}`);
  }
}

const skillFiles = walk('skills');
for (const f of skillFiles.filter((f) => f.endsWith('.js'))) parses(read(f), f);
for (const f of skillFiles.filter((f) => f.endsWith('.md'))) {
  const text = read(f);
  for (const m of text.matchAll(/```js\n([\s\S]*?)```/g)) parses(m[1], `${f} (block at line ${text.slice(0, m.index).split('\n').length + 1})`);
}

const pins = new Map();
const pin = (v, where) => { if (!pins.has(v)) pins.set(v, where); };
for (const [where, cfg] of [['.mcp.json', mcp], ['gemini-extension.json', gemini]]) {
  const args = cfg.mcpServers?.pixinsight?.args ?? [];
  const m = args.join(' ').match(/pixinsight-connector@(\d+\.\d+\.\d+)/);
  if (m) pin(m[1], where); else problems.push(`${where}: the pixinsight server is not pinned to a pixinsight-connector version`);
}
for (const f of skillFiles.filter((f) => f.endsWith('.md'))) {
  for (const m of read(f).matchAll(/pixinsight-connector@(\d+\.\d+\.\d+)/g)) pin(m[1], f);
}
if (pins.size > 1) problems.push(`different connector pins: ${[...pins].map(([v, f]) => `${v} (${f})`).join(', ')}`);

for (const dir of fs.readdirSync(path.join(root, 'skills'))) {
  const f = `skills/${dir}/SKILL.md`;
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(read(f))?.[1] ?? '';
  const name = /^name:\s*(\S+)/m.exec(fm)?.[1];
  if (name !== dir) problems.push(`${f}: name ${name} != folder ${dir}`);
  const desc = /^description:\s*>-\n((?:  .*\n?)+)/m.exec(fm)?.[1]?.replace(/\n\s*/g, ' ').trim() ?? '';
  if (!desc || desc.length >= 1024) problems.push(`${f}: description missing or ${desc.length} characters`);
  if (!/^license:\s*MIT$/m.test(fm)) problems.push(`${f}: license is not MIT`);
}

const published = walk('.').filter((f) => !f.startsWith('.git/') && f !== '.git' && !f.startsWith('node_modules/') && !f.startsWith('agentic/') && !f.startsWith('output/') && f !== '.denylist' && f !== 'scripts/check.mjs');
const LOCAL_PATH = /\/Volumes\/|\/Users\/[A-Za-z]|[A-Za-z]:\\Users\\/;
let deny = [];
if (fs.existsSync(path.join(root, '.denylist'))) {
  deny = read('.denylist').split('\n').map((s, i) => ({ term: s.trim(), line: i + 1 })).filter((d) => d.term && !d.term.startsWith('#'));
}
for (const f of published) {
  const text = read(f);
  if (LOCAL_PATH.test(text)) problems.push(`${f}: contains a local path`);
  const lower = text.toLowerCase();
  for (const d of deny) if (lower.includes(d.term.toLowerCase())) problems.push(`${f}: contains a denylisted term (line ${d.line} of .denylist)`);
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log(`ok: version ${plugin.version}, connector ${[...pins.keys()].join('')}, ${published.length} published files, ` +
  `denylist ${deny.length ? `${deny.length} terms` : 'not present (local-only)'}`);
