# 0284 — The project lifecycle over REST

The 0279 docket's fifth slice: the registry the whole daemon surface
resolves against becomes a served lifecycle — `DELETE
/projects/<project>` lands, `POST /projects` is generalized beyond the
retired `--open` roots, and `store.unregister` gains the live-refusal
condition the route and the CLI command share. The docket's scheduled
letters are done with it (0280–0284); what remains is the demolition
track (0285+).

## Category scope

Tier: mechanism — the daemon's project lifecycle, one package
(auto-server) plus the spec's section.

Derives: **P2** (the removal a bracketed act — the stop taught beside a
live run, never an implicit kill), **P5** (the live-refusal one home in
the store, the route adding only its own in-process knowledge), **P6**
(the staged creation idempotent, every kill point re-derivable — the
engine's standing design unchanged), **P13** (the `--open`/`--root` flags
permanent usage tombstones; the route vocabulary grows its DELETE word),
**P14** (the projects scope the trust boundary the roots used to be),
**P20** (a live coordinator never destroyed — the 409 names the stop and
the run id).

## The letters

- **`DELETE /projects/<project>`** — the `projects` scope; 404 for the
  unknown name; 409 beside a live coordinator or run this daemon spawned
  (the stop taught: `DELETE /runs/<id>`, the run id named); past the
  daemon's own knowledge, the store's shared live-refusal condition
  guards (a run lock held by a driver the daemon does not know — another
  host's or a hand-run process — the same 409 with its own remedy); past
  both, the registry entry is removed. The directory itself is never
  touched.
- **`POST /projects` generalized** — the creation engine always mounted;
  the request names the directory to create (`{"directory":
  "<absolute path>"}`, the basename the project name, a `"name"` field
  overriding, the optional `"config"` the init runs with). The
  destination's own parent is the anchor, validated per request with the
  posture the retired roots enforced at boot (operator-owned, no group or
  public write); the ledger keys by the destination (a digest of its
  path, so same-basename projects in different parents never collide).
  The staged engine itself — the private stage, the init, the
  no-replace publication, the registration — stands as 0265 built it.
- **`--open`/`--root` retired** — serve's boot-time creation roots are
  permanent usage tombstones naming the generalized surface (the flags'
  trust job is the `projects` scope's now).
- **`store.unregister`'s live-refusal** — the CLI's `unregister` and the
  DELETE route meet the same condition in the store: beside a live run
  lock in the project directory the entry stays, the refusal teaching the
  stop (the daemon-side `DELETE /runs/<id>`; a foreign lock its own
  host's stop or the by-hand lock removal).

## Tests and verification

The store and route suites: the lifecycle e2e over a real spawned
coordinator (401/403/404; the 409 naming the run id and the taught stop;
the kill landing; the retry deleting; `GET /projects` reflecting), the
daemon-side store arm (the planted foreign lock's 409 with the remedy;
the delete past it), the CLI's `--open`/`--root` retirement pins, and
the creation suite re-keyed to the generalized request (the plain daemon
serving `POST /projects`; the relative-path and absent-parent 400s; the
posture 403; the recovery loop over the directory-named request). The
spec gains the Project lifecycle section; the server README's creation
section is re-told generalized with the removal beside it; daemon.md's
retirement banner names the flags. The two protocol-doc ratchets stay
green (the lifecycle is prose — its route word rides no fenced block);
auto-server's suite green beside the standing baseline, typecheck exit 0.

Residuals: the data model's `openRoots` daemon option is gone with the
flags; a created project's first review-and-commit remains the person's
(the README teaches it); the demolition track (0285+) now owns
everything the docket enumerated beyond this slice.
