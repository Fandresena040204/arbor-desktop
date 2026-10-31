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
- [x] Graphical cherry-pick: multi-commit selection and drag and drop already
  exist upstream. Cherry-picking from the graph will come with the interactive graph.
- [x] Worktrees: lock/unlock, prune stale worktrees, and show in file manager /
  open in shell / open in editor from the context menu (on top of upstream's
  list/add/rename/delete).

### Medium
- [x] Multiple remotes: Remotes tab in repository settings (add/rename/change URL/remove, fetch one or all, push to a chosen remote).
- [x] Integrated terminal: View > Toggle terminal (Ctrl+`), interactive shell in the repository folder.
  The shells run in the main process (node-pty needs worker threads, which
  renderers don't allow) and the panel drives them over IPC.
- [ ] Visual branch comparison: ahead/behind, commits and diff between any two branches.
  Git layer done (`lib/arbor/git/compare.ts`), UI to do.
- [ ] Full interactive rebase: editor with pick / reword / edit / squash / fixup /
  drop and drag-and-drop reordering. Git layer done
  (`lib/arbor/git/interactive-rebase.ts`), UI to do.

### Large
- [ ] Interactive Git graph (GitKraken style): branches, merges, create a branch
  or run an action from any commit. Engine done (`lib/arbor/graph/`), UI to do.
- [ ] Built-in 3-way conflict resolution tool. Engine done (`lib/arbor/conflicts/`), UI to do.
- [ ] GitLab support (gitlab.com and self-hosted): PAT/OAuth login for any URL,
  merge requests, CI pipeline status, issues. This requires a "hosting provider"
  abstraction around `app/src/lib/api.ts`.
