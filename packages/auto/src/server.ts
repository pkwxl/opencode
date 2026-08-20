import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2"

export type Server = {
  client: OpencodeClient
  url: string
  close: () => void
}

// Prefer an already-running `opencode serve` (explicit url or
// OPENCODE_AUTO_SERVER); otherwise spawn one and own its lifetime.
// The `directory` client option targets the project per request, so a single
// server can drive any target directory.
export async function ensure(directory: string, url?: string): Promise<Server> {
  const existing = url ?? process.env.OPENCODE_AUTO_SERVER
  if (existing) {
    const healthy = await fetch(new URL("/api/health", existing)).then(
      (res) => res.ok,
      () => false,
    )
    if (!healthy) throw new Error(`opencode server 不可用: ${existing}`)
    return { client: createOpencodeClient({ baseUrl: existing, directory }), url: existing, close: () => {} }
  }
  const spawned = await createOpencodeServer({ port: 0 })
  return {
    client: createOpencodeClient({ baseUrl: spawned.url, directory }),
    url: spawned.url,
    close: () => spawned.close(),
  }
}
