# Skills Directory

This directory contains reusable agent skills for common tasks in Junkdrawer.

## Overview

Skills are loaded by an agent when a task matches their description. Each skill defines a specialized workflow, prompts, and verification steps for a specific type of task.

## Skill List

| Skill | Purpose |
|---|---|
| `new-page-workflow.md` | Workflow for creating a new single-file HTML tool |
| `version-bump-workflow.md` | Workflow for safely incrementing version numbers in footer and JSON |

## Auto-Discoverable Skills (`.agents/skills/`)

Agents that support the `SKILL.md` format auto-discover these project skills. The canonical location is `.agents/skills/` — the vendor-neutral Agent Skills path read by Codex, opencode, Cursor, Copilot, Gemini CLI, and others. `.claude/skills/` contains symlinks to each skill so Claude Code (which only scans `.claude/skills/`) discovers them too.

| Skill | Purpose |
|---|---|
| `.agents/skills/junkdrawer-new-page/` | Create and register a new single-file HTML tool (favicon, deploy footer, analytics, `junk-drawer.json`, commit/push) |
| `.agents/skills/junkdrawer-version-bump/` | Bump a page's `YYYY.MM.DD.N` version after edits; includes `scripts/bump-version.sh` which performs the whole bump |
| `.agents/skills/openrouter-model-selector/` | Reference implementation of the provider-grouped OpenRouter model selector required on OpenRouter pages |
| `.agents/skills/junkdrawer-compliance-audit/` | `scripts/audit.sh` checks footer/version sync, favicon, analytics rules, and JSON validity across all pages |
| `.agents/skills/junkdrawer-page-testing/` | Playwright testing pattern for these file:// single-file apps (matches `tests/ground-grid-growth.spec.js`) |
| `.agents/skills/frontend-design/` | (Third-party, Anthropic) High-design-quality frontend generation guidance |

## Adding New Skills

Add a new skill as a Markdown file with:

1. **Description header** — describes when this skill should be used
2. **Workflow** — step-by-step instructions for the agent
3. **Files involved** — which files the skill touches
4. **Verification** — how to confirm the skill completed correctly

## Conventions

- Skills are additive — they don't modify existing skills, they add new ones
- Each skill should be self-contained and executable by an agent
- Version format: `YYYY.MM.DD.N` matching `JUNKDRAWER_DEPLOY_FOOTER` pattern