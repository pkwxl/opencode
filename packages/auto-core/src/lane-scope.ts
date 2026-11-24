// Repository-relative lane paths and effective task scopes, shared by the
// scheduler, the executor coordinator and dependency-park release notes.
import { taskDir } from "./docpaths"
import type { Task } from "./tasks"

// Path segments of a repository-relative path: separators normalized,
// empty and "." parts dropped, so `src/dma/`, `src\dma` and `./src/dma`
// read the same.
const segments = (path: string): string[] => path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".")

// Whether two repository-relative paths overlap: the shorter one's segments
// are a prefix of the other's (a directory contains every path inside it;
// equal paths overlap; an empty path is everything). The module's central
// path relationship — disjointness is the admission rule, containment the
// nested-root test and the park release note's re-merge surface (0096 D7).
export function pathsOverlap(a: string, b: string): boolean {
  const sa = segments(a)
  const sb = segments(b)
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] !== sb[i]) return false
  return true
}

// —— Doc lanes (plans/0099 D1): the admission predicates ——

// The doc-lane eligibility predicate (D1), pure over the declaration: a unit
// runs as a doc lane iff
//   1. `Touches:` is present and non-empty — absent/empty means "touches
//      everything" (G3's fail-safe) and is never eligible;
//   2. every entry lies under `docs/` of the outer repository
//      (repository-relative, so no nested-repo root is reachable by
//      construction — `docs/` never overlaps them, the same boundary the
//      contention itself draws);
//   3. the unit is whole-task: `Decompose: whole`, or the field absent.
//      `pipeline` units and split streams keep their existing tier ≥ 1
//      story; under doc-lane mode they run through the serial degrade (D9).
// An undeclared task simply never becomes a doc lane — the fail-safe
// directions of G3 are untouched.
export function docEligible(task: Pick<Task, "touches" | "decompose">): boolean {
  if (task.touches === undefined || task.touches.length === 0) return false
  if (task.decompose !== undefined && task.decompose !== "whole") return false
  return task.touches.every((path) => segments(path)[0] === "docs")
}

// The effective scope of a doc unit (D1): the declared `Touches` plus its
// own `docs/T-NNN/` directory, always — the task document, report, gaps,
// handoff.md and testhands live there whether or not the planner listed the
// directory (a task that declares only a shared document still writes its
// own report). Everything the design calls "its scope" — the commit scoping,
// the guards, the disjointness admission — means this set. The own directory
// is skipped only when a declaration already covers it (the directory
// itself, or a parent such as `docs/`) — a declaration that merely lies
// inside it does not cover the report and gaps the unit still writes there.
export function docScope(task: Pick<Task, "id" | "touches">): string[] {
  const own = `${taskDir(task.id)}/`
  const ownSegments = segments(own)
  const scope = [...(task.touches ?? [])]
  const covers = (entry: string): boolean => {
    const declared = segments(entry)
    return declared.length <= ownSegments.length && declared.every((part, i) => part === ownSegments[i])
  }
  if (!scope.some(covers)) scope.push(own)
  return scope
}

// D1's admission comparison over effective scopes: two doc units run side by
// side only when neither's effective scope reaches the other's — the raw
// `touches` comparison readyUnits makes would miss the task that declares
// only a shared document (its own `docs/T-NNN/` still belongs to its scope,
// so a sibling owning that directory must not run beside it). The doc loop's
// admission wrapper applies this; readyUnits itself keeps its raw comparison
// for the worktree lanes, never changed by this design.
export function scopesDisjoint(a: readonly string[], b: readonly string[]): boolean {
  return !a.some((path) => b.some((other) => pathsOverlap(path, other)))
}
