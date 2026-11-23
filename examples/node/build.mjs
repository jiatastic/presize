// Plain Node: make the files, then write HTML with picture().
// node build.mjs, from a folder with ./images and ./public.
import { writeFile } from "node:fs/promises";
import { picture, presize } from "presize";

const { manifest, made, kept, failed } = await presize({
  input: "images",
  out: "public/img", // served at /img, which becomes the src prefix
  display: 400,
  target: 80,
});
console.log(`${made} made, ${kept} unchanged`);
if (failed.length) {
  for (const f of failed) console.error(`${f.file}: ${f.error}`);
  process.exit(1);
}

const cards = Object.entries(manifest.images).map(
  ([key, entry]) => `<li>${picture(entry, { alt: key, sizes: "(max-width: 640px) 100vw, 400px" })}</li>`,
);
await writeFile("public/index.html", `<!doctype html>\n<ul>\n${cards.join("\n")}\n</ul>\n`);
