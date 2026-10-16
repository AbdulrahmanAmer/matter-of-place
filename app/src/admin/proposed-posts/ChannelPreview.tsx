import { useState } from "react";
import { formatNumber } from "../../lib/format";
import { CarouselViewer } from "../assets/CarouselViewer";
import { ReelPlayer } from "../assets/ReelPlayer";
import {
  captionLimits,
  proposedChannelLabels,
  proposedFormatLabels,
  type ChannelPost,
  type ProposedFile,
} from "./proposed-posts-contract";

/** One picture. A file that cannot be loaded shows its name and a plain "file not found", never an empty frame. */
function PostImage({ file }: { file: ProposedFile }) {
  const [lost, setLost] = useState(false);
  if (lost) {
    return (
      <p className="admin-asset__empty" role="alert">
        {file.name}: file not found.
      </p>
    );
  }
  return (
    <img
      className="admin-asset__image"
      src={file.url}
      {...(file.w === undefined ? {} : { width: file.w })}
      {...(file.h === undefined ? {} : { height: file.h })}
      alt={file.alt === "" ? file.name : file.alt}
      onError={() => {
        setLost(true);
      }}
    />
  );
}

/** What the channel's picture, slides or film are: the carousel slide by slide, the single post, the reel in a player. */
function Media({ post }: { post: ChannelPost }) {
  if (post.format === "reel") {
    if (post.reel === null) return <p className="admin-asset__empty">No film attached.</p>;
    const { video, poster } = post.reel;
    return (
      <ReelPlayer
        asset={{
          files: [
            { role: "video", url: video.url, media_key: video.name },
            ...(poster === null
              ? []
              : [{ role: "poster", url: poster.url, media_key: poster.name }]),
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
          media_key: image.name,
          url: image.url,
          w: image.w ?? 1080,
          h: image.h ?? 1350,
          bytes: image.bytes ?? 0,
        }))}
        alts={post.images.map((image) => (image.alt === "" ? image.name : image.alt))}
      />
    );
  }
  const [first] = post.images;
  return first === undefined ? null : <PostImage file={first} />;
}

/** The caption's length against what the channel takes, in words as well as colour. */
function CaptionCount({ post }: { post: ChannelPost }) {
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
export function ChannelPreview({ post }: { post: ChannelPost }) {
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
