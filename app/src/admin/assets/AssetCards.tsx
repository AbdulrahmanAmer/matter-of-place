import { useState } from "react";
import { z } from "zod";
import type { AdminAsset } from "../../domain/admin-assets";
import { assetKindLabels, assetStatusLabels } from "../../domain/assets";
import { RoleGate } from "../ui/RoleGate";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import {
  useApproveAsset,
  useEditCaption,
  useRejectAsset,
  useRerenderAssets,
} from "./assets-queries";
import { CaptionEditor } from "./CaptionEditor";
import { CarouselViewer } from "./CarouselViewer";
import { ReelPlayer } from "./ReelPlayer";
import { RejectDialog } from "./RejectDialog";

const statusTone: Record<AdminAsset["status"], Tone> = {
  pending: "warning",
  approved: "ok",
  rejected: "danger",
  published: "info",
};

const slideAlts = z.array(z.string());
const emailMeta = z.object({
  subject: z.string().optional(),
  preheader: z.string().optional(),
  block: z
    .object({
      title: z.string().optional(),
      deck: z.string().optional(),
      image_url: z.string().optional(),
    })
    .optional(),
});

/** What a card draws for the asset: the picture or film of its kind, or the text of a newsletter piece. */
function Preview({ asset }: { asset: AdminAsset }) {
  if (asset.kind === "reel") return <ReelPlayer asset={asset} />;
  if (asset.kind === "carousel") {
    const alts = slideAlts.safeParse(asset.meta["slide_alts"]);
    return <CarouselViewer files={asset.files} alts={alts.success ? alts.data : []} />;
  }
  if (asset.kind === "newsletter_block" || asset.kind === "standalone_email") {
    const email = emailMeta.safeParse(asset.meta);
    const { subject, preheader, block } = email.success ? email.data : {};
    return (
      <div className="admin-asset__text">
        {block?.image_url === undefined ? null : <img src={block.image_url} alt="" />}
        {subject === undefined ? null : <p>{subject}</p>}
        {preheader === undefined ? null : <p>{preheader}</p>}
        {block?.title === undefined ? null : <h3>{block.title}</h3>}
        {block?.deck === undefined ? null : <p>{block.deck}</p>}
        {subject === undefined && block === undefined ? <p>Not built yet.</p> : null}
      </div>
    );
  }
  const main = asset.files.find((file) => file.role === "main");
  if (main === undefined) return <p className="admin-asset__empty">Not rendered yet.</p>;
  return (
    <img
      className="admin-asset__image"
      src={main.url}
      width={main.w}
      height={main.h}
      alt={asset.alt_text ?? `${assetKindLabels[asset.kind]}, revision ${String(asset.revision)}`}
    />
  );
}

type Open = { dialog: "reject" | "caption"; asset: AdminAsset } | null;

/** The pending, approved and rejected creative of the properties, one card each, with the moves open to the actor. */
export function AssetCards({ items }: { items: readonly AdminAsset[] }) {
  const toast = useToast();
  const approve = useApproveAsset();
  const reject = useRejectAsset();
  const rerender = useRerenderAssets();
  const caption = useEditCaption();
  const [open, setOpen] = useState<Open>(null);
  const busy = approve.isPending || reject.isPending || rerender.isPending;

  const fail = (error: Error) => {
    toast({ message: error.message, tone: "danger" });
  };

  return (
    <>
      <ul className="admin-assets">
        {items.map((asset) => {
          const label = `${assetKindLabels[asset.kind]}, revision ${String(asset.revision)}`;
          return (
            <li key={asset.id}>
              <article className="admin-asset" aria-label={label}>
                <header className="admin-asset__head">
                  <h2>{assetKindLabels[asset.kind]}</h2>
                  <StatusPill
                    label={assetStatusLabels[asset.status]}
                    tone={statusTone[asset.status]}
                  />
                  <span className="admin-asset__meta">
                    Revision {asset.revision}, <LocalTime value={asset.created_at} />
                  </span>
                </header>
                <Preview asset={asset} />
                {asset.caption !== null ? <p className="admin-prose">{asset.caption}</p> : null}
                {asset.caption === null && asset.captions_waiting ? (
                  <p className="admin-asset__note">Waiting for the caption runner.</p>
                ) : null}
                {asset.caption === null && !asset.captions_waiting ? (
                  <p className="admin-asset__note">No caption yet.</p>
                ) : null}
                {asset.meta["caption_lint"] === "failed" ? (
                  <p className="admin-asset__note">
                    The caption broke a house voice rule. Edit it before approving.
                  </p>
                ) : null}
                {asset.render_error === null ? null : (
                  <p className="admin-asset__error" role="alert">
                    {asset.render_error}
                  </p>
                )}
                {asset.rejection_note === null ? null : (
                  <p className="admin-asset__note">Rejected: {asset.rejection_note}</p>
                )}
                <div className="admin-actions">
                  {asset.status === "pending" ? (
                    <RoleGate action="assets.approve">
                      <button
                        type="button"
                        className="admin-button"
                        disabled={busy}
                        onClick={() => {
                          approve.mutate(asset.id, {
                            onSuccess: () => {
                              toast({ message: `${label} approved.` });
                            },
                            onError: fail,
                          });
                        }}
                      >
                        Approve
                      </button>
                    </RoleGate>
                  ) : null}
                  {asset.status === "pending" || asset.status === "approved" ? (
                    <RoleGate action="assets.reject">
                      <button
                        type="button"
                        className="admin-button admin-button--quiet"
                        disabled={busy}
                        onClick={() => {
                          setOpen({ dialog: "reject", asset });
                        }}
                      >
                        Reject
                      </button>
                    </RoleGate>
                  ) : null}
                  {asset.status === "published" ? null : (
                    <RoleGate action="assets.re_render">
                      <button
                        type="button"
                        className="admin-button admin-button--quiet"
                        disabled={busy}
                        onClick={() => {
                          rerender.mutate([asset.id], {
                            onSuccess: () => {
                              toast({ message: `${label} sent to render again.` });
                            },
                            onError: fail,
                          });
                        }}
                      >
                        Re-render
                      </button>
                    </RoleGate>
                  )}
                  {asset.status === "pending" || asset.status === "approved" ? (
                    <RoleGate action="assets.caption">
                      <button
                        type="button"
                        className="admin-button admin-button--quiet"
                        onClick={() => {
                          caption.reset();
                          setOpen({ dialog: "caption", asset });
                        }}
                      >
                        Edit caption
                      </button>
                    </RoleGate>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      <RejectDialog
        open={open?.dialog === "reject"}
        title={
          open === null
            ? "Reject"
            : `Reject ${assetKindLabels[open.asset.kind].toLowerCase()}, revision ${String(open.asset.revision)}`
        }
        pending={reject.isPending}
        onReject={(note) => {
          if (open === null) return;
          reject.mutate(
            { id: open.asset.id, note },
            {
              onSuccess: () => {
                setOpen(null);
                toast({ message: "Rejected." });
              },
              onError: fail,
            },
          );
        }}
        onCancel={() => {
          setOpen(null);
        }}
      />
      {open?.dialog === "caption" ? (
        <CaptionEditor
          asset={open.asset}
          open
          pending={caption.isPending}
          error={caption.error?.message ?? null}
          onSave={(edit) => {
            caption.mutate(
              { id: open.asset.id, ...edit },
              {
                onSuccess: () => {
                  setOpen(null);
                  toast({ message: "Caption saved." });
                },
              },
            );
          }}
          onCancel={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}
