# Agent guidance

This repository is a research fork based on [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) at commit [`6337fc823ce20251c8de8085948165c81aaa701e`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e). Preserve that upstream credit when changing project attribution.

## Working defaults

- Use `.agents/skills/ponytail/SKILL.md` at **full** level for coding, fixes, refactors, reviews, and dependency choices. Keep the solution small and complete.
- Apply `.agents/skills/karpathy-guidelines/SKILL.md` for surgical, goal-driven changes. User instructions and this file's no-pause workflow govern over skill text that suggests waiting for approval or confirmation.
- Use `.agents/skills/tdd/SKILL.md` for red-green, one behavior seam at a time. Choose the narrowest observable public behavior seam from the task and existing interfaces; do not pause for a separate seam approval. Use `.agents/skills/pstack-tdd/SKILL.md` for focused bug regression work where a cheap executable reproduction exists.
- Read `context.md` before changes that depend on project vocabulary or architecture. Keep it accurate when code changes alter those concepts.

## Privacy before publication

- Keep secrets, employer names, work email addresses, internal usernames, hosts, VM addresses, project paths, integration identifiers and deployment logs outside this public checkout. Use synthetic examples and environment-variable references in tracked files, documentation, screenshots, commit messages and PRs. Store operational records privately outside the repository.
- For every commit you create here, use Git name `vjain419` and email `6880446+vjain419@users.noreply.github.com` for both author and committer. Never use a company/work email. Set identity with repository-local Git configuration; do not change global settings or copy identity from the host account.
- Before each commit, inspect `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT`. Both must match the public identity above; environment variables can override Git configuration. Correct any mismatch before committing. Preserve existing upstream authorship.
- Before every push or PR, review the staged/outgoing file changes and publication text for private information. Inspect author and committer names/emails and messages for every outgoing commit you created, including amendments, cherry-picks and merges; checking file contents alone is insufficient. Publish only after both content and metadata pass.
- If private information is found, stop publication and remove it from unpublished changes/commits. If already published, report the exposure privately and coordinate cleanup; never repeat the private value in a public issue or PR, and never claim that rewriting branch history removes cached commits, PR references or other clones.

## Model preferences

When model selection is available, use the root agent for project management, GPT-6.1 Sol high for engineering, GPT-6.1 Terra max for bounded connector work, and `gpt-6-luna` high for focused validation or documentation.

## Skills

See [`docs/skills.md`](docs/skills.md) for the local skill inventory, sources, pinned commits, and license notes.
