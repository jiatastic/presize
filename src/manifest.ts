export type Format = "avif" | "webp";

export type Variant = {
  width: number;
  height: number;
  src: string;
  file: string;
  bytes: number;
  quality?: number;
  score?: number;
};

export type Entry = {
  width: number;
  height: number;
  bytes: number;
  hash: string;
  /** Base64; decode with thumbHashToDataURL from the thumbhash package. */
  thumbhash: string;
  sources: Partial<Record<Format, Variant[]>>;
  /** The source itself, kept when re-encoding it at full size came out bigger. */
  original?: Variant;
};

export type Manifest = {
  version: 1;
  settings: string;
  images: Record<string, Entry>;
};

export type PictureSources = {
  avif: string | null;
  srcset: string;
  src: string;
};

export function srcset(entry: Entry, format?: Format) {
  if (format) return list(entry.sources[format] ?? []);
  const webp = entry.sources.webp ?? [];
  const original = entry.original && !webp.some((v) => v.width === entry.original?.width) ? [entry.original] : [];
  return list([...webp, ...original]);
}

function list(variants: Variant[]) {
  return variants.map((v) => `${v.src} ${v.width}w`).join(", ");
}

export function pictureSources(entry: Entry): PictureSources {
  const img = entry.original ?? entry.sources.webp?.at(-1) ?? entry.sources.avif?.at(-1);
  const avif = entry.sources.avif?.length && !entry.original ? srcset(entry, "avif") : null;
  return { avif, srcset: srcset(entry) || srcset(entry, "avif"), src: img?.src ?? "" };
}

export function picture(
  entry: Entry,
  attrs: { alt: string; sizes: string; loading?: "lazy" | "eager"; class?: string },
) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const p = pictureSources(entry);
  const sources = p.avif ? `<source type="image/avif" srcset="${esc(p.avif)}" sizes="${esc(attrs.sizes)}">` : "";
  return (
    `<picture>${sources}<img src="${esc(p.src)}" srcset="${esc(p.srcset)}" sizes="${esc(attrs.sizes)}"` +
    ` width="${entry.width}" height="${entry.height}" alt="${esc(attrs.alt)}" loading="${attrs.loading ?? "lazy"}" decoding="async"` +
    (attrs.class ? ` class="${esc(attrs.class)}"` : "") +
    `></picture>`
  );
}
