---
trigger: always_on
description: Follow the project rules in AGENTS.md, including when to use the graphify knowledge graph.
---

Read and follow `AGENTS.md` at the repo root. It is the single source of rules for this repo.

graphify, in short (full rules in `AGENTS.md`):
- Use `graphify query` / `path` / `explain` for repo exploration and other big reads, when
  `graphify-out/graph.json` exists. For targeted work on a known file, just open the file.
- Run `graphify update .` once, after all changes for the task are final, not after each edit.
