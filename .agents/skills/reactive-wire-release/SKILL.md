---
name: reactive-wire-release
description: Prepare and ship a Reactive Wire Home Assistant add-on release. Use when creating a versioned release, changelog entry, release-preparation PR, GHCR image, or repository tag.
---

# Reactive Wire release

Use this skill to prepare a release safely. The normal release path is a **release-preparation PR**; merging it triggers the add-on image/tag workflow. Do not manually create a tag or publish an image unless the user explicitly asks to deviate from this repository workflow.

## Source of truth

Before acting, re-read these files because the automation is authoritative and may have changed:

- `.github/workflows/prepare-release.yml` — manually dispatched release-PR workflow.
- `.github/workflows/release-addon.yml` — main-branch image build and tag workflow.
- `scripts/prepare-release.ts` — exact metadata and changelog mutations.
- `scripts/extract-release-notes.ts` — annotated tag note extraction.
- `pixi.toml` and `docs/agents/verify-change.md` — required local gates.

Current behavior, verified from those sources:

1. **Prepare release PR** accepts a bare SemVer version and optional release-note bullets.
2. It runs `scripts/prepare-release.ts`, which updates exactly:
   - `package.json`
   - `package-lock.json`
   - `frontend/package.json`
   - `frontend/package-lock.json`
   - `pixi.toml`
   - `reactive_wire/config.yaml`
   - `reactive_wire/CHANGELOG.md`
3. It validates `pixi run --locked addon-build` and `pixi run --locked check`, then creates a PR named `release/v<version>`.
4. Once that PR merges to `main`, **Release add-on image** validates the root/add-on version match, reruns checks and add-on build, publishes multi-architecture (`linux/amd64`, `linux/arm64`) GHCR images tagged `<version>` and `latest`, then creates/pushes annotated Git tag `v<version>`.
5. The release workflow does **not** create a GitHub Release object. It only publishes the GHCR image and Git tag.

## Inputs and safety checks

Require explicit user confirmation of:

- target version, without a `v` prefix, for example `0.2.2`;
- release-note bullets; and
- whether to dispatch the remote preparation workflow or only prepare/review locally.

The accepted version grammar is:

```text
MAJOR.MINOR.PATCH[-PRERELEASE]
```

Do not use build metadata (`+...`), and do not reuse an existing tag. Check first:

```bash
git ls-remote --exit-code --tags origin "refs/tags/v<VERSION>"
```

An exit status of `0` means the tag already exists: stop and choose a new version. The release workflow also skips all release work when the tag exists.

Before changing release metadata:

```bash
jj git fetch --remote origin
jj status
git status --short --branch
```

Require a clean working copy and base the release on the current `main@origin`. Do not accidentally incorporate an unrelated release or local worktree change.

## Preferred path: dispatch the release-preparation workflow

This is the normal path because it uses the repository's own PR automation.

1. Confirm `main@origin` is current and all intended product changes are already on `main`.
2. Dispatch **Prepare release PR** from GitHub Actions with:
   - `version`: `<VERSION>`
   - `release_notes`: newline-separated factual bullets

   With authenticated GitHub CLI, the equivalent is:

   ```bash
   gh workflow run prepare-release.yml --ref main \
     -f version="<VERSION>" \
     -f release_notes=$'- First shipped change\n- Second shipped change'
   ```

   Prefer the GitHub UI if CLI authentication or shell quoting is uncertain.
3. Wait for the workflow-created PR `release/v<VERSION>`. Review its diff and checks before merging.
4. After merge, watch **Release add-on image** on `main`. It must complete successfully before the release is considered shipped.
5. Verify the result:

   ```bash
   git ls-remote --exit-code --tags origin "refs/tags/v<VERSION>"
   ```

   Also verify GHCR has both the version tag and `latest` if registry access is available.

## Local preparation/review path

Use this only when the user explicitly wants a local release-preparation commit or the GitHub workflow is unavailable. It prepares the same files; it does not publish a release.

1. Start from a clean, current `main` in a new JJ change.
2. Install dependencies through Pixi, never with bare `npm install` or `npm ci`:

   ```bash
   pixi run install-all
   ```

3. Run the canonical script, preserving multiline notes. In a POSIX shell:

   ```bash
   export RELEASE_NOTES=$'- First shipped change\n- Second shipped change'
   pixi run npm run release:prepare -- <VERSION>
   ```

   In PowerShell:

   ```powershell
   $env:RELEASE_NOTES = "- First shipped change`n- Second shipped change"
   pixi run npm run release:prepare -- <VERSION>
   ```

   The script normalizes missing `-` prefixes and inserts (or replaces) `## <VERSION> - <UTC-date>` at the top of `reactive_wire/CHANGELOG.md`.
4. Review the diff. Expect only the seven metadata/changelog files listed in **Source of truth**, unless dependency or source changes were intentionally included separately.

   ```bash
   git diff --check
   git diff --name-only
   ```

5. Run the same gates as CI/release preparation:

   ```bash
   pixi run addon-build
   pixi run check
   ```

   Run `pixi run e2e` as well when the release includes cross-cutting editor/server changes not already covered by a recent green E2E run.
6. Create one explicit preparation commit, for example:

   ```bash
   jj commit -m "Prepare release v<VERSION>"
   ```

   Open a review PR; do not directly push this metadata commit to `main` unless the user explicitly authorizes bypassing the normal PR workflow.

## PR review checklist

Before merging a release-preparation PR, confirm:

- all version fields match `<VERSION>`;
- `reactive_wire/CHANGELOG.md` has concise, user-facing bullets for `<VERSION>`;
- `reactive_wire/config.yaml` and root `package.json` match (the release workflow enforces this);
- `pixi run check` is green;
- `pixi run addon-build` is green;
- the prepare PR branch/diff contains no unintended source or lockfile churn;
- `v<VERSION>` does not already exist remotely.

## Post-merge release checklist

Do not say the release is complete merely because the preparation PR merged. Confirm:

1. **Release add-on image** passed on the merged `main` commit.
2. It built and pushed both `linux/amd64` and `linux/arm64` images.
3. The remote tag exists:

   ```bash
   git fetch --tags origin
   git rev-parse "v<VERSION>"
   ```

4. The annotated tag body came from the matching changelog section. `scripts/extract-release-notes.ts` falls back to generic text if the heading is missing, so a missing changelog entry is a release-quality failure even if the workflow technically succeeds.

## Recovery rules

- **Bad notes or metadata before merge:** rerun the preparation script/workflow for the same version; it replaces that version's existing changelog section rather than duplicating it. Re-run all validation.
- **Prepare workflow/check fails:** fix the release PR; do not manually tag around it.
- **Image build/push fails:** do not manually create `v<VERSION>`. Repair the issue, make a new qualifying `main` commit, and rerun/trigger the release workflow while the tag remains absent.
- **Tag already exists:** never reuse the version. Choose a new SemVer version and prepare a new PR.

## Report back

State separately:

- preparation PR URL/status;
- merged `main` commit;
- Release add-on image workflow status;
- remote tag (`v<VERSION>`) verification;
- GHCR image verification, if available; and
- any residual manual checks (for example, Home Assistant install smoke test).
