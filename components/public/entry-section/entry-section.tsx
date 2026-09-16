import type { Section } from "@/lib/pod/schema";

/** A reserved-box `<img>`: real width/height set the aspect ratio so layout
 *  never shifts, and blurDataUrl paints until the real photo loads (spec §8). */
function Plate({ photo }: { photo: Section["photos"][number] }) {
  const style: React.CSSProperties = {};
  if (photo.width && photo.height) style.aspectRatio = `${photo.width} / ${photo.height}`;
  if (photo.blurDataUrl) style.backgroundImage = `url("${photo.blurDataUrl}")`;
  return (
    <div className="plate" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element --
          PERMANENT: next/image cannot serve a Pod URL. Remove only if that
          changes. See components/studio/entry-editor/fields/photo-fields. */}
      <img src={photo.contentUrl} alt={photo.caption?.value ?? ""} loading="lazy" />
    </div>
  );
}

/** A server component: no hooks, no events, nothing to hydrate. One photo
 *  bleeds to the column edge; two stack as a `.pair` inside the text column
 *  (spec §8). */
export function EntrySection({ section }: { section: Section }) {
  const photos = section.photos;
  const caption = photos[0]?.caption;
  return (
    <>
      {section.text && (
        <div className="wrap">
          <div className="entry-prose prose">
            {section.text.value.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}
      {photos.length === 1 && (
        <figure className="entry-figure entry-figure--bleed">
          <Plate photo={photos[0]} />
          {caption && <figcaption className="caption">{caption.value}</figcaption>}
        </figure>
      )}
      {photos.length === 2 && (
        <div className="wrap">
          <figure className="entry-figure">
            <div className="pair">
              <Plate photo={photos[0]} />
              <Plate photo={photos[1]} />
            </div>
            {caption && <figcaption className="caption">{caption.value}</figcaption>}
          </figure>
        </div>
      )}
    </>
  );
}
