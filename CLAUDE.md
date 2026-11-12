# CLAUDE.md

<!-- The Index bootstrap: keep this block at the top of the file -->
## Running memory: The Index
Before starting work, read `CLAUDE.md` in the `robh1985/The-Index` repository
(attach it with add_repo if it isn't in this session). It holds my standing
requests for every project, including this one. Follow its "Instructions for
every future session", and record any new standing request I give in both this
file and The Index.
<!-- end The Index bootstrap -->

## Global preferences

My global preferences, such as researching existing open-source projects before building, live
only in The Index's `CLAUDE.md`, under "Global preferences". Follow them from there. Don't copy
them into this file: keep only rules specific to this project here.

## Attaching repositories

`.claude/settings.json` runs `.claude/hooks/add-repo-gate.mjs` before any repository is attached
(`add_repo`): The Index (`robh1985/The-Index`) is attached without a prompt, and any other repository
asks first. Claude Code reads that file only in sessions started with this one repository.
