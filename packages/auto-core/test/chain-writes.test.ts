// The chain-write ratchet (plans/0061 §4.8; rebuilt type-aware by plans/0234,
// finding 0165-195): SessionChain is mutable state with one home —
// src/chain-transitions.ts — and this suite holds every other src file to
// zero direct field writes, ever. A new chain state change belongs in a named
// transition there (with its field writes and rationale as documentation),
// never at a call site.
//
// What counts as a write (the census's claim): an assignment — `=` and every
// compound form, `||=`/`&&=`/`??=` included — a `++`/`--`, a `delete`, a
// member target inside a destructuring assignment or a for-in/for-of
// initializer, or an `Object.assign(<target>, …)`, whose target's member
// spine touches the SessionChain type at any depth. The census is type-aware
// (0234): it resolves each target's spine through the compiler's checker, so
// the binding's shape is irrelevant — annotated parameters and locals,
// optional bindings, aliases, inferred locals, type aliases, array elements,
// non-null assertions, bracket access and a newline before the dot all count
// (the ten escape shapes of 0165-195, pinned below). Object-literal
// construction of a chain is not a write, and neither are reads.
//
// The honest boundary (0234 D3, each edge empty by measurement): method-call
// mutation of a chain-held object field (`chain.baseline.revs.push(…)` —
// outside 0061 §4.8's assignment-and-delete claim, no instance in src/),
// wrapper annotations (`Partial<SessionChain>` and mapped variants — identity
// type matching does not flag them; none exist in src/), and spines whose
// types come from an unresolved import (src's chain bindings are all
// file-local through src/chain.ts's own graph). A measured instance of any
// edge reopens it.
//
// Family line (0234 D4): a ratchet whose subject carries dataflow (a mutable
// type flowing through bindings — this one) needs the checker; statement-
// shaped subjects (import specifiers) and prose-shaped ones (prompt copy)
// have no aliasing class to miss and stay regex-based.
import { describe, expect, test } from "bun:test"
import ts from "typescript"
import { readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")
const TRANSITIONS = "chain-transitions.ts"
const PROBE = "__chain_write_probe__.ts" // the pin's in-memory fixture, never a file on disk

// ---------------------------------------------------------------------------
// The census (one program; the probe module rides the same build)
// ---------------------------------------------------------------------------

function srcFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.ts$/.test(name)) files.push(p)
    }
  }
  walk(SRC)
  return files
}

// The pin's fixture: the ten escape shapes of 0165-195 plus the negatives.
// One write per f-line (3–13, the line break inside f7 deliberate), reads
// and construction in the neg-lines — the census must find exactly the ten.
const PROBE_TEXT = [
  'import type { SessionChain } from "./chain"',
  "declare function makeChain(): SessionChain",
  "function f1(chain: SessionChain) { chain.hinted ||= true } // ||= missed by the old alternation",
  "function f2(chain: SessionChain) { const c = chain; c.model = 'x' } // aliasing: a dataflow fact",
  "function f3(chain: SessionChain) { Object.assign(chain, { model: 'x' }) }",
  "function f4(chain: SessionChain) { chain['model'] = 'x' } // bracket access",
  "function f5(chain?: SessionChain) { if (chain) chain.model = 'x' } // optional binding",
  "function f6(chain: SessionChain | undefined) { chain!.model = 'x' } // non-null assertion",
  "function f7(chain: SessionChain) { chain",
  "  .model = 'x' } // newline before the dot",
  "const chain8 = makeChain(); function f8() { chain8.model = 'x' } // inferred local",
  "function f9(chains: SessionChain[]) { chains[0].model = 'x' } // array element",
  "type C = SessionChain; function f10(x: C) { x.model = 'x' } // type alias",
  "// negatives: reads and construction never count",
  "function neg1(chain: SessionChain) { return chain.model === 'x' || chain.pending !== undefined }",
  "function neg2(): SessionChain { return { pct: 100, used: 0, at: 0 } }",
  "function neg3(chain: SessionChain) { const m = chain.model; return m ?? '?' }",
].join("\n")

const rel = (p: string): string => relative(SRC, p).replaceAll("\\", "/")

type Write = { file: string; line: number; text: string }

