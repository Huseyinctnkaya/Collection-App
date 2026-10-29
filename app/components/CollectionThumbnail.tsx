import { Thumbnail } from "@shopify/polaris";
import { initial, pickColor } from "./collection-thumbnail.logic";

/**
 * Thumbnail for a collection row, with a real placeholder when there is no image.
 *
 * Passing an empty string to Polaris' Thumbnail renders `<img src="">`, which
 * browsers resolve against the current document — the result is a broken-image
 * icon and the alt text leaking into the table. Collections without an image
 * get a coloured initial instead, keyed off the handle so rows stay
 * distinguishable at a glance.
 */

const SIZE_PX = { small: 40, medium: 60 } as const;

export type ThumbnailSize = keyof typeof SIZE_PX;

export function CollectionThumbnail({
  image,
  title,
  handle,
  size = "small",
}: {
  image: { url: string; altText?: string | null } | null | undefined;
  title: string;
  handle: string;
  size?: ThumbnailSize;
}) {
  if (image?.url) {
    return <Thumbnail source={image.url} alt={image.altText ?? title} size={size} />;
  }

  const px = SIZE_PX[size];

  return (
    <div
      // The title sits next to this in every row, so announcing it again here
      // would only make the row noisier for screen readers.
      aria-hidden="true"
      style={{
        width: px,
        height: px,
        borderRadius: "var(--p-border-radius-200, 8px)",
        background: pickColor(handle || title),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(px * 0.42),
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "0.02em",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initial(title)}
    </div>
  );
}
