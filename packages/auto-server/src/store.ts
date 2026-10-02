// The daemon-owned store (P1c, auto-core plans/0067 §五): the registered
// project list (the target-directory whitelist) and the auth tokens. Both
// live in the daemon's own data directory — outside every target directory
// and never under `.auto/`, whose writes are driver-exclusive by
// constitution; daemon-owned state is daemon-owned state (the assessment's
// §8 Q2 decision puts the pending-question queue in the same place for the
// same reason). The data directory defaults under the XDG config root the
// core's operator registry already uses (`$XDG_CONFIG_HOME/opencode-auto`,
// default `~/.config`), namespaced `server/`: one operator, one config
// root, the service's own state beside — never inside — the projects.
//
// The whitelist is absolute (plans/0067 §五, trust-boundary amplification):
// `.opencode/auto/` overlays are injected verbatim into prompts, and this
// tool spends real tokens and writes git — one-click runs on arbitrary
// directories would amplify both. A run request resolves its target ONLY
// against this registry (name or the registered absolute path, exact match);
// the daemon never resolves an arbitrary request path.
//
// Concurrency shape: the CLI commands (register/token) and a running daemon
// share these files, so every read goes to disk (the files are tiny and
// local) and every write is atomic (temp file + rename, the core's own
// state-file pattern) — a token issued while the daemon serves is honored
// by the very next request, with no restart and no lock protocol.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"

// The token scopes, the authorization tiers of the assessment's §8 Q6:
//   read    status, logs, events (and the SSE feeds of P1e)
//   control run control (spawn, kill), close, task-add, plan — the surfaces
//           that spend tokens and write git through a run
//   config  init/amend/fix/reset (P1d's routes)
//   answer  the pending-question queue (P3c)
//   probe   the model probe (POST /projects/<project>/models, P4b) — its
//           own opt-in scope, DISABLED BY DEFAULT: carried by no default
//           token set (it burns tokens by starting agents; beside the scope
//           the route takes an explicit confirm field and the daemon's
//           per-daemon rate window)
export const SCOPES = ["read", "control", "config", "answer", "probe"] as const
export type Scope = (typeof SCOPES)[number]

export type RegisteredProject = { name: string; directory: string; registered: string }
export type StoredToken = { name: string; hash: string; scopes: Scope[]; created: string }

export class StoreError extends Error {}

const PROJECTS_FILE = "projects.json"
const TOKENS_FILE = "tokens.json"

// The default data directory: $XDG_CONFIG_HOME/opencode-auto/server (XDG
// relative values are invalid and ignored, the core's models.ts precedent),
// so `~/.config/opencode-auto/server/` on a plain machine — beside the
// operator model registry, never inside a project.
export function defaultDataDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, ".config")
  return join(base, "opencode-auto", "server")
}

// One presented token's digest. SHA-256 over the raw token; the store keeps
// only the digest, so the tokens file is not itself a credential (the
// plaintext is printed once at issue and never stored).
function digest(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}

// A fresh token: `oas_` + 32 random bytes, base64url (43 characters of
// URL-safe entropy — no provider credentials, just daemon-local randomness).
function freshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `oas_${Buffer.from(bytes).toString("base64url")}`
}

export class DaemonStore {
  readonly dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  // —— the whitelist ——

  listProjects(): RegisteredProject[] {
    return this.readJson(PROJECTS_FILE, []) as RegisteredProject[]
  }

  // Registers dir as a runnable project. The directory must exist (a
  // registered path is one a worker can spawn into) and is canonicalized
  // with realpath, so a symlink and its target are one project, not two.
  // The project's name is its final path segment; names and paths are each
  // unique in the registry (a second directory with a taken name is refused
  // with the pointer at the path-as-identifier — renaming registrars is not
  // a surface P1 needs).
  // AUTO-DECISION (name derivation, no override flag): the name is a
  // convenience identifier for POST /runs; the registered absolute path
  // identifies the project equally, so a name collision costs nothing
  // beyond typing the path.
  register(rawDir: string): RegisteredProject {
    if (!existsSync(rawDir)) throw new StoreError(`cannot register ${rawDir}: not a directory on this machine`)
    let directory: string
    try {
      directory = realpathSync(resolve(rawDir))
    } catch {
      throw new StoreError(`cannot register ${rawDir}: ${rawDir} cannot be resolved`)
    }
    const projects = this.listProjects()
    if (projects.some((project) => project.directory === directory)) {
      throw new StoreError(`${directory} is already registered (as "${projects.find((project) => project.directory === directory)!.name}")`)
    }
    const name = basename(directory)
    if (projects.some((project) => project.name === name)) {
      const other = projects.find((project) => project.name === name)!
      throw new StoreError(`the name "${name}" is already taken by ${other.directory}; register ${directory} anyway is not possible under the same name — requests may name the registered absolute path instead (or unregister that project first)`)
    }
    const project: RegisteredProject = { name, directory, registered: new Date().toISOString() }
    this.writeJson(PROJECTS_FILE, [...projects, project])
    return project
  }

