import type { LoaderData } from "./next.ts";

const data: LoaderData = JSON.parse(process.env.PRESIZE_NEXT || '{"base":"","prefix":"","images":{}}');

export default function presizeLoader({ src, width }: { src: string; width: number; quality?: number }) {
  let path = decode(src.split(/[?#]/)[0] ?? src);
  if (data.base && path.startsWith(`${data.base}/`)) path = path.slice(data.base.length);
  const entry = data.images[path];
  const [hash, ...widths] = entry ? entry.split(" ") : [];
  const pick = widths.find((w) => Number(w.replace("o", "")) >= width) ?? widths.at(-1);
  // The #w= fragment (dev only) stops next/image warning that the loader ignores width.
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
