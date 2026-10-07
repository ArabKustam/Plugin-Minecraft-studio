# Git workflow

Git is part of production, not an afterthought.

1. **Before** a large task: `studio_git_status`. If the user has uncommitted work, don't mix it into studio commits — ask whether to commit it first or work around it.
2. **After each logical step**: `studio_git_checkpoint {message, paths}` — only the listed paths are staged, staged files are secret-scanned, Conventional Commit messages are enforced.

```
feat(textures): add reactor active states
feat(model): create reactor control panel
feat(audio): add reactor startup sequence
feat(plugin): integrate reactor state machine
test(reactor): add startup integration tests
docs(reactor): add operator guide
chore(studio): update asset registry
```

Commit `.minecraft-studio/` (registry, sources, memory, timelines, logs) together with the assets it describes — that is the production history. Never commit `.env`, `test-server/`, build outputs.

## Never without explicit user approval

`git push --force`, history rewrites (rebase/filter-repo/amend of pushed commits), `git reset --hard`, deleting branches/tags, pushing to a new remote, making a repository public, creating releases.

## GitHub

Use the official GitHub MCP server (`github/github-mcp-server`; remote `https://api.githubcopilot.com/mcp/`) or the `gh` CLI when available — don't build a custom GitHub client. Before any push/release: `studio_git_secret_scan` (the plugin's pre-push hook also blocks pushes with detected secrets).

- Repository: create only when the user asks; default private.
- Branches: `feature/<system>` for larger systems; PR with summary of Created/Changed/Validated + dashboard screenshots.
- Releases: tag `vX.Y.Z` (semver), changelog section, attach build artifacts (plugin jar, resource pack zip + SHA-1), checksums. Ask before publishing.
- CI: Actions should build, run tests and validate the pack; integration tests that need secrets must skip gracefully when the secret is absent.
