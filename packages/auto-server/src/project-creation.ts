import { dlopen, ptr } from "bun:ffi"
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { CONFIG_DEFAULTS } from "@opencode-ai/auto-core/config"
import { initializeRepository } from "@opencode-ai/auto-core/git"
import { loadIntents } from "@opencode-ai/auto-core/intent/load"
import { acquireRunLock, liveRunLock } from "@opencode-ai/auto-core/lock"
import { loadModes } from "@opencode-ai/auto-core/mode"
import { OP_DEFINITIONS, parseConfigKeys, type OpOutcome } from "./ops"
import { DaemonStore, type RegisteredProject } from "./store"

type Identity = { dev: string; ino: string }
type Intent = {
  root: Identity
  directory: string
  owner: string
  config: string
  stage: string
  identity?: Identity
  initialized?: true
  registered?: true
}
type Checkpoint = "booked" | "directory" | "initialized" | "published" | "registered"
type Root = { path: string; identity: Identity }
type Result = OpOutcome

const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const init = OP_DEFINITIONS.find(({ segment }) => segment === "init")!
const fail = (status: number, error: string): Result => ({ status, body: { error } })
const identity = ({ dev, ino }: { dev: bigint; ino: bigint }): Identity => ({ dev: String(dev), ino: String(ino) })
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino
const anchor = (fd: number) => `/proc/${process.pid}/fd/${fd}`

