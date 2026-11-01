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
| Logo | `branding/make-logo.py` generates every asset from one geometry: app icons (`.ico`, `.icns`, `.png`), the About dialog logos, the Windows installer splash, the macOS 26 `icon-logo.icon` layers and the SVG sources. The title bar uses the monochrome glyph (`app/src/ui/arbor/arbor-logo.tsx`). The welcome flow, About and app menus say Arbor. |
| Auto-update | Disabled. The official update server would replace Arbor with GitHub Desktop. Set `ARBOR_UPDATES_URL` at build time to enable a custom feed. |
| Windows identity | App User Model ID `com.squirrel.ArborDesktop.ArborDesktop` (also in dev builds, which used GitHub Desktop's and were grouped with it in the taskbar, with its icon); notifications use Arbor's shortcuts and toast activator CLSID. |
| Usage stats | Never sent: the app gives the stats store a no-op sender (GitHub's endpoints are GitHub Desktop's). The welcome flow and Preferences say so. |
| About | Without an update feed it says automatic updates are off and links to Arbor's releases, instead of an update error. |

Not changed yet: the `x-github-client` and `x-github-desktop-auth` URL protocols
(they are needed for GitHub OAuth login).

macOS 26 icon: `Assets.car` is compiled from `icon-logo.icon` by Xcode's
`actool`, which only runs on macOS. The stale GitHub one was removed, so macOS
uses the Arbor `.icns`. To get the Liquid Glass icon back, on macOS 26 run
`xcrun actool app/static/logos/prod/icon-logo.icon --compile app/static/logos/prod --app-icon icon-logo --platform macosx --minimum-deployment-target 26.0 --output-partial-info-plist /tmp/icon.plist`
(same for `dev`), and add `CFBundleIconName` = `icon-logo` back to
`script/info.plist`.

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
- [x] Visual branch comparison: Branch > Compare branches… (ahead/behind, commits on each side, changed files and diff).
- [x] Full interactive rebase: Branch > Interactive rebase… (pick/reword/edit/squash/fixup/drop, drag-and-drop reordering).

### Large
- [x] Interactive Git graph (GitKraken/GitLens style), merged into the Changes tab:
  WIP row, ref badges, avatars, branches panel, context menu actions.
- [x] Built-in 3-way merge tool: Resolve in merge tool… from the conflicted file menu.
- [x] GitLab support, part 1 (gitlab.com and self-hosted): Repository > GitLab…
  (Ctrl+Alt+L) detects the GitLab remote (nested groups, instances under a
  path), signs in with a personal access token kept in the OS credential
  store, creates a merge request for the current branch, lists open merge
  requests, shows the branch's latest pipeline and the issues.
- [x] GitLab support, part 2: sign in with the browser (OAuth 2 + PKCE, with an
  application registered on the instance and the redirect URI
  `http://127.0.0.1:47901/callback`; tokens refreshed automatically), the
  GitLab token given to Git so HTTPS push/pull just work, merge request
  reviews (details, approve / revoke approval, comments) and pipeline
  statuses on the graph's branch and tag tips.
