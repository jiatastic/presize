# Examples

Each one runs presize before the site builds, then reads `presize.json` where pages render.
They read the manifest through `presize/manifest`, which has no runtime imports, so sharp
never loads when pages render.

| | |
|---|---|
| [`next/`](next) | Next.js App Router: a server component that renders `<picture>` |
| [`astro/`](astro) | Astro: a component, resolved at build time |
| [`node/`](node/build.mjs) | Plain Node: the programmatic API and the `picture()` HTML string |

## Run presize before the build

```json
{
  "scripts": {
    "images": "presize images --out public/img --display 400 --target 80",
    "build": "pnpm images && next build"
  }
}
```

`--display 400` is the CSS width the images are shown at; it makes 400w and 800w files. Use
the same width in `sizes`.

## Keep the output between builds

presize only skips images whose output is still in `--out`. A CI build that starts from a
clean checkout re-encodes everything, which with `--target` takes about a second per file.
Either commit the output folder (file names include a content hash, so files never change in
place), or cache it in CI. On Vercel, committing is the simple option.

## Keep the manifest on the server

`presize.json` lists every image and can be megabytes. Read it in server components, Astro
frontmatter or a build script, as these examples do, and pass only the entry a page needs to
the browser.
