# Releases

Releases are Git tags with GitHub Release notes. There is no deployed
environment, so a release is the tagged source that others run with
`npm start`.

## Cut a release

1. In a pull request, bump `version` in `package.json` and
   `package-lock.json` (`npm version 0.2.0 --no-git-tag-version`) and merge it.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. `.github/workflows/release.yml` checks that the tag matches
   `package.json`, runs `npm run check` and `npm test`, and publishes the GitHub
   Release with notes generated from the merged pull requests. The notes are
   grouped by the `type: *` labels (`.github/release.yml`), so label every pull
   request.

## Undo a bad release

1. Revert the faulty change on `main` with a pull request (`git revert <sha>`).
2. Cut a new patch release from the fixed `main` as above.
3. Mark the bad release on GitHub: edit it and state which version replaces it.
   Do not delete or move a pushed tag; people may already run it.

To run an older release locally: `git switch --detach v0.1.0 && npm ci && npm start`.
