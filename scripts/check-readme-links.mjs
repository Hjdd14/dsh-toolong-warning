/**
 * README link check: every in-page anchor must match a real heading, and every
 * relative file link must point at a file that exists.
 *
 * Run with: node scripts/check-readme-links.mjs
 *
 * This is not part of `npm test`; it is used when the READMEs are edited, because
 * a Table of Contents that points at a deleted section is the first thing a
 * visitor clicks and the least likely thing anyone notices.
 */

import { readFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['README.md', 'README.zh.md']

/** Headings outside fenced code blocks. */
function headings(text) {
  const out = []
  let fence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue }
    if (fence) continue
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) out.push(match[2].trim())
  }
  return out
}

/** GitHub's heading slug rule, close enough for these documents. */
function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

let failed = 0
for (const file of FILES) {
  const text = await readFile(join(ROOT, file), 'utf8')
  const slugs = new Set(headings(text).map(slug))
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])

  const brokenAnchors = []
  const brokenFiles = []
  for (const target of links) {
    if (target.startsWith('http') || target.startsWith('mailto:')) continue
    if (target.startsWith('#')) {
      const id = decodeURIComponent(target.slice(1))
      if (!slugs.has(id)) brokenAnchors.push(target)
      continue
    }
    const path = decodeURIComponent(target.split('#')[0])
    if (path === '') continue
    try {
      await access(join(ROOT, path))
    } catch {
      brokenFiles.push(target)
    }
  }

  const ok = brokenAnchors.length === 0 && brokenFiles.length === 0
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}: ${String(slugs.size)} headings, ${String(links.length)} links`)
  if (brokenAnchors.length > 0) console.log(`       dead anchors: ${brokenAnchors.join(', ')}`)
  if (brokenFiles.length > 0) console.log(`       missing files: ${brokenFiles.join(', ')}`)
}

console.log(failed === 0 ? '\nREADME links: all resolve' : `\nREADME links: ${String(failed)} file(s) broken`)
process.exitCode = failed === 0 ? 0 : 1
