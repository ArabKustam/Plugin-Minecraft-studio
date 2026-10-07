# Releasing

Minecraft Studio uses semantic versioning. The plugin version lives in `.claude-plugin/plugin.json` and must match `runtime/package.json`; `validate-plugin` checks this. Supported Minecraft versions and provider integrations are tracked separately in [compatibility.md](compatibility.md).

1. Update `CHANGELOG.md` (move items from *Unreleased* into a new version section).
2. Bump the version in `.claude-plugin/plugin.json`, `runtime/package.json` and `runtime/src/mcp/common.js` (`VERSION`).
3. `cd runtime && npm run build`, then from the root:
   ```bash
   node --test "tests/**/*.test.mjs"
   node scripts/validate-plugin.mjs
   node scripts/third-party.mjs
   node runtime/dist/cli.mjs scan-secrets
   node scripts/package-plugin.mjs
   ```
4. Commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, and push the tag. **Maintainers only: publishing is a deliberate human action.**
5. The `Release` workflow rebuilds everything, verifies the tag against the manifest, and attaches these to a GitHub Release:
   - `minecraft-studio.plugin` and `minecraft-studio-X.Y.Z.plugin`
   - the Industrial Reactor jar and resource pack zip
   - `SHA256SUMS.txt`
   - release notes taken from the changelog

Users install releases from the marketplace (`/plugin marketplace add ArabKustam/Plugin-Minecraft-studio`) or by uploading the `.plugin` file.
