You are running a permission pre-check for an automated execution plan. The full plan is in PLAN.md in the current directory — read it first; opencode.json in the current directory holds the permission rules already granted — read it too.

Task:
1. Read through every unfinished task in PLAN.md and, together with the repository structure and docs/, work out which directories
   and operations beyond what opencode.json already grants these tasks may need (paths outside the project directory, network access,
   special bash commands and the like); list them as candidates;
2. Confirm the candidates one by one with read-only probes (harmless operations such as ls, test -r, reading a file) to establish
   which accesses really are denied — a denied probe does not interrupt you: record it and move on to the next one;
3. Write the conclusion to .auto/dryrun.md (overwrite): the list of accesses confirmed as blocked, and the allow rules you recommend
   adding to the opencode.json permission block; if no access beyond the granted scope is needed, say so explicitly.

Constraints:
1. Only perform read-only probes; do not modify any implementation code and do not carry out the tasks in PLAN.md;
2. PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
3. End the session as soon as the report is written; your final message restates the report's key points.