function build(): { census: (want: (file: string) => boolean) => Write[]; chainType: ts.Type } {
  const rootFiles = srcFiles()
  const probePath = join(SRC, PROBE)
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  }
  const host = ts.createCompilerHost(options, /*setParentNodes*/ true)
  const readFile = host.readFile.bind(host)
  host.readFile = (f) => (f === probePath ? PROBE_TEXT : readFile(f))
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (f) => f === probePath || fileExists(f)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, v, o, s) => (f === probePath ? ts.createSourceFile(f, PROBE_TEXT, ts.ScriptTarget.ESNext, true) : getSourceFile(f, v, o, s))
  const program = ts.createProgram([...rootFiles, probePath], options, host)
  const checker = program.getTypeChecker()

  // The SessionChain type, resolved through the checker from src/chain.ts's
  // own alias declaration — the type itself is the anchor (0234 D1), so the
  // census cannot drift from the source of truth. Not found: loud, never a
  // vacuous pass.
  const chainFile = program.getSourceFile(join(SRC, "chain.ts"))
  if (!chainFile) throw new Error("src/chain.ts not in the census's program — the anchor moved; update the builder")
  let chainType: ts.Type | undefined
  const findAlias = (n: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === "SessionChain") chainType = checker.getTypeAtLocation(n.name)
    n.forEachChild(findAlias)
  }
  findAlias(chainFile)
  if (!chainType) throw new Error("src/chain.ts: `type SessionChain` not found — the census's anchor moved; update the builder")

  const isChain = (t: ts.Type): boolean => (t === chainType ? true : t.isUnion() ? t.types.some((x) => x === chainType) : false)
  // Does this expression's member spine touch SessionChain state at any
  // depth? Walks down property/element access (nested writes into chain-held
  // object fields count) and through assertions/casts/parenthesization; any
  // node whose type IS the chain type (a union constituent included) makes
  // the spine chain-typed — which is how aliasing, inferred locals, type
  // aliases, optional bindings and array elements resolve.
  const spineTouchesChain = (e: ts.Expression): boolean => {
    let node: ts.Expression = e
    for (;;) {
      if (isChain(checker.getTypeAtLocation(node))) return true
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) node = node.expression
      else if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression
      else return false
    }
  }
  const push = (n: ts.Node, sf: ts.SourceFile, writes: Write[]): void => {
    const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf))
    writes.push({ file: rel(sf.fileName), line: pos.line + 1, text: n.getText(sf).split("\n")[0]!.trim() })
  }
  const collectTargets = (e: ts.Expression, sf: ts.SourceFile, writes: Write[]): void => {
    const collect = (n: ts.Node): void => {
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && spineTouchesChain(n)) push(n, sf, writes)
      else n.forEachChild(collect) // destructuring patterns: every member target inside
    }
    collect(e)
  }
  const census = (want: (file: string) => boolean): Write[] => {
    // `=` and every compound assignment (`||=`, `&&=`, `??=` included) — the
    // enum's own assignment range (64–79 at typescript 5.8), so the full
    // operator set is held by the frozen markers, not a hand list.
    const isAssignment = (kind: ts.SyntaxKind): boolean => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
    const writes: Write[] = []
    const visit = (n: ts.Node, sf: ts.SourceFile): void => {
      if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken.kind)) collectTargets(n.left, sf, writes)
      else if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) collectTargets(n.operand, sf, writes)
      else if (ts.isDeleteExpression(n)) collectTargets(n.expression, sf, writes)
      else if (ts.isForInStatement(n) || ts.isForOfStatement(n)) {
        const init = n.initializer
        if (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init)) collectTargets(init, sf, writes)
      } else if (ts.isCallExpression(n) && n.expression.getText(sf) === "Object.assign" && n.arguments.length > 0 && spineTouchesChain(n.arguments[0]!)) push(n.arguments[0]!, sf, writes)
      n.forEachChild((c) => visit(c, sf))
    }
    const onDisk = new Set(rootFiles.map(rel))
    for (const sf of program.getSourceFiles()) {
      const r = rel(sf.fileName)
      if (!sf.fileName.startsWith(SRC + "/")) continue // program deps outside src are not the ratchet's subject
      if (r !== PROBE && !onDisk.has(r)) continue
      if (!want(r)) continue
      visit(sf, sf)
    }
    return writes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  }
  return { census, chainType }
}

const { census, chainType } = build()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chain-write ratchet", () => {
  test("no chain writes outside the transitions — the flat rule", () => {
    // One home for the chain's mutations: src/chain-transitions.ts. Any
    // direct field write anywhere else, in any shape, names its site below
    // and belongs in a named transition instead.
    const writes = census((file) => file !== TRANSITIONS && file !== PROBE)
    const sites = writes.map((w) => `src/${w.file}:${w.line}: ${w.text}`)
    expect(sites.join("\n")).toBe("")
    expect(writes.length).toBe(0)
  })

  test("the census sees the sanctioned writer (the anti-vacuous control)", () => {
    // Guards the flat rule against passing vacuously: the one sanctioned
    // writer must actually register writes (65 at 0234's adoption; the floor
    // moves only consciously). A census that silently scans nothing fails
    // here, not as a green flat rule.
    const inside = census((file) => file === TRANSITIONS)
    expect(inside.length).toBeGreaterThanOrEqual(20)
  })

  test("the SessionChain shape is still the census's anchor", () => {
    // The checker-resolved type itself replaces the old hand field-parser:
    // the anchor must be the real type with a sane number of fields, or the
    // census is scanning a shadow.
    const props = chainType.getProperties().map((s) => s.name)
    expect(props.length).toBeGreaterThanOrEqual(20)
    expect(props).toContain("model")
    expect(props).toContain("pending")
  })

  test("the ten escape shapes count, reads and construction never", () => {
    // The finding's own ten shapes (0165-195; the lead probe R4's cases,
    // asserted inverted): exactly one write per f1–f10 line, and none over
    // the negatives. This is the permanent fail-before pin — every shape the
    // old regex accepted silently must fail this suite today.
    const found = census((file) => file === PROBE)
    expect(found.map((w) => w.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 11, 12, 13])
    expect(found.every((w) => w.file === PROBE)).toBe(true)
    expect(found.length).toBe(10)
  })
})
