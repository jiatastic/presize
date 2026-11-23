// What a page needs from presize.json: the types and the srcset/<picture> helpers. Nothing
// here touches sharp or the file system, so `presize/manifest` is safe to load at runtime, in
// a server component or in the browser.

export type Format = "avif" | "webp";

export type Variant = {
  width: number;
  height: number;
  /** URL to put in srcset: `base` + `file`. */
  src: string;
  /** Path inside the out folder. */
  file: string;
  bytes: number;
  /** Encoder quality used. Absent on a kept original. */
  quality?: number;
  /** SSIMULACRA2 against the source resized to this width, when a `target` was set. */
  score?: number;
};

export type Entry = {
  width: number;
  height: number;
  bytes: number;
  /** Content hash of the source file. */
  hash: string;
  /** Base64 ThumbHash; decode with thumbHashToDataURL from the thumbhash package. */
  thumbhash: string;
  /** Smallest width first. */
  sources: Partial<Record<Format, Variant[]>>;
  /**
   * A copy of the source, made when re-encoding it at full size came out bigger (common for
   * small PNG logos). Serve it in place of the missing full-size variants.
   */
  original?: Variant;
};

export type Manifest = {
  version: 1;
  /** Hash of the settings that produced these files. A change re-encodes everything. */
  settings: string;
  images: Record<string, Entry>;
};

/** The pieces of a <picture>, for frameworks that build elements instead of HTML strings. */
export type PictureSources = {
  /** srcset for an AVIF <source>, or null when there shouldn't be one. */
  avif: string | null;
  /** srcset for the <img>: WebP plus the kept original, which every browser can show. */
  srcset: string;
  /** src for the <img>: the largest file browsers without srcset should load. */
  src: string;
};

/**
 * `srcset` for one format, ready for <source>. Pass no format for the <img>: WebP plus the
 * kept original, which every browser can show.
 */
export function srcset(entry: Entry, format?: Format) {
  const list = format
    ? (entry.sources[format] ?? [])
    : [...(entry.sources.webp ?? []), ...(entry.original ? [entry.original] : [])];
  return list.map((v) => `${v.src} ${v.width}w`).join(", ");
}

export function pictureSources(entry: Entry): PictureSources {
  const img = entry.original ?? entry.sources.webp?.at(-1) ?? entry.sources.avif?.at(-1);
  // An AVIF source without the full size would make 2x screens settle for a smaller file.
  const avif = entry.sources.avif?.length && !entry.original ? srcset(entry, "avif") : null;
  return { avif, srcset: srcset(entry) || srcset(entry, "avif"), src: img?.src ?? "" };
}

/** A <picture> as an HTML string: an AVIF <source>, and an <img> with WebP and the original. */
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
