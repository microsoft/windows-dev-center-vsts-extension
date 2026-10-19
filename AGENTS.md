# Repository instructions

## Dependency restore

- Use the CLE_PublicPackages Azure Artifacts registry configured in `.npmrc`. The public npm registry is blocked on the Microsoft network; do not switch registries or disable TLS verification.
- Before restoring npm packages locally, run `.\Set-CLE_PublicPackagesNpmAuth.ps1` from the repository root. It requires Azure CLI and signs in if necessary, then writes a short-lived token to the user-level `.npmrc`, not the tracked repository configuration.
- If npm returns `E401`, rerun the script and retry. Never print or commit tokens or the contents of the user-level `.npmrc`.
- CI authenticates through the feed configuration steps in the pipeline; do not run interactive local authentication there.

## Build and dependency updates

- Use `npm ci` to restore the checked-in lockfile locally. It fails if `package-lock.json` does not match `package.json`.
- The root lockfile does not control shipped versions. `gulp package` copies only `package.json` into each V1 task build folder and runs `npm install --production`, which resolves the newest versions allowed by `package.json`. To control a shipped version, change its `package.json` range or add an npm `overrides` entry.
- Everything in `dependencies` ships in each V1 task's `node_modules`; add build and test tooling to `devDependencies`.
- Refresh one transitive dependency with `npm update <package> --package-lock-only`, then run `npm ci` and confirm the lockfile diff is limited to that package. Deleting both `package-lock.json` and `node_modules` resolves every package again and causes a broad upgrade.
- Run `npx tsc --noEmit` and relevant offline Jest tests after dependency changes. Existing API integration tests require real Partner Center credentials and must not be run against production with placeholder credentials.
- Run `npx gulp package` to build the VSIX (`--dev` or `--public` selects the extension variant). Windows PowerShell, Git, Azure CLI, and `tfx` must be available; the build also restores PowerShell modules and NuGet packages.
- Bump the patch version in affected `tasks\*\task.json` files and `vss-extension.json` when shipped content changes. The V3 Publish and Flight tasks are both generated from `tasks\store-publish-V3\task.json`.
