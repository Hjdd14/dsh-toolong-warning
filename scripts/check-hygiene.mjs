/**
 * Repository privacy gate.
 *
 * Run with: node scripts/check-hygiene.mjs
 *
 * This repository is published, so it must not carry anything that identifies the
 * machine or person it was developed on: home-directory paths, a Windows user
 * name, a project path outside the repository, real session ids, or credentials.
 *
 * It is deliberately strict and deliberately dumb: a pattern either matches or it
 * does not. Anything that legitimately needs to look like a secret (documentation
 * about redaction, for instance) must be listed in ALLOWED with a reason, so the
 * exception is visible in review rather than hidden in a loose regex.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories never scanned: dependencies and VCS metadata. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm', 'dist', 'coverage'])

/**
 * Patterns that must not appear anywhere in the published tree.
 *
 * `label` names the problem so a failure explains itself; `pattern` is matched
 * per line, so the report can quote it.
 */
const RULES = [
  { label: 'Windows home directory path', pattern: /[A-Za-z]:\\+Users\\+[^\\\s"']+/ },
  { label: 'POSIX home directory path', pattern: /\/(?:Users|home)\/[^/\s"']+/ },
  { label: 'this machine\u2019s project path', pattern: /D:\\+Code_Work/i },
  { label: 'a real session id', pattern: /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  { label: 'an OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{16,}/ },
  { label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: 'an AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'an Authorization header value', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { label: 'an assigned secret', pattern: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
  { label: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'a personal email address', pattern: /\b[A-Za-z0-9._%+-]+@(?:gmail|qq|163|126|outlook|hotmail|yahoo)\.[A-Za-z]{2,}\b/i },
]

/**
 * Files exempt from specific rules, each with the reason it is exempt.
 *
 * The gate's own source is exempt from the path rules because it necessarily
 * contains the patterns it looks for.
 */
const ALLOWED = [
  { file: 'scripts/check-hygiene.mjs', rules: ['Windows home directory path', 'POSIX home directory path', 'this machine\u2019s project path', 'a real session id'], reason: 'the gate must spell out the patterns it forbids' },
  { file: 'docs/DESIGN.md', rules: ['Windows home directory path', 'POSIX home directory path'], reason: 'redaction examples are written with placeholders only; any match here means a leak' },
]

/** Every file in the tree, excluding skipped directories. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git') && entry.name !== '.gitignore') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...await walk(full))
      continue
    }
    if (!entry.isFile()) continue
    out.push(full)
  }
  return out
}

/** Whether a rule is exempt for a repository-relative path. */
function exempt(relPath, label) {
  const posix = relPath.split(sep).join('/')
  for (const entry of ALLOWED) {
    if (entry.file === posix && entry.rules.includes(label)) return true
  }
  return false
}

/** Whether a file is likely text, so binary assets are skipped. */
function looksTextual(buffer) {
  const sample = buffer.subarray(0, 4096)
  for (const byte of sample) {
    if (byte === 0) return false
  }
  return true
}

const findings = []
let scanned = 0
for (const file of await walk(ROOT)) {
  const info = await stat(file)
  if (info.size > 2 * 1024 * 1024) continue
  const buffer = await readFile(file)
  if (!looksTextual(buffer)) continue
  scanned += 1
  const relPath = relative(ROOT, file)
  const lines = buffer.toString('utf8').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue
      if (exempt(relPath, rule.label)) continue
      findings.push({ file: relPath.split(sep).join('/'), line: index + 1, label: rule.label, snippet: line.trim().slice(0, 120) })
    }
  }
}

console.log(`hygiene: scanned ${String(scanned)} files`)
if (findings.length === 0) {
  console.log('hygiene: clean — no personal paths, session ids, or credentials found')
  process.exitCode = 0
} else {
  console.log(`hygiene: ${String(findings.length)} finding(s) must be fixed before publishing:`)
  for (const finding of findings) {
    console.log(`  ${finding.file}:${String(finding.line)}  [${finding.label}]  ${finding.snippet}`)
  }
  process.exitCode = 1
}
