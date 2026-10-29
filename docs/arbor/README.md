# Arbor

Arbor is a fork of [GitHub Desktop](https://github.com/desktop/desktop) (MIT)
that adds GitLab support, including self-hosted instances, and advanced Git tools.

## Staying in sync with upstream

- Remotes: `origin` = this fork, `upstream` = `desktop/desktop`.
- The workflow `.github/workflows/arbor-upstream-sync.yml` merges
  `upstream/development` every Monday into a `sync/upstream-YYYY-MM-DD` branch and
  opens a PR. You can also start it from the Actions tab.
  - If upstream changes files under `.github/workflows/`, `GITHUB_TOKEN` cannot
    push them. In that case, add a `SYNC_TOKEN` secret (a PAT with the `repo` and
    `workflow` scopes) and use it in `actions/checkout`.
- Manual sync:

  ```sh
  git fetch upstream
  git merge upstream/development
  ```

### Rules for keeping conflicts small

1. Put new code in Arbor-specific folders: `app/src/lib/arbor/`,
   `app/src/ui/arbor/`, `app/styles/arbor/`.
2. Touch upstream files only at small hook points (an import, a menu entry,
   a call). Mark each one with an `// Arbor:` comment.
3. Do not reformat or move upstream code.
4. Put each feature behind a flag in `app/src/lib/arbor/feature-flags.ts`.

## Differences from GitHub Desktop

| Area | Change |
|---|---|
| Name / identifiers | `productName` Arbor, `bundleID` `dev.arbor.desktop`, Windows id `ArborDesktop`. It installs alongside GitHub Desktop. |
| Logo | `branding/make-logo.py` generates the icons (`.ico`, `.icns`, `.png`) and the SVG source. |
| Auto-update | Disabled. The official update server would replace Arbor with GitHub Desktop. Set `ARBOR_UPDATES_URL` at build time to enable a custom feed. |

Not changed yet: the `x-github-client` and `x-github-desktop-auth` URL protocols
(they are needed for GitHub OAuth login) and the macOS `.icon`/`Assets.car` assets.

## Roadmap (from small to large)

### Small
- [ ] Graphical cherry-pick: multi-commit selection, "Cherry-pick onto…" from
  the context menu (drag and drop already exists upstream).
- [ ] Worktrees: complete the UI (upstream already has `lib/git/worktree.ts` and
  basic support).

### Medium
- [ ] Multiple remotes: list/add/rename/remove remotes, fetch/push to a chosen remote.
- [ ] Integrated terminal: interactive shell (xterm.js + node-pty) in the repository folder.
- [ ] Visual branch comparison: ahead/behind, commits and diff between any two branches.
- [ ] Full interactive rebase: editor with pick / reword / edit / squash / fixup /
  drop and drag-and-drop reordering.

### Large
- [ ] Interactive Git graph (GitKraken style): branches, merges, create a branch
  or run an action from any commit.
- [ ] Built-in 3-way conflict resolution tool.
- [ ] GitLab support (gitlab.com and self-hosted): PAT/OAuth login for any URL,
  merge requests, CI pipeline status, issues. This requires a "hosting provider"
  abstraction around `app/src/lib/api.ts`.
