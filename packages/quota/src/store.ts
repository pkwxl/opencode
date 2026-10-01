// Multi-account token store (plan 0066 §4):
//   <base>/quota/<provider>/<label>.token  — raw credential, 0600
//   <base>/quota/<provider>/<label>.json   — non-sensitive metadata (org/project, notes), 0600
// where <base> is $XDG_CONFIG_HOME or ~/.config. Writes are atomic (tmp →
// rename, mirroring auto-core's quota-windows store). Raw tokens never appear
// in errors, logs, or list output — only masked fingerprints leave this module.

import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

// Labels are path components: no separators, no leading dot, nothing exotic.
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isValidLabel(label: string): boolean {
  return LABEL_PATTERN.test(label)
}

export function quotaHome(home?: string): string {
  const base = home ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(base, "quota")
}

export interface StoredAccount {
  label: string
  token: string
  meta?: Record<string, unknown>
}

export async function readToken(provider: string, label: string, home?: string): Promise<string | undefined> {
  assertLabel(label)
  return readTokenUnchecked(provider, label, home)
}

export async function readMeta(provider: string, label: string, home?: string): Promise<Record<string, unknown> | undefined> {
  assertLabel(label)
  return readMetaUnchecked(provider, label, home)
}

export async function saveToken(
  provider: string,
  label: string,
  token: string,
  meta?: Record<string, unknown>,
  home?: string,
): Promise<void> {
  assertLabel(label)
  const trimmed = token.trim()
  if (trimmed === "") throw new Error("empty token")
  const dir = providerDir(provider, home)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await atomicWrite(join(dir, `${label}.token`), trimmed)
  if (meta !== undefined) await atomicWrite(join(dir, `${label}.json`), `${JSON.stringify(meta, null, 2)}\n`)
}

export async function clearToken(provider: string, label: string, home?: string): Promise<void> {
  assertLabel(label)
  const dir = providerDir(provider, home)
  await rm(join(dir, `${label}.token`), { force: true })
  await rm(join(dir, `${label}.json`), { force: true })
}

/** All stored accounts of a provider, sorted by label. A missing directory or a stray/corrupt file is skipped, never thrown. */
export async function listStoredAccounts(provider: string, home?: string): Promise<StoredAccount[]> {
  const dir = providerDir(provider, home)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const accounts: StoredAccount[] = []
  for (const name of names) {
    if (!name.endsWith(".token")) continue
    const label = name.slice(0, -".token".length)
    if (!isValidLabel(label)) continue
    const token = await readTokenUnchecked(provider, label, home)
    if (token === undefined) continue
    const meta = await readMetaUnchecked(provider, label, home)
    accounts.push(meta === undefined ? { label, token } : { label, token, meta })
  }
  accounts.sort((a, b) => a.label.localeCompare(b.label))
  return accounts
}

function assertLabel(label: string): void {
  if (!isValidLabel(label)) throw new Error(`invalid label: ${JSON.stringify(label)}`)
}

function providerDir(provider: string, home?: string): string {
  return join(quotaHome(home), provider)
}

async function readTokenUnchecked(provider: string, label: string, home?: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(join(providerDir(provider, home), `${label}.token`), "utf8")
  } catch {
    return undefined
  }
  const trimmed = text.trim()
  return trimmed === "" ? undefined : trimmed
}

async function readMetaUnchecked(provider: string, label: string, home?: string): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(join(providerDir(provider, home), `${label}.json`), "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined // corrupt metadata is tolerated — the token still works
  }
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await writeFile(tmp, data, { mode: 0o600 })
    await chmod(tmp, 0o600) // belt and braces against umask interference
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
