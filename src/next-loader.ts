// The next/image loader `withPresize` installs. It runs wherever next/image renders, the browser
// included, so it imports nothing: the image list arrives as the PRESIZE_NEXT env value, which
// Next inlines into the bundle at build time.

import type { LoaderData } from "./next.ts";

const data: LoaderData = JSON.parse(process.env.PRESIZE_NEXT || '{"base":"","prefix":"","images":{}}');

export default function presizeLoader({ src, width }: { src: string; width: number; quality?: number }) {
  let path = decode(src.split(/[?#]/)[0] ?? src);
  if (data.base && path.startsWith(`${data.base}/`)) path = path.slice(data.base.length);
  const entry = data.images[path];
  const [hash, ...widths] = entry ? entry.split(" ") : [];
  // The smallest copy at least as wide as asked for, else the widest there is.
  const pick = widths.find((w) => Number(w.replace("o", "")) >= width) ?? widths.at(-1);
  // No pick: not presized (SVGs, GIFs, remote URLs, static imports, images added since the
  // last build). "o": at that width the source is smaller than any WebP of it. Either way the
  // source loads as it is. In development the fragment keeps next/image from warning that the
  // loader ignores width; it never reaches the server.
  if (!pick || pick.startsWith("o")) {
    return process.env.NODE_ENV === "production" || src.includes("#") ? src : `${src}#w=${width}`;
  }
  const stem = path
    .replace(/\.[^./]+$/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${data.prefix}${stem}.${hash}.${pick}.webp`;
}

function decode(s: string) {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}
