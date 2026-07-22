#!/usr/bin/env node
/**
 * Gate before sharing this copy. Fails (exit 1) if it finds either:
 *   1. A sensitive PATH that must never ship (local DB, backups, browser
 *      session profiles, debug screenshots, logs, real .env, nested repos).
 *   2. An identifying STRING — the original owner's name or the old project
 *      name — anywhere in a text file.
 *
 * String matching is whole-word/identifier so unrelated substrings (e.g. the
 * Hebrew word "טאבים", which contains "אבי") do not trigger a false failure.
 * Run from the copy's root:  node scripts/verify-clean.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// Directories we never descend into (huge or irrelevant to the check).
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

// Paths whose mere presence means the copy is NOT clean.
const FORBIDDEN_PATH = [
  /(^|\/)data(\/|$)/,
  /\.db(-wal|-shm)?$/,
  /(^|\/)browser-profiles(\/|$)/,
  /(^|\/)debug(\/|$)/,
  /(^|\/)logs?(\/|$)/,
  /(^|\/)\.env$/,          // .env.example is allowed; bare .env is not
  /(^|\/)\.claude\/worktrees(\/|$)/,
];

// Strong identifiers — unambiguous, checked in EVERY text file including
// lockfiles (a lockfile's own "name" field is real leakage).
const STRONG_STRINGS = [
  /(?<![A-Za-z])avilevi(?![A-Za-z])/i,
  /avi-finops/i,
  /Avi[- ]?FinOps/i,
];
// Loose identifiers — a bare "avi"/"אבי" token. Skipped in lockfiles, where a
// third-party dependency name could legitimately contain the substring.
const LOOSE_STRINGS = [
  /(?<![A-Za-z])avi(?![A-Za-z])/i,
  /(?<![א-ת])אבי(?![א-ת])/,
];

// Only scan text files for strings; skip binaries and lockfiles.
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css',
  '.sql', '.sh', '.yml', '.yaml', '.txt', '.example', '.npmrc', '.gitignore',
]);
// This script necessarily contains the forbidden patterns (that's its job),
// so it excludes itself from the string scan — but is still checked as a path.
const SKIP_FILES = new Set(['verify-clean.mjs']);
const LOCKFILES = new Set(['package-lock.json']);

const pathFindings = [];
const stringFindings = [];

function isTextFile(name) {
  if (SKIP_FILES.has(name)) return false;
  if (name.startsWith('.') && TEXT_EXT.has(name)) return true; // .npmrc, .gitignore
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  return TEXT_EXT.has(ext);
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (FORBIDDEN_PATH.some((re) => re.test(rel) || re.test(rel + '/'))) {
        pathFindings.push(rel + '/');
      }
      walk(full);
    } else {
      if (FORBIDDEN_PATH.some((re) => re.test(rel))) pathFindings.push(rel);
      if (isTextFile(entry.name)) scanFile(full, rel, entry.name);
    }
  }
}

function scanFile(full, rel, name) {
  let text;
  try { text = readFileSync(full, 'utf-8'); } catch { return; }
  // Lockfiles: only the strong identifiers (their own "name" field). A bare
  // "avi" there is almost certainly a dependency name, not the owner.
  const patterns = LOCKFILES.has(name) ? STRONG_STRINGS : [...STRONG_STRINGS, ...LOOSE_STRINGS];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      if (re.test(lines[i])) {
        stringFindings.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 100) });
        break;
      }
    }
  }
}

walk(ROOT);

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

if (pathFindings.length === 0 && stringFindings.length === 0) {
  console.log(`${GREEN}נקי ✓${RESET}  — לא נמצאו נתונים מזהים או קבצים רגישים. אפשר לשתף.`);
  process.exit(0);
}

console.error(`${RED}העותק אינו נקי — נמצאו ממצאים:${RESET}\n`);
if (pathFindings.length > 0) {
  console.error(`${YELLOW}קבצים/תיקיות רגישים שאסור לשתף:${RESET}`);
  for (const p of [...new Set(pathFindings)]) console.error(`  ✗ ${p}`);
  console.error('');
}
if (stringFindings.length > 0) {
  console.error(`${YELLOW}מחרוזות מזהות:${RESET}`);
  for (const f of stringFindings) console.error(`  ✗ ${f.file}:${f.line}  ${f.text}`);
  console.error('');
}
process.exit(1);
