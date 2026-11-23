import "server-only";
import type { Entry, Manifest } from "presize/manifest";
// Imported, not read with fs, so the bundler ships it with the server code. "server-only"
// keeps it from ever reaching a client bundle.
import data from "../public/img/presize.json";

const manifest = data as Manifest;

/** The manifest entry for a source path relative to ./images, e.g. "brand/hero.jpg". */
export function image(key: string): Entry {
  const entry = manifest.images[key];
  if (!entry) throw new Error(`No presized image for ${key}. Run pnpm images.`);
  return entry;
}
