# presize

[![CI](https://github.com/jiatastic/presize/actions/workflows/ci.yml/badge.svg)](https://github.com/jiatastic/presize/actions/workflows/ci.yml)

Image optimization at build time instead of on request. Point it at a folder; it writes AVIF
and WebP at the widths you actually display, plus `presize.json` with `srcset` data and a
ThumbHash placeholder for every image. Serve the files from any static host or CDN. There's no
image server and no per-transformation bill.

> Status: early, unpublished. Both modes work: one fixed quality for every image, or
> `--target`, which picks each image's quality by a perceptual score. See
> [Benchmark](#benchmark) for what the search buys.

## Use

```bash
npx presize ./images --out ./public/img --display 270
```

`--display 270` means "shown 270 CSS pixels wide", so it makes 270w and 540w (1x and 2x).
Or give exact widths with `--widths 320,640`.

Run it again and only new or changed images are encoded. Files for images you removed or
re-encoded are deleted, but only files an earlier run wrote.

| Option | Default | |
|---|---|---|
| `--out <dir>` | required | where files and `presize.json` go |
| `--display <px>` | | CSS width shown at; outputs one width per `--dpr` |
| `--dpr <list>` | `1,2` | pixel ratios for `--display` |
| `--widths <list>` | `640,1280` | exact widths instead of `--display` |
| `--formats <list>` | `avif,webp` | |
| `--quality <list>` | `avif=50,webp=75` | fixed quality, when there's no `--target` |
| `--target <score>` | | SSIMULACRA2 score every file must reach; see below |
| `--base <url>` | inferred | URL prefix; `./public/img` becomes `/img` |
| `--concurrency <n>` | cores ÷ 4, ÷ 2 with `--target` | images encoded at once, each on a worker thread |

## What it decides for you

- **Never enlarges.** An image narrower than a width you asked for is served at its own size.
- **Keeps the original when it's smaller.** Small PNG logos often grow when re-encoded. Then
  the source is copied and served instead (`entry.original`).
- **Immutable names.** Files are named `name.<content-hash>.<width>.<format>`, so they can be
  cached forever.
- **Upright pixels.** EXIF orientation is applied before resizing; metadata is stripped.

## Quality by target

One quality number means different things for different images: AVIF q50 leaves a flat logo
pristine and smears a busy product photo. `--target 80` instead encodes each image, at each
width, at the lowest quality whose [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2)
score is at least 80. Rough scale: 90 is visually lossless at normal viewing distance, 80 is
very high quality, 70 high, 50 medium.

- The score compares against the source resized to that width, so it judges the encode, not
  the resize.
- The quality is found by bisection: about 7 encodes per file. Every candidate encodes the
  same resized pixels, and the next width starts from the last answer.
- Transparent images are scored over white and over black; the worse counts.
- Images under 8×8 can't be scored and use the fixed `--quality`.
- Each variant in the manifest records `quality` and `score`.

SSIMULACRA2 is implemented in plain TypeScript (`src/ssimulacra2.ts`), ported from the
rust-av crate. On the crate's reference pair it scores 17.39831 against the crate's
17.398505.

## Read the manifest

Import the helpers from `presize/manifest`. It has no runtime imports, so it doesn't load
sharp where your pages render.

```ts
import { readFile } from "node:fs/promises";
import { type Manifest, picture, pictureSources } from "presize/manifest";

const m: Manifest = JSON.parse(await readFile("public/img/presize.json", "utf8"));
const e = m.images["brand/hero.jpg"];

picture(e, { alt: "", sizes: "270px" }); // <picture> as an HTML string
pictureSources(e);                        // { avif, srcset, src } to build your own <picture>
e.thumbhash;                              // decode with thumbHashToDataURL from "thumbhash"
```

Keys are paths relative to the input folder, with `/` separators. The manifest lists every
image, so read it on the server or at build time, not in the browser.

[`examples/`](examples) has a Next.js server component, an Astro component and a plain Node
build script.

## Benchmark

155 email images (every 12th of a real library: product photos, banners, logos), at 640w,
AVIF effort 4, WebP effort 4. Reproduce with `bench/equal-quality.ts` and `bench/report.ts`.

A fixed quality gives scattered results. AVIF q50 scores 80.5 at the median, but 5% of files
fall below 67.9 and the worst is 46.7. To get 95% of files to a floor, a fixed setting has to
be high enough for the hard images, so it overspends on all the easy ones. Searching per
image sets the floor for every file and spends only what each one needs:

| Floor | Fixed quality that gets 95% of files there | Searched, every file there | |
|---|---|---|---|
| AVIF ≥ 70 | q60, 1682 KiB | 1110 KiB | −34% |
| AVIF ≥ 80 | q70, 2191 KiB | 1700 KiB | −22% |
| WebP ≥ 70 | q85, 2647 KiB | 1562 KiB | −41% |
| WebP ≥ 80 | q90, 3378 KiB | 2379 KiB | −30% |

At equal scores AVIF is 71–75% of the WebP bytes. WebP can't reach 90 on about half the
images even at q95.

The trade-off: the search brings easy images down to the floor, where a fixed setting would
have left them above it. If you care about the typical image rather than the worst, compare
by median instead. Searched AVIF ≥ 70 is 10% smaller than fixed q50, with a median score of
70.9 against 80.5.

Cost: about 7 encodes per file. That's 1.4 s per AVIF and 0.7 s per WebP at 640w on one core
of an M-series laptop, against about 0.1 s for a single encode. Unchanged images are skipped
on later runs.

## When not to use it

Images that arrive at runtime (user uploads, remote URLs) need an on-request optimizer such as
imgproxy or your CDN's image service. presize only handles images you have at build time.

## License

MIT. The SSIMULACRA2 port carries the BSD-2-Clause and MIT notices of the code it was ported
from; see [THIRD_PARTY.md](THIRD_PARTY.md). Encoding is done by [sharp](https://sharp.pixelplumbing.com) (Apache-2.0), which bundles
libvips (LGPL-3.0) as a separate prebuilt binary.