  unregister(nameOrDirectory: string): RegisteredProject {
    const projects = this.listProjects()
    const at = projects.findIndex((project) => project.name === nameOrDirectory || project.directory === nameOrDirectory)
    if (at === -1) throw new StoreError(`no registered project "${nameOrDirectory}"`)
    const [removed] = projects.splice(at, 1)
    this.writeJson(PROJECTS_FILE, projects)
    return removed!
  }

  // The whitelist lookup: a request's `project` is resolved ONLY against
  // the registry — the registered name, or the registered absolute path,
  // both exact matches. An arbitrary path that is not registered is simply
  // not found; the daemon never executes or interprets request input.
  // AUTO-DECISION (canonical spelling of the path form): a presented path
  // that is not byte-identical to the stored one gets one canonicalization
  // — realpath, the same canonicalization registration applies — before
  // the exact-match attempt. Without it, the two standard spellings of a
  // macOS temp path (/tmp vs /private/tmp, where realpathSync wrote the
  // registry entry) would name the same registered project differently,
  // and the whitelist would 404 its own registrations. The property holds:
  // the canonical path must EQUAL a registered directory, so nothing that
  // is not registered can ever resolve.
  resolveProject(project: string): RegisteredProject | undefined {
    const projects = this.listProjects()
    const direct = projects.find((entry) => entry.name === project || entry.directory === project)
    if (direct) return direct
    if (!isAbsolute(project)) return undefined
    let canonical: string
    try {
      canonical = realpathSync(resolve(project))
    } catch {
      return undefined
    }
    return projects.find((entry) => entry.directory === canonical)
  }

  // —— the tokens ——

  listTokens(): StoredToken[] {
    return this.readJson(TOKENS_FILE, []) as StoredToken[]
  }

  // Issues a token carrying exactly the given scopes. The scopes must be a
  // non-empty subset of the schema; `probe` is choosable here and required
  // by the probe route (P4b) — still opt-in, still carried by nothing until
  // an operator names it.
  issueToken(rawScopes: string, name?: string): { token: string; stored: StoredToken } {
    const wanted = [...new Set(rawScopes.split(",").map((part) => part.trim()).filter(Boolean))]
    if (!wanted.length) throw new StoreError("a token needs at least one scope (read, control, config, answer, probe)")
    for (const scope of wanted) {
      if (!(SCOPES as readonly string[]).includes(scope)) {
        throw new StoreError(`unknown scope "${scope}" (the schema: ${SCOPES.join(", ")})`)
      }
    }
    const scopes = SCOPES.filter((scope) => wanted.includes(scope))
    const tokens = this.listTokens()
    const fallback = `token-${tokens.length + 1}`
    const label = name?.trim() || fallback
    if (tokens.some((token) => token.name === label)) throw new StoreError(`a token named "${label}" already exists (revoke it first, or issue under a new name)`)
    const stored: StoredToken = { name: label, hash: "", scopes: [...scopes], created: new Date().toISOString() }
    const token = freshToken()
    stored.hash = digest(token)
    this.writeJson(TOKENS_FILE, [...tokens, stored], 0o600)
    return { token, stored }
  }

  revokeToken(name: string): StoredToken {
    const tokens = this.listTokens()
    const at = tokens.findIndex((token) => token.name === name)
    if (at === -1) throw new StoreError(`no token named "${name}"`)
    const [removed] = tokens.splice(at, 1)
    this.writeJson(TOKENS_FILE, tokens, 0o600)
    return removed!
  }

  // Verifies a presented token and returns its scopes; undefined = unknown
  // token. Digesting the presentation and comparing digests keeps the
  // comparison off the raw secret.
  verifyToken(presented: string): Scope[] | undefined {
    const hash = digest(presented)
    return this.listTokens().find((token) => token.hash === hash)?.scopes
  }

  // —— the files ——

  private readJson(file: string, fallback: unknown): unknown {
    const path = join(this.dataDir, file)
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch {
      return fallback
    }
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StoreError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private writeJson(file: string, value: unknown, mode?: 0o600): void {
    mkdirSync(this.dataDir, { recursive: true })
    const path = join(this.dataDir, file)
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined)
    renameSync(tmp, path)
  }
}
