# GitHub workflow

## Developing DriftGuard

The development repository is public and uses `main` as its default branch. [DriftGuard on GitHub](https://github.com/deveshsinghal09/DriftGuard)

Use the configured `origin` and Git identity. Keep checkpoints small and useful on their own. Inspect the diff, run the relevant checks, stage only related files, use a descriptive Conventional Commit, and push without rewriting history. Use a feature branch and a reviewed pull request for risky changes.

```sh
gh auth status
gh repo view
git remote -v
npm ci
npm run build
npm run typecheck
npm test
git diff --check
git status --short --branch
```

After pushing, compare `git rev-parse HEAD` with the SHA from `git ls-remote --exit-code origin refs/heads/main`. For a feature branch, query `refs/heads/<branch>` instead. CI runs for pushes to `main` and for pull requests using a read-only repository token. The [CI workflow](../.github/workflows/ci.yml) defines the Node.js and operating system matrix.

Use GitHub CLI or GitHub's credential manager for authentication. Keep credentials, private user data, local databases, and `.env` files out of commits.

## Repositories operated on by DriftGuard

The application will verify the repository against an explicit allowlist and enforce human authorization before mutation. A task uses its own branch and controlled workspace. Publication requires authorization and verification evidence for the candidate commit. A human retains responsibility for merging and deploying.
