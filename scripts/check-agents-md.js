#!/usr/bin/env node
// Keeps AGENTS.md (and README.md) consistent with the repository, so agents are
// never sent to a command or file that no longer exists. Checked in every
// inline code span:
//   - `npm test`, `npm start` and `npm run <name>` name a script in package.json;
//   - `node <file>` and `scripts/...` commands point at files that exist, and
//     shell scripts are executable;
//   - repository paths (src/..., .github/..., package.json, ...) exist.
// And the other way round: every package.json script is documented in AGENTS.md.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CHECKED_DOCS = ['AGENTS.md', 'README.md'];
const ROOT_DIRS = [
  'src',
  'public',
  'test',
  'scripts',
  'docs',
  '.github',
  '.githooks',
  '.zap',
  '.devcontainer',
  '.factory',
];
// Bare file names are only checked for these root files; other bare names such
// as `ci.yml` are usually written relative to a directory named nearby.
const ROOT_FILES = new Set([
  'AGENTS.md',
  'README.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'eslint.config.js',
  'knip.json',
  '.jscpd.json',
  '.prettierrc.json',
  '.prettierignore',
  '.env.example',
  '.gitignore',
]);
const PATH_TOKEN = new RegExp(
  `^(?:${ROOT_DIRS.map((d) => d.replace('.', '\\.')).join('|')})(?:/[\\w.*{}<>-]*)*$`,
);

/**
 * @typedef {{ exists: (path: string) => boolean, isExecutable: (path: string) => boolean, scripts: Record<string, string> }} Repo
 * @typedef {{ doc: string, line: number, span: string, problem: string }} Problem
 */

/**
 * Inline code spans with their line numbers; fenced code blocks are skipped.
 * @param {string} markdown
 */
export function extractCodeSpans(markdown) {
  /** @type {{ line: number, span: string }[]} */
  const spans = [];
  let fenced = false;
  markdown.split('\n').forEach((text, index) => {
    if (text.trimStart().startsWith('```')) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const match of text.matchAll(/`([^`]+)`/g)) spans.push({ line: index + 1, span: match[1].trim() });
  });
  return spans;
}

/**
 * Problems with one code span; an empty list means it is fine or not a command or path.
 * @param {string} span
 * @param {Repo} repo
 * @returns {string[]}
 */
export function checkSpan(span, repo) {
  const tokens = span.split(/\s+/).filter((t) => !/^[A-Z_]+=/.test(t));
  const [command, ...args] = tokens;
  if (command === 'npm') return checkNpm(args, repo);
  if (command === 'node') return args.filter(isRepoPath).flatMap((arg) => checkPath(arg, repo));
  if (tokens.length > 1 && isRepoPath(command)) return checkRunnable(command, repo);
  if (tokens.length === 1 && (isRepoPath(command) || ROOT_FILES.has(command)))
    return checkPath(command, repo);
  return tokens.filter((t) => t.includes('/') && isRepoPath(t)).flatMap((t) => checkPath(t, repo));
}

/**
 * @param {string} command
 * @param {Repo} repo
 */
function checkRunnable(command, repo) {
  if (!repo.exists(command)) return [`${command} does not exist`];
  return command.endsWith('.sh') && !repo.isExecutable(command) ? [`${command} is not executable`] : [];
}

/** @param {string} token */
function isRepoPath(token) {
  return PATH_TOKEN.test(token) && !token.includes('<') && !token.includes('{');
}

/**
 * @param {string} path
 * @param {Repo} repo
 */
function checkPath(path, repo) {
  // A glob like `test/*.test.js` is checked up to its first wildcard.
  const fixed = path.split('*')[0].replace(/\/[^/]*$/, (rest) => (path.includes('*') ? '' : rest));
  return repo.exists(fixed || '.') ? [] : [`${path} does not exist`];
}

/**
 * @param {string[]} args
 * @param {Repo} repo
 */
function checkNpm(args, repo) {
  const [sub, name] = args;
  const script = sub === 'run' ? name : sub;
  if (!['run', 'test', 'start'].includes(sub) || script === undefined) return [];
  return script in repo.scripts ? [] : [`package.json has no "${script}" script`];
}

/**
 * Scripts in package.json that AGENTS.md never mentions, either as an npm
 * command or by the repository file the script runs (`scripts/dev.sh`).
 * @param {string} agentsMd
 * @param {Record<string, string>} scripts
 */
export function undocumentedScripts(agentsMd, scripts) {
  const spans = extractCodeSpans(agentsMd).map((s) => s.span);
  const mentions = (/** @type {string} */ name) =>
    spans.some(
      (span) =>
        span.startsWith(`npm run ${name}`) ||
        (/^npm (?:test|start)\b/.test(span) && span.split(' ')[1] === name),
    );
  const mentionsTarget = (/** @type {string} */ command) =>
    command
      .split(/\s+/)
      .filter(isRepoPath)
      .some((file) => spans.some((span) => span.split(/\s+/).includes(file)));
  return Object.entries(scripts)
    .filter(([name, command]) => !mentions(name) && !mentionsTarget(command))
    .map(([name]) => name);
}

/** @returns {Repo} */
function realRepo() {
  return {
    exists: (path) => existsSync(path),
    isExecutable: (path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    scripts: JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {},
  };
}

function main() {
  const repo = realRepo();
  /** @type {Problem[]} */
  const problems = CHECKED_DOCS.flatMap((doc) =>
    extractCodeSpans(readFileSync(doc, 'utf8')).flatMap(({ line, span }) =>
      checkSpan(span, repo).map((problem) => ({ doc, line, span, problem })),
    ),
  );
  for (const name of undocumentedScripts(readFileSync('AGENTS.md', 'utf8'), repo.scripts)) {
    problems.push({
      doc: 'AGENTS.md',
      line: 0,
      span: `npm run ${name}`,
      problem: 'is in package.json but not documented',
    });
  }
  for (const p of problems) console.error(`${p.doc}:${p.line} \`${p.span}\`: ${p.problem}`);
  if (problems.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`check-agents-md: commands and paths in ${CHECKED_DOCS.join(' and ')} match the repository.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
