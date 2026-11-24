# Changelog

This project follows [Semantic Versioning](https://semver.org). Until 1.0, minor versions may
change the manifest format or the CLI.

## 0.1.0 (2026-11-23)

First release.

- `presize <input> --out <dir>` writes AVIF and WebP at the widths you display (`--display`,
  `--widths`), and `presize.json` with srcset data and a ThumbHash placeholder per image.
- Incremental: unchanged images are skipped, and files only this tool wrote are removed when
  their image goes away.
- Keeps the original when re-encoding it at full size comes out bigger.
- `--target <score>` picks the lowest quality per image and width whose SSIMULACRA2 score
  reaches the target. On 155 email images it took 22–34% fewer AVIF bytes than the fixed
  quality that gets 95% of files to the same floor.
- SSIMULACRA2 in plain TypeScript, ported from the rust-av crate.
- `presize/manifest`: types and `srcset`, `picture` and `pictureSources` helpers, with no
  runtime imports.
- `presize/next`: `withPresize(nextConfig)` encodes `public/` during `next build` and sets
  `next/image` to serve the WebP copies, with no image optimizer at request time. Works with
  `output: "export"`, and keeps its output in `.next/cache` in CI.
