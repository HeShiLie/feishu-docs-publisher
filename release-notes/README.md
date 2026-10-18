# Release notes

Each `<version>.md` file in this directory is used as the body of the matching GitHub release. The file name and its first heading must match the tag exactly, without a `v` prefix.

Keep the notes user-facing and grouped under `Added`, `Changed`, and `Fixed` as needed. Update [`CHANGELOG.md`](../CHANGELOG.md) at the same time; `npm run release:check` requires both entries before a release tag can be published.
