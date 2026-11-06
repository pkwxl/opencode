// The one rule for naming a server URL in anything the driver prints
// (plans/0180 D1, 0165-130 / S17-04): a URL may carry user information
// (userinfo — `scheme://user:password@host`), and C4 keeps secrets out of
// everything the driver prints, so every line that names a server URL shows
// it without its user information; a URL without one is shown as written.
// One home shared by the opencode host's restart refusal and the claude
// host's --server warning (intra-domain); the driver domain's lines (the
// switch registry's run-start line, the `models` output whose own copy was
// lifted from models-describe.ts) read the leaf itself — a sanctioned
// domain entry beside the adapters (the one-way invariant keeps them off
// the agent host) — P5: one rule, one home.
export function displayUrl(server: string): string {
  try {
    const url = new URL(server)
    if (!url.username && !url.password) return server
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return server
  }
}
