# Agent guidance

This repository is a research fork based on [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype) at commit [`6337fc823ce20251c8de8085948165c81aaa701e`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/6337fc823ce20251c8de8085948165c81aaa701e). Preserve that upstream credit when changing project attribution.

## Working defaults

- Use `.agents/skills/ponytail/SKILL.md` at **full** level for coding, fixes, refactors, reviews, and dependency choices. Keep the solution small and complete.
- Apply `.agents/skills/karpathy-guidelines/SKILL.md` for surgical, goal-driven changes. User instructions and this file's no-pause workflow govern over skill text that suggests waiting for approval or confirmation.
- Use `.agents/skills/tdd/SKILL.md` for red-green, one behavior seam at a time. Choose the narrowest observable public behavior seam from the task and existing interfaces; do not pause for a separate seam approval. Use `.agents/skills/pstack-tdd/SKILL.md` for focused bug regression work where a cheap executable reproduction exists.
- Read `context.md` before changes that depend on project vocabulary or architecture. Keep it accurate when code changes alter those concepts.
- Keep secrets out of tracked files, logs, and docs. Use placeholders and secure retrieval instructions.

## Model preferences

When model selection is available, use the root agent for project management, GPT-6.1 Sol high for engineering, GPT-6.1 Terra max for bounded connector work, and GPT-6 Luna high for focused validation or documentation.

## Skills

See [`docs/skills.md`](docs/skills.md) for the local skill inventory, sources, pinned commits, and license notes.
