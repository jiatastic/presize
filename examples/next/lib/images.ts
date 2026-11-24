import "server-only";
import type { Entry, Manifest } from "presize/manifest";
import data from "../public/img/presize.json";

const manifest = data as Manifest;

export function image(key: string): Entry {
  const entry = manifest.images[key];
  if (!entry) throw new Error(`No presized image for ${key}. Run pnpm images.`);
  return entry;
}
