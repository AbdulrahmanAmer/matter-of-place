import { useState } from "react";
import { formatNumber } from "../../lib/format";
import { captionLimits } from "../../domain/proposed-posts";
import { CarouselViewer } from "../assets/CarouselViewer";
import { fileName } from "../assets/file-name";
import { ReelPlayer } from "../assets/ReelPlayer";
import {
  proposedChannelLabels,
  proposedFormatLabels,
  type PostChannel,
  type PostFileView,
} from "./proposed-posts-labels";

/** What a person calls a file: the name it had where it came from (`original`), else the last part of its storage key. */
const nameOf = (file: PostFileView): string => fileName(file.original ?? file.key);

/** One picture. A file that cannot be loaded shows its name and a plain "file not found", never an empty frame. */
function PostImage({ file }: { file: PostFileView }) {
  const [lost, setLost] = useState(false);
  if (lost) {
    return (
      <p className="admin-asset__empty" role="alert">
        {nameOf(file)}: file not found.
      </p>
    );
  }
  return (
    <img
      className="admin-asset__image"
      src={file.url}
      width={file.w}
      height={file.h}
      alt={file.alt}
      onError={() => {
        setLost(true);
      }}
    />
  );
}

/** What the channel's picture, slides or film are: the carousel slide by slide, the single post, the reel in a player. */
function Media({ post }: { post: PostChannel }) {
  if (post.format === "reel") {
    if (post.reel === null) return <p className="admin-asset__empty">No film attached.</p>;
    const { video, poster } = post.reel;
    return (
      <ReelPlayer
        preload="metadata"
        asset={{
          files: [
            { role: "video", url: video.url, media_key: video.original ?? video.key },
            ...(poster === null
              ? []
              : [{ role: "poster", url: poster.url, media_key: poster.original ?? poster.key }]),
          ],
          meta: null,
        }}
      />
    );
  }
  if (post.images.length === 0) return <p className="admin-asset__empty">No picture attached.</p>;
  if (post.format === "carousel") {
    return (
      <CarouselViewer
        files={post.images.map((image, index) => ({
          role: "slide" as const,
          index,
          media_key: image.original ?? image.key,
          url: image.url,
          w: image.w,
          h: image.h,
          bytes: image.bytes,
        }))}
        alts={post.images.map((image) => image.alt)}
      />
    );
  }
  const [first] = post.images;
  return first === undefined ? null : <PostImage file={first} />;
}

/** The caption's length against what the channel takes, in words as well as colour. */
function CaptionCount({ post }: { post: PostChannel }) {
  const used = Array.from(post.caption).length;
  const limit = captionLimits[post.channel];
  const over = used > limit;
  return (
    <p className="admin-proposed__count" data-over={over ? "true" : "false"}>
      {formatNumber(used)} of {formatNumber(limit)} characters
      {over ? `, over by ${formatNumber(used - limit)}` : ""}
    </p>
  );
}

/**
 * One channel's post as it will look there: Instagram shows the picture and the caption under it; X and LinkedIn
 * show the words first and the picture below them.
 */
export function ChannelPreview({ post }: { post: PostChannel }) {
  const label = proposedChannelLabels[post.channel];
  const caption =
    post.caption === "" ? (
      <p className="admin-asset__note">No caption.</p>
    ) : (
      <p className="admin-prose">{post.caption}</p>
    );
  const captionFirst = post.channel !== "instagram";
  return (
    <section
      className="admin-proposed__channel"
      aria-label={`${label}, ${proposedFormatLabels[post.format].toLowerCase()}`}
    >
      <header className="admin-asset__head">
        <h3>{label}</h3>
        <span className="admin-asset__meta">{proposedFormatLabels[post.format]}</span>
      </header>
      {captionFirst ? caption : null}
      <Media post={post} />
      {captionFirst ? null : caption}
      <CaptionCount post={post} />
    </section>
  );
}
