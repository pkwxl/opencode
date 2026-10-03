# 0073 — Git bootstrap at init

Status: **proposal, 2026-10-03.** Follow-up feature per the person's ruling of 2026-10-03
(enters via `plan --append` behind its own design doc + ruling). Covers original
requirement 2: `init` in a directory without a `.git` repository should initialize Git
and configure the required identity in one go.

## 1. Problem

Today a non-git target directory is a silent degradation tier:

- `commitIdentityProblem` (`src/git.ts`) returns `undefined` for a directory outside any
  work tree, so **init succeeds**;
- `repoRoots` then returns `[]` for the whole run: no unified commit, no unit baselines,
  no rollback, no audit trail — "committing is the completion condition" (plans/0021,
  constitutional) is silently disabled;
- the person discovers this only when they look for the history that was never written.

The e2e side of this friction was already stabilized by T-127 (U-E1: fixture identity /
`GIT_CONFIG_GLOBAL` workaround, master/main expectation); this proposal closes the
production gap.

## 2. Proposal — one unit

In `init` only (amend/fix/run unchanged), when the target directory is not inside any
git work tree:

1. **`git init -b main`** (honor `init.defaultBranch` when the person set one) — run
   before the identity probe and before `ensureInitGitignore`, so the ignore set, the
   first unified commit, and every later gate see a real repository. The create is
   printed loudly ("initialized git repository (branch main) — the driver's record and
   rollback need it").
2. **Identity**, in resolution order:
   - a resolving global/`GIT_*` identity (judged exactly as `commitIdentityProblem`
     judges today, `git var` under `user.useConfigOnly`) → proceed, nothing written;
   - `--name <n>` / `--email <e>` given at init → written as **local** config in the new
     repository (never `--global`; the tool never edits the person's global config);
   - neither → refuse with today's message (the in-repo behavior), extended with the
     new-flags hint. Explicit identity keeps history attributable; auto-writing the
     `opencode-auto@local` fallback identity is deliberately NOT done at init.
3. **Reconcile the existing fallback**: `identityArgs` in `src/git.ts` already commits
     under `opencode-auto@local` when a repository has no `user.email` (used for
     nested-repo commits). The two policies get one comment block each pointing at the
     other, stating the rule: init demands an explicit identity for the **target root**;
     the fallback covers only **nested repositories the person brought in**.

Scope notes: nested repositories are untouched (recursively committed first, as today);
the no-commit test double and the dryrun path are unaffected; the non-git production
tier effectively disappears (tests keep their seam), which is a conscious behavior-
contract change to record in the README's environment notes.

## 3. What is deliberately not included

- No `--no-git` escape hatch: a git-less production run is precisely the silently-broken
  state this closes; the person who truly wants no git can say so by not running the
  driver (or by a later ruling if field demand appears).
- No auto-detection of "the person deliberately avoids git" (undecidable; the loud print
  is the disclosure).

## 4. Risks

- `git init` in a directory the person did not expect is a state change — mitigated by
  printing it and by init's everything-before-first-write discipline (the bootstrap joins
  the pre-write check phase; a refusal later still leaves no config written, and an
  initialized empty repo is `rm -rf .git` away from undone).
- Default-branch mismatch with the person's convention (master vs main) — resolved by
  honoring `init.defaultBranch` first, `-b main` only as the fallback.

## 5. Rulings asked

1. Approve auto-init as the default in non-git directories (no escape hatch)?
2. Identity refusal when no global identity and no flags (recommended), or auto-write
   the local `opencode-auto@local` identity instead?
3. Branch fallback `main` (recommended) or leave git's default?
