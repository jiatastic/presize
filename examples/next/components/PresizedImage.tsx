import { pictureSources } from "presize/manifest";
import { thumbHashToDataURL } from "thumbhash";
import { image } from "../lib/images";

type Props = {
  /** Source path relative to ./images. */
  name: string;
  alt: string;
  /** Same width as --display, e.g. "(max-width: 640px) 100vw, 400px". */
  sizes: string;
  /** For the image that is the largest thing on screen when the page opens. */
  priority?: boolean;
};

/** A server component: the manifest and thumbhash decoding stay on the server. */
export function PresizedImage({ name, alt, sizes, priority }: Props) {
  const e = image(name);
  const p = pictureSources(e);
  // The blurred preview sits behind the image while it loads. Drop it for transparent
  // images, where it would show through.
  const placeholder = thumbHashToDataURL(Buffer.from(e.thumbhash, "base64"));
  return (
    <picture>
      {p.avif && <source type="image/avif" srcSet={p.avif} sizes={sizes} />}
      <img
        src={p.src}
        srcSet={p.srcset}
        sizes={sizes}
        width={e.width}
        height={e.height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        style={{ backgroundImage: `url(${placeholder})`, backgroundSize: "cover", maxWidth: "100%", height: "auto" }}
      />
    </picture>
  );
}
