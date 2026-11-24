import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";
import type { Entry, Format, Resolved, Variant } from "./index.ts";
import { type Encoded, encodeAt, reference, search } from "./quality.ts";

const WEB_SAFE = /\.(jpe?g|png|gif|webp)$/i;

export function widthsFor(source: number, wanted: number[]) {
  return [...new Set(wanted.map((w) => Math.min(w, source)))].sort((a, b) => a - b);
}

export async function encode(r: Resolved, key: string, buf: Buffer, h: string): Promise<Entry> {
  const source = () => sharp(buf, { failOn: "none" }).rotate();
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new Error("Can't read image size");
  const turned = (meta.orientation ?? 1) >= 5;
  const info = { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height };

  const entry: Entry = {
    width: info.width,
    height: info.height,
    bytes: buf.length,
    hash: h,
    thumbhash: await thumb(source()),
    sources: {},
  };

  const stem = key.replace(/\.[^./]+$/, "");
  const tag = h.slice(0, 8);
  const save = async (rel: string, data: Buffer) => {
    const dest = path.join(r.out, ...rel.split("/"));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  };
  const webSafe = WEB_SAFE.test(key);
  let keepOriginal = false;
  const hint: Partial<Record<Format, number>> = {};
  for (const width of widthsFor(info.width, r.widths)) {
    let img = source();
    if (width < info.width) img = img.resize({ width, kernel: "lanczos3" });
    const ref = await reference(img, r.target !== undefined);
    for (const format of r.formats) {
      let enc: Encoded;
      if (r.target !== undefined && ref.views.length) {
        enc = await search(ref, format, r.target, r.effort[format], hint[format]);
        hint[format] = enc.quality;
      } else {
        enc = await encodeAt(ref, format, r.quality[format], r.effort[format]);
      }
      if (webSafe && width === info.width && enc.data.length >= buf.length) {
        keepOriginal = true;
        continue;
      }
      const rel = `${stem}.${tag}.${width}.${format}`;
      await save(rel, enc.data);
      const v: Variant = {
        width: enc.width,
        height: enc.height,
        src: join(r.base, rel),
        file: rel,
        bytes: enc.data.length,
        quality: enc.quality,
      };
      if (enc.score !== undefined) v.score = Math.round(enc.score * 100) / 100;
      const list = entry.sources[format] ?? [];
      list.push(v);
      entry.sources[format] = list;
    }
  }
  if (keepOriginal) {
    const rel = `${stem}.${tag}${path.extname(key).toLowerCase()}`;
    await save(rel, buf);
    entry.original = { width: info.width, height: info.height, src: join(r.base, rel), file: rel, bytes: buf.length };
  }
  return entry;
}

async function thumb(img: ReturnType<typeof sharp>) {
  const { data, info } = await img
    .resize(100, 100, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString("base64");
}

export function join(base: string, rel: string) {
  return base ? `${base.replace(/\/$/, "")}/${rel}` : rel;
}
