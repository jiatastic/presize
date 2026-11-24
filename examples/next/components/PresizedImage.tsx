import { pictureSources } from "presize/manifest";
import { thumbHashToDataURL } from "thumbhash";
import { image } from "../lib/images";

type Props = {
  name: string;
  alt: string;
  sizes: string;
  priority?: boolean;
};

export function PresizedImage({ name, alt, sizes, priority }: Props) {
  const e = image(name);
  const p = pictureSources(e);
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
