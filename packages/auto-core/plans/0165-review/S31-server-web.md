# S31 — Service shell C: web client, docs, test health

Date: 2026-11-04. HEAD read: dca9544ab (= d579016b2 in scope; S26–S30's commits touched only plans/). Status: done.

## Coverage

- auto-server/web/: main.ts probe (token handling 56-77, 624-650; start form), ops.ts probe (textContent discipline, fix dryrun, gated flows), render.ts deep on START_OPTION_FIELDS/buildStartOptions (78-135), api.ts:1-90 (auth transport), sse.ts + interactive.ts probe (auth, reconnect).
- auto-server/README.md probe (v1 boundary 255-262, auth 133-148, container notes 107-111). docs/daemon.md grep-driven: status vocabulary 346-370, the write surface 729-765, honestly-absent 804-815, WS auth row 514, the confinement launcher 817-830.
- The three named stale comments read in place (ops.ts:47-51, worker.ts:415-421, profile.ts:40-45).
- test/worker.test.ts:116-190 deep (the usage-vocabulary cases); the 0160 web-form residual checked against START_OPTION_FIELDS.

## Findings

```jsonl
{"id":"S31-01","title":"Three comments older than the shipped surface: ops.ts's status vocabulary says 'the models probe is not exposed' (its own header's P4b sentence and daemon.md's corrected 501 row say otherwise); worker.ts's phasesLine comment says the plan route 'arrives with P1d' (arrived); profile.ts says config-fix routes 'arrive with the REST lifecycle surface' and keys the recovery hint on their absence","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","P8"],"loc":["auto-server/src/ops.ts:49-50","auto-server/src/worker.ts:417-419","auto-server/src/profile.ts:42-45"],"symbol":"the three stale headers","evidence":"ops.ts:7-9 'Since P4b the models probe is served too' vs ops.ts:50 '(…; the models probe is not exposed)'; daemon.md:364 'the models probe's P1 refusal ended with P4b'; worker.ts:418 'since this shell's own plan route arrives with P1d' — the plan op ships (ops.ts serves it); profile.ts:43-45 'its config-fix routes arrive with the REST lifecycle surface' (they shipped) — so agentRecovery \"startup\" teaches re-running the shell where the fix operation is the better remedy","repro":null,"impact":"a maintainer reading the headers mis-dates the surface; the recovery hint's weaker remedy is the only person-facing cost (the profile value itself still works)","remedy":"one comment pass: the 501 parenthetical drops the probe clause; the phasesLine comment states the current teaching problem (S29-08/S30-04) instead of a future route; profile.ts states the fix op as live and re-judges agentRecovery","family":["S29-08","S30-04"],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S31-02","title":"daemon.md's honestly-absent list omits release and install-prompts — two CLI-side surfaces not stated in the section whose own standard is 'stated once and plainly'","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","P18"],"loc":["auto-server/docs/daemon.md:804-812"],"symbol":"the honestly-absent surfaces","evidence":"the list names clarify, sync, land, fork/remove-fork, driver-helper, init --intent; release (the person's release gate) and install-prompts (the manual-suite resync) are absent surfaces absent from the list","repro":null,"impact":"a reader auditing the shell's boundary cannot tell deliberate absence from omission","remedy":"add the two rows","family":["S26-05","S28-03 (the same list-truth family on the CLI side)"],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S31-03","title":"worker.test.ts's usage-vocabulary case spawns ~15 workers in one test — deterministically 6.9 s against bun's 5 s default (the S00 breach); the fix is splitting the case, not raising a timeout","sev":"S4","conf":"CONFIRMED","cat":"TEST","measures":["P19","S00"],"loc":["auto-server/test/worker.test.ts:116-177"],"symbol":"the frozen-key usage test","evidence":"one test() loops six frozen spellings + four 0160 keys + lanes + two on/off pairs + two carriers ≈ 15 sequential runWorker spawns (a full bun child each, ~0.45 s); S00 measured 6.9 s alone vs the 5 s default","repro":{"cmd":"the S00 record (deterministic breach, not re-run this step)","observed":"S00: 'worker.test.ts \"usage vocabulary\" deterministically over bun's 5 s default (6.9 s alone)'"},"impact":"a deterministic red suite on default invocations","remedy":"split per family (frozen spellings / the 0160 keys / carriers / on-off pairs), each well under the budget — the case grows with every new frozen key, so a raised timeout only postpones the next breach; test.each keeps one spawn per case","family":["S30-05 (the same suite's timing health)"],"prior":"NEW","wave_hint":"test health"}
```

## Leads

None assigned to S31.

## Residuals

- 0160 the web form's minimal options — **still open, by construction**: START_OPTION_FIELDS carries 8 keys (verbose, newSession, dryrun, waitAnswer, waitBetween, permission, maxSessions, server); `repair`, `stopAfter` and `boundary` are API/CLI-side only (render.ts:95 'a subset of the request vocabulary by construction'). Deliberate minimalism, revisit when a web user needs the retry guardrail.
- 0160 surfaces beyond D4 staying CLI-only — **holds** (the honestly-absent section carries the stance; its two missing entries are S31-02).

## Verified clean

- Web token handling: the bearer token lives in an input field and `state.token` in memory only — no localStorage/sessionStorage anywhere in web/ (grep empty); the token rides the Authorization header on every fetch including the SSE tails (api.ts:8-13 — a deliberate wrapper so SSE needs no query-string token); the only query-string credentials are the WS endpoints that cannot carry headers, documented as the v1 loopback posture (daemon.ts:808-811, daemon.md:514).
- XSS: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval` anywhere under web/ (grep empty) — the textContent-only discipline is stated in main.ts:28 and ops.ts:40 and holds; run tails, question cards and verdict tables all render through the text helpers.
- CSRF/Origin: no cookie auth exists (bearer tokens only), so cross-site request forgery has no automatic credential to ride — inapplicable by design; the DNS-rebinding residual is bounded by the loopback default bind (index.ts:393-416, documented at README:257) and by every state-changing route requiring a token the rebinder does not hold; the daemon serves static assets unauthenticated but nothing else without a scope.
- Status vocabulary truth: daemon.md's table (200/202/400/404/409/423/428/429/501, the fix-dryrun exit mapping incl. 0135's info-notes rule) matches ops.ts's implementation; the doc is in places newer than the code's own comments (S31-01).
- The write surface's gate constitution holds in the client: confirm and clean-tree are separate steps with separate fields, each refusal rendering its own step (daemon.md:748-760; ops.ts's gated flows); the client never touches target-repo state directly (no git in the browser, mutations only API → daemon → core).

## Design notes

The web client is the most conservative layer of the family: memory-only tokens, a DOM discipline that structurally excludes injected markup, and a write surface that routes every mutation through the core. The docs are strong — daemon.md's status vocabulary and honest-absent section are better kept than the CLI's README tables (the drift found runs the other way: code comments older than the docs). The test-health theme (S30-05, S31-03) is the suite's one recurring cost: process-spawning assertions bundled into single cases. Best choice: the SSE-over-fetch wrapper keeping tokens out of URLs. Worst: none found here — the two doc findings are table-truth items. Change first: the worker-test split (it is the deterministic red).

## Seam notes

- S32: the web layer contributes no DUP items (its api.ts is the shell's own surface); the test-health pair (S30-05/S31-03) belongs in the test-strategy synthesis; the v1 security posture (loopback + bearer + no Origin check) is one row of the security table.
- S34: S31-01..03 are CONFIRMED doc/test findings with cited lines and the S00 record.
