You are running a permission pre-check for an automated execution plan. The plan is the current phase's task index (docs/R-NN/P<nn>-<type>/tasks.md, the highest round and the first phase whose directory still holds todo.md) with one task document docs/T-NNN/todo.md per task — read them first; opencode.json in the current directory holds the permission rules already granted — read it too.

Task:
1. Read through every unfinished task (a task directory still holding todo.md) and, together with the repository structure and docs/, work out which directories
   and operations beyond what opencode.json already grants these tasks may need (paths outside the project directory, network access,
   special bash commands and the like); list them as candidates;
2. Confirm the candidates one by one with read-only probes (harmless operations such as ls, test -r, reading a file) to establish
   which accesses really are denied — a denied probe does not interrupt you: record it and move on;
3. Write the conclusion to .auto/dryrun.md (overwrite): the list of accesses confirmed as blocked, and the allow rules you recommend
   adding to the opencode.json permission block; if no access beyond the granted scope is needed, say so explicitly.

Constraints:
1. Only perform read-only probes; do not modify any implementation code and do not carry out the planned tasks;
2. End the session as soon as the report is written; your final message is this run's printed highlights — the DRIVER takes it as the report's
   key points (the run asks for that one line, so it is not the closing summary the AGENTS.md constitution bans).
