# Skills Directory

This directory contains reusable agent skills for common tasks in Junkdrawer.

## Overview

Skills are loaded by an agent when a task matches their description. Each skill defines a specialized workflow, prompts, and verification steps for a specific type of task.

## Skill List

| Skill | Purpose |
|---|---|
| `new-page-workflow.md` | Workflow for creating a new single-file HTML tool |
| `version-bump-workflow.md` | Workflow for safely incrementing version numbers in footer and JSON |

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