function directoryAt(path: string): Identity | undefined {
  try {
    const info = lstatSync(path, { bigint: true })
    if (!info.isDirectory()) throw new Error("A creation path is occupied by a file or symbolic link.")
    return identity(info)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

// The generalized creation engine (plans/0284): the request names the
// directory to create — no operator-declared roots at boot, the destination's
// own parent the anchor, validated per request (operator-owned, no group or
// public write — the same posture the retired --open roots enforced, the
// projects scope the trust boundary that reaches the route at all).
export function openProjectCreation(store: DaemonStore, checkpoint?: (point: Checkpoint) => void) {
  if (process.platform !== "linux") throw new Error("Project creation requires Linux directory descriptors and no-replace rename.")
  // renameat2 is required: an ordinary rename can replace an empty directory
  // created between a destination check and publication.
  const native = dlopen("libc.so.6", {
    renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
  })
  const ledger = resolve(store.dataDir, "project-creation")
  let pending: Promise<Result> | undefined
  let closed = false

  async function create(owner: string, body: Record<string, unknown>): Promise<Result> {
    const { directory: rawDirectory, name: rawName, config } = body
    if (Object.keys(body).some((key) => !["directory", "name", "config"].includes(key)) ||
        typeof rawDirectory !== "string" || !rawDirectory.trim() ||
        (rawName !== undefined && (typeof rawName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(rawName))) ||
        (config !== undefined && (config === null || typeof config !== "object" || Array.isArray(config)))) {
      return fail(400, "Provide the directory to create (an absolute path whose parent exists), an optional project name, and optional init config.")
    }
    const name = rawName ?? basename(rawDirectory)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      return fail(400, `the project name "${name}" (the directory's basename, or the request's name) must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}`)
    }
    const parent = dirname(rawDirectory)
    let parentInfo
    try {
      parentInfo = lstatSync(parent, { bigint: true })
    } catch {
      return fail(400, `the parent of ${rawDirectory} does not exist — create the project inside an existing directory`)
    }
    if (!parentInfo.isDirectory() || parentInfo.uid !== BigInt(process.geteuid!()) || (parentInfo.mode & 0o022n) !== 0n) {
      return fail(403, `the parent ${parent} must be an operator-owned directory without group or public write access (the creation anchor's standing posture)`)
    }
    if (!isAbsolute(rawDirectory)) return fail(400, "the directory must be an absolute path")
    const directory = resolve(rawDirectory)
    if (basename(directory) !== name && rawName === undefined) {
      return fail(400, "the directory's basename becomes the project name; pass a matching name to override it")
    }
    const target: Root = { path: parent, identity: identity(parentInfo) }
    const destination = Buffer.from(name + "\0")
    const requested = canonicalJSON({ subtask: "off", ...config })
    mkdirSync(ledger, { recursive: true, mode: 0o700 })
    const lockDir = realpathSync(ledger)
    if (liveRunLock(lockDir)) return fail(409, "Project creation is busy. Retry the same request.")
    const lock = acquireRunLock(lockDir, "project creation")
    if (!lock.ok) return fail(409, "Project creation is busy. Retry the same request.")
    let rootFd: number | undefined
    let stageFd: number | undefined
    try {
      rootFd = openSync(target.path, flags)
      const rootInfo = fstatSync(rootFd, { bigint: true })
      if (!same(identity(rootInfo), target.identity) || (rootInfo.mode & 0o022n) !== 0n) {
        return fail(409, "The configured root was replaced. Ask the operator to inspect it and restart the daemon.")
      }
      const anchored = anchor(rootFd)
      const path = join(ledger, `${createHash("sha256").update(directory).digest("hex").slice(0, 24)}-${name}.json`)
      const save = (value: Intent) => {
        const temp = `${path}.tmp`
        writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
        renameSync(temp, path)
      }
      let intent: Intent
      try {
        intent = JSON.parse(readFileSync(path, "utf8")) as Intent
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        if (directoryAt(join(anchored, name)) || store.listProjects().some((project) => project.name === name)) {
          return fail(409, "The project is already present. Choose a new name or ask the operator to register the existing directory.")
        }
        intent = { root: target.identity, directory, owner, config: requested, stage: `.auto-create-${randomUUID()}` }
        try {
          const fresh = join(anchored, intent.stage)
          const { mode, explicit } = parseConfigKeys(fresh, JSON.parse(requested))
          if (mode !== undefined && !Object.hasOwn(loadModes(fresh), mode)) {
            return fail(400, "config.mode must name a registered mode available to a new project.")
          }
          if (explicit.intent !== undefined && !Object.hasOwn(loadIntents(fresh), explicit.intent)) {
            return fail(400, "config.intent must name an intent pack available to a new project.")
          }
          if ((explicit.handoverTest ?? CONFIG_DEFAULTS.handoverTest) && !(explicit.testByDriver ?? CONFIG_DEFAULTS.testByDriver)) {
            return fail(400, "config.handoverTest requires config.testByDriver: true.")
          }
        } catch (error) {
          return fail(400, error instanceof Error ? error.message : "Invalid init config.")
        }
        save(intent)
        checkpoint?.("booked")
      }
      if (!/^\.auto-create-[0-9a-f-]{36}$/.test(intent.stage) ||
          (intent.initialized && !intent.identity) || (intent.registered && !intent.initialized)) {
        return fail(409, "The project creation record is invalid. Ask the operator to inspect it.")
      }
      if (!same(intent.root, target.identity) || intent.directory !== directory || intent.owner !== owner || intent.config !== requested) {
        return fail(409, "A different creation request owns this project name. Retry the original request or choose a new name.")
      }
      const staged = join(anchored, intent.stage)
      const existing = directoryAt(join(anchored, name))
      if (existing) {
        if (!intent.initialized || !intent.identity || !same(existing, intent.identity)) {
          return fail(409, "The destination is occupied by a different directory. Ask the operator to inspect it.")
        }
      } else {
        if (intent.registered) return fail(409, "The registered project directory is missing. Ask the operator to inspect it.")
        const found = directoryAt(staged)
        if (!found && !intent.identity) mkdirSync(staged, { mode: 0o700 })
        stageFd = openSync(staged, flags)
        const info = fstatSync(stageFd, { bigint: true })
        const id = identity(info)
        const workspace = anchor(stageFd)
        if (info.uid !== BigInt(process.geteuid!()) || (info.mode & 0o077n) !== 0n ||
            (intent.identity ? !same(intent.identity, id) : readdirSync(workspace).length > 0)) {
          return fail(409, "Creation staging has changed. Ask the operator to inspect it.")
        }
        if (!intent.identity) {
          intent.identity = id
          save(intent)
          checkpoint?.("directory")
        }
        if (!intent.initialized) {
          // An interrupted init can leave any prefix of the config surfaces.
          // Restart it in the pinned private directory from its empty state.
          for (const entry of readdirSync(workspace)) rmSync(join(workspace, entry), { recursive: true, force: true })
          const repository = await initializeRepository(workspace)
          if (repository.type === "failed") return fail(409, `Cannot initialize a standalone Git repository: ${repository.error}`)
          const outcome = await init.run({
            project: { name, directory: workspace, registered: "" },
            body: { config: JSON.parse(intent.config) },
            query: new URLSearchParams(),
          })
          if (outcome.status !== 200) return outcome
          intent.initialized = true
          save(intent)
          checkpoint?.("initialized")
        }
        const visible = directoryAt(target.path)
        if (!visible || !same(visible, target.identity)) return fail(409, "The configured root changed before publication.")
        const source = directoryAt(staged)
        if (!source || !same(source, id)) return fail(409, "Creation staging was replaced before publication.")
        if (native.symbols.renameat2(rootFd, ptr(Buffer.from(intent.stage + "\0")), rootFd, ptr(destination), 1) !== 0) {
          return fail(409, "The project could not be published without replacement. Inspect the destination and retry.")
        }
        checkpoint?.("published")
      }
      const visibleRoot = directoryAt(target.path)
      const visibleProject = directoryAt(directory)
      if (!visibleRoot || !same(visibleRoot, target.identity) || !visibleProject || !intent.identity || !same(visibleProject, intent.identity)) {
        return fail(409, "The configured root or project was replaced. Ask the operator to inspect it.")
      }
      const previous = store.listProjects().find((project) => project.name === name)
      let project: RegisteredProject
      if (previous?.directory === directory && previous.creation && same(previous.creation, intent.identity)) project = previous
      else if (previous || intent.registered) return fail(409, "The project registration changed. Ask the operator to inspect the registry.")
      else {
        project = store.registerCreated(directory, intent.identity)
        checkpoint?.("registered")
      }
      if (!intent.registered) save({ ...intent, registered: true })
      return { status: 200, body: { project } }
    } finally {
      if (stageFd !== undefined) closeSync(stageFd)
      if (rootFd !== undefined) closeSync(rootFd)
      lock.release()
    }
  }

  return {
    async request(owner: string, body: Record<string, unknown>): Promise<Result> {
      if (closed) return fail(503, "Project creation is shutting down. Retry the same request.")
      if (pending) return fail(409, "Project creation is busy. Retry the same request.")
      pending = create(owner, body)
      try {
        return await pending
      } catch (error) {
        return fail(409, error instanceof Error ? error.message : String(error))
      } finally {
        pending = undefined
      }
    },
    async close() {
      if (closed) return
      closed = true
      await pending?.catch(() => undefined)
      native.close()
    },
  }
}
