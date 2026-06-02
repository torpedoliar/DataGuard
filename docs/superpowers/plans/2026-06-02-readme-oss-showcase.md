# README OSS Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current README with a polished OSS showcase README and add an MIT license file.

**Architecture:** Documentation-only change. `README.md` becomes the public GitHub landing page for DataGuard / DC-Check. `LICENSE` provides the MIT license text promised by the README.

**Tech Stack:** Markdown, GitHub README conventions, MIT license.

---

### Task 1: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README with OSS showcase content**

Use a GitHub-friendly structure: hero, badges, value proposition, features, architecture, quick start, production deploy, backup/restore, testing, contribution ideas, Codex for OSS fit, roadmap, license.

- [ ] **Step 2: Verify README facts**

Check commands and project facts against `package.json`, `.env.example`, `docker-compose.yml`, and source tree.

- [ ] **Step 3: Commit README changes**

```bash
rtk git add README.md
rtk git commit -m "docs: refresh README for OSS showcase"
```

### Task 2: Add MIT License

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Add MIT license text**

Use standard MIT text with copyright holder `torpedoliar` and year `2026`.

- [ ] **Step 2: Commit license**

```bash
rtk git add LICENSE
rtk git commit -m "chore: add MIT license"
```

### Task 3: Verify Documentation Package

**Files:**
- Read: `README.md`
- Read: `LICENSE`

- [ ] **Step 1: Run Markdown/fact checks**

```bash
rtk git diff --check
rtk git status -sb
```

- [ ] **Step 2: Push to main if requested**

```bash
rtk git push origin main
```
