/**
 * Make `@deepseek-ai/schemastery` resolvable when these tests run from a plain
 * shell.
 *
 * The plugin loads that module by explicit path because a locally installed
 * plugin is a symlink to a directory outside the profile, so Node resolves its
 * imports from the real path — where the profile's node_modules are not on the
 * search path. A profile launch exports `DSH_PROFILE_DIR`; a test shell does not,
 * and dynamic `import()` of the plugin would then pick the fallback descriptor
 * and the schema assertions would be testing the wrong object.
 *
 * Candidates are taken from the environment (nothing machine-specific is
 * hard-coded): `DSH_PROFILE_DIR`, then `DSH_HOME`/`profiles/<DSH_PROFILE>`, then
 * `~/.dsh/profiles/<DSH_PROFILE>`. When none exists the fallback stands, and the
 * test files check for that case instead of failing.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The DSH home directory a profile would live under. */
function resolveDshHome() {
  const raw = process.env.DSH_HOME
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  return join(homedir(), '.dsh')
}

/**
 * Set `DSH_PROFILE_DIR` when the environment does not already provide it.
 * @returns the profile directory in effect, or undefined when there is none.
 */
export function ensureProfileEnv() {
  const existing = process.env.DSH_PROFILE_DIR
  if (typeof existing === 'string' && existing.trim() !== '') {
    return existsSync(existing) ? existing : undefined
  }
  const profileName = typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE.trim() !== ''
    ? process.env.DSH_PROFILE.trim()
    : 'web'
  const candidates = [
    join(resolveDshHome(), 'profiles', profileName),
    process.env.DSH_PROFILE_WEB_DIR,
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) {
      process.env.DSH_PROFILE_DIR = candidate
      process.env.DSH_PROFILE = process.env.DSH_PROFILE ?? profileName
      return candidate
    }
  }
  return undefined
}
