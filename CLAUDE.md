# steftzor.github.io — the public site and the signed-in app

One of three repos in this project. `tzortzoglou.eu` (public portfolio) and
`app.tzortzoglou.eu` (signed-in app) are both built from here by two Eleventy configs.
The API is a separate private repo; the knowledge base is a third.

## Load first

1. **The `portfolio` skill** (`/portfolio`) — the canonical knowledge base for this project:
   architecture, infrastructure, guardrails, verification recipes, working rules and the
   prioritised plan. It is user-level, so it loads from any of the three repos. Read
   `references/lessons.md` before dispatching an agent or declaring something done, and
   `references/verification.md` before claiming a change works.
2. **The graphify graph**, per the section below.

## Rules that hold even if the skill never loads

These are the ones where a miss is destructive or public.

1. **Never `git add -A`.** Stage by path, then read `git diff --cached --stat`.
2. **Run `/security-review` and wait for it before every `git push`.** No exceptions.
3. **No Claude attribution** in commit messages or PR descriptions. This repo's log is
   portfolio surface.
4. **Never commit `.claude/` here.** This repo is public. `.gitignore` covers `.claude` and has
   since 2026-09-09, so this is belt and braces rather than the only thing stopping it.
5. **Verify against the live URL after deploying**, not the local build. Pages takes 30-60s.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
