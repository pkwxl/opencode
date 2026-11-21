import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_FILE } from "@opencode-ai/auto-core/config"
import { git } from "@opencode-ai/auto-core/git"
import { startDaemon } from "../src/daemon"
import { openProjectCreation } from "../src/project-creation"
import { applyServerProfile } from "../src/profile"
import { DaemonStore } from "../src/store"

const fixtures: string[] = []
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "open-project-"))
  fixtures.push(path)
  const root = join(path, "root")
  mkdirSync(root, { mode: 0o700 })
  return { root, store: new DaemonStore(join(path, "store")), path }
}

const linuxTest = process.platform === "linux" ? test : test.skip

for (const point of ["booked", "directory", "partial-init", "initialized", "published", "registered"]) {
  linuxTest(`recovers open creation after the process dies at ${point}`, async () => {
    const { root, store } = fixture()
    const creationSource = new URL("../src/project-creation.ts", import.meta.url).href
    const profileSource = new URL("../src/profile.ts", import.meta.url).href
    const storeSource = new URL("../src/store.ts", import.meta.url).href
    const child = Bun.spawn([process.execPath, "-e", `
      import { join } from "node:path";
      import { readdirSync, writeFileSync } from "node:fs";
      import { openProjectCreation } from ${JSON.stringify(creationSource)};
      import { applyServerProfile } from ${JSON.stringify(profileSource)};
      import { DaemonStore } from ${JSON.stringify(storeSource)};
      const [root, dataDir, point] = process.argv.slice(1);
      applyServerProfile();
      const creation = openProjectCreation(new DaemonStore(dataDir), (current) => {
        if (current === "directory" && point === "partial-init") {
          const stage = readdirSync(root).find((name) => name.startsWith(".auto-create-"));
          writeFileSync(join(root, stage, "AGENTS.md"), "Interrupted init");
          process.kill(process.pid, "SIGKILL");
        }
        if (current === point) process.kill(process.pid, "SIGKILL");
      });
      const result = await creation.request("owner", { directory: join(root, "widget") });
      console.error(JSON.stringify(result));
      await creation.close();
    `, root, store.dataDir, point], { stderr: "pipe", stdout: "ignore" })
    await child.exited
    expect({ signal: child.signalCode, stderr: await new Response(child.stderr).text() }).toEqual({ signal: "SIGKILL", stderr: "" })

    const directory = join(root, "widget")
    expect(store.listProjects()).toHaveLength(point === "registered" ? 1 : 0)
    expect(existsSync(directory)).toBe(point === "published" || point === "registered")
    applyServerProfile()
    const creation = openProjectCreation(store)
    try {
      expect(await creation.request("intruder", { directory })).toMatchObject({ status: 409 })
      expect(await creation.request("owner", { directory, config: { subtask: "auto" } })).toMatchObject({ status: 409 })
      const result = await creation.request("owner", { directory })
      expect(result).toMatchObject({ status: 200, body: { project: { name: "widget", directory } } })
      expect(await creation.request("owner", { directory: join(root, "widget") })).toEqual(result)
      expect(store.listProjects()).toHaveLength(1)
      expect(readdirSync(root)).toEqual(["widget"])
      expect(await Bun.file(join(directory, CONFIG_FILE)).json()).toMatchObject({ subtask: "off" })
      expect(existsSync(join(directory, ".git"))).toBe(true)
      expect(await Bun.file(join(directory, "AGENTS.md")).text()).not.toContain("Interrupted init")
    } finally {
      await creation.close()
    }
  })
}

linuxTest("creation is always mounted (plans/0284) and the projects grant authorizes the complete request", async () => {
  const { root, path, store } = fixture()
  const { token: reader } = store.issueToken("read", "reader")
  const { token: owner } = store.issueToken("projects", "creator")
  // No boot-time roots anymore (plans/0284): a plain daemon serves POST
  // /projects, the request naming the directory itself.
  const daemon = await startDaemon({ dataDir: store.dataDir, port: 0 })
  const request = (url: string, token: string, body: object) => fetch(`${url}/projects`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  try {
    expect((await request(daemon.url, reader, { directory: join(root, "widget") })).status).toBe(403)
    expect((await request(daemon.url, owner, { directory: "relative/widget" })).status).toBe(400)
    expect((await request(daemon.url, owner, { directory: join(path, "absent", "widget") })).status).toBe(400)
    expect((await request(daemon.url, owner, { directory: join(root, "widget"), config: { subtask: "invalid" } })).status).toBe(400)
    for (const config of [{ mode: "typo" }, { intent: "typo" }, { handoverTest: true }]) {
      const refused = await request(daemon.url, owner, { directory: join(root, "widget"), config })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: expect.stringContaining(`config.${Object.keys(config)[0]}`) })
    }
    expect(readdirSync(root)).toEqual([])
    const created = await request(daemon.url, owner, { directory: join(root, "widget") })
    expect(await created.json()).toMatchObject({ project: { name: "widget" } })
    expect(created.status).toBe(200)
    expect(store.resolveProject("widget")?.directory).toBe(join(root, "widget"))
    renameSync(join(root, "widget"), join(root, "original"))
    symlinkSync(path, join(root, "widget"), "dir")
    expect(store.resolveProject("widget")).toBeUndefined()
  } finally {
    await daemon.stop()
  }
})

linuxTest("root and destination replacements do not redirect writes or publish partial projects", async () => {
  const { root, path, store } = fixture()
  const outside = join(path, "outside")
  mkdirSync(outside)
  applyServerProfile()
  const creation = openProjectCreation(store, (point) => {
    if (point === "directory") {
      renameSync(root, join(path, "original"))
      symlinkSync(outside, root, "dir")
    }
  })
  try {
    expect(await creation.request("owner", { directory: join(root, "widget") })).toMatchObject({ status: 409 })
    expect(readdirSync(outside)).toEqual([])
    expect(store.resolveProject("widget")).toBeUndefined()
  } finally {
    await creation.close()
  }
  rmSync(root)
  renameSync(join(path, "original"), root)
  const occupied = openProjectCreation(store, (point) => {
    if (point === "initialized") mkdirSync(join(root, "occupied"))
  })
  try {
    expect(await occupied.request("owner", { directory: join(root, "occupied") })).toMatchObject({ status: 409 })
    expect(readdirSync(join(root, "occupied"))).toEqual([])
    expect(store.resolveProject("occupied")).toBeUndefined()
  } finally {
    await occupied.close()
  }
})

linuxTest("a new project inside a Git worktree has its own repository", async () => {
  const { root, path, store } = fixture()
  expect(await git(path, ["init", "-b", "outer"])).toMatchObject({ code: 0 })
  const outerConfig = await Bun.file(join(path, ".git/config")).text()
  applyServerProfile()
  const creation = openProjectCreation(store)
  try {
    expect(await creation.request("owner", { directory: join(root, "widget") })).toMatchObject({ status: 200 })
    const directory = join(root, "widget")
    expect(await git(directory, ["rev-parse", "--show-toplevel"])).toMatchObject({ code: 0, out: `${directory}\n` })
    expect(await git(path, ["symbolic-ref", "--short", "HEAD"])).toMatchObject({ code: 0, out: "outer\n" })
    expect(await Bun.file(join(path, ".git/config")).text()).toBe(outerConfig)
  } finally {
    await creation.close()
  }
})
