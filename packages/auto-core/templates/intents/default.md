# default

## quality

### decompose

3. Decomposition granularity criteria (measured against the task description — choose the granularity within the scope it defines, neither wider nor narrower):
   - One aspect per subtask: work of different natures (research, implementation, documentation, wiring) is not merged into a single item;
     the files/modules/interfaces/behaviours/scenarios named in the task description are the natural splitting reference;
{{#if fine}}   - Fine-grained mode: make one item per natural unit named in the task body (file, module, interface, behaviour, scenario) and
     prefer finer over coarser — the fork pipeline has removed the fixed cost of re-understanding between subtasks, so a fine item's marginal
     cost is low; order the fine items explicitly into an executable sequence, placing an item that depends on an earlier one after it;
{{/if}}   - Each item self-contained: executable from the item description alone plus this subtask's todo.md, the task-background digest
     context.md, the shared-context index shared.md and docs/, and including the way to verify it;
   - Each item declares its artifacts: documents state the file path, code states the module/file range;
   - Budget-oriented: each item should be completable by a single session with a smallish context (on the order of {{contextBudget}} tokens);

### self-check-subtask

check for yourself whether this subtask is genuinely complete

### self-check-whole

once the whole task is complete, check for yourself whether it is genuinely complete

## phase duties

### a analysis

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by problem/open question/subsystem/risk surface: each item answers one definite question (such as "what is the data flow of
     module X", "the list of differences for a certain API", "does a given risk exist");
   - Each item produces one standalone analysis document, written to its own file under docs/;
   - This phase produces analysis and conclusions only; modifying any implementation code is forbidden;

### d design

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by design concern: data model, API contract, module boundaries, error handling, migration strategy and the like each become an item;
   - Each item produces one design document, including the alternatives considered and why one was chosen;
   - A cross-concern consistency check (whether the design documents contradict each other) must be a standalone closing subtask;

### m migration implementation

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Vertical thin slices first: one callable path end to end per item; do not split by horizontal layer (all the schema first, then all the
     implementation);
   - Keep different aspects apart — schema/interfaces, implementation, wiring and documentation each become their own item;
   - Floor protection: the source tree stays consistent when an item completes — it compiles and existing tests do not regress; splitting out
     a fragment that leaves a broken intermediate state is forbidden;
   - Where there is a dependency order, arrange the items into an executable sequence (an item depending on an earlier one comes after it);

### t testing

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by test surface / scenario family: each item corresponds to one test file or to one family of closely related scenarios;
   - Keep writing tests apart from fixing defects: implementation defects that the tests expose are appended as separate fix items, not mixed
     into the test-writing item;
   - Test execution follows the test execution protocol (with --test-by-driver enabled, scripts are handed to the DRIVER to run);

### v acceptance

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by acceptance dimension (functional conformance, documentation completeness, environment and runtime, regression and the like),
     one item per dimension;
   - Each item produces one verification record (how it was verified, the evidence, the conclusion), written to its own file under docs/;
   - Verify and record only, do not fix anything (gaps go through the existing final-review loop);

### k knowledge extraction

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by knowledge artifact: pitfall lists, reusable patterns, README/handover documents and the like each become an item;
   - Each item produces one standalone document that later tasks can reference directly;

## acceptance

## governance

## artifact spec

### subtask-output

Artifact placement convention: if this item produces document/analysis/design content, write it into {{outputFile}} (a standalone file, title on the first line, not merged into another document); code artifacts go directly into the source tree.
