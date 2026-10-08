import { useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import {
  publishChecklist,
  type PropertyDetail,
  type PropertyPatch,
} from "../../domain/admin-properties";
import type { WatchedJob } from "../ui/JobWatcher";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/use-toast";
import { valuesOf } from "./editor-values";
import { FactsTab } from "./FactsTab";
import { NarrativeTab } from "./NarrativeTab";
import { PlacementTab } from "./PlacementTab";
import { PreviewTab } from "./PreviewTab";
import {
  useAgentPreview,
  useFeatures,
  usePublish,
  useRanks,
  useRelated,
  useRevokePreviews,
  useSavePatch,
  useUnpublish,
} from "./properties-queries";
import { PublishBar } from "./PublishBar";
import { RepresentationTab } from "./RepresentationTab";
import { SequenceTab } from "./SequenceTab";
import { StaleBanner } from "./StaleBanner";
import { UnpublishDialog } from "./UnpublishDialog";
import { useAutosave } from "./use-autosave";

const tabs = [
  { id: "narrative", label: "Narrative" },
  { id: "facts", label: "Facts" },
  { id: "sequence", label: "Sequence" },
  { id: "representation", label: "Representation" },
  { id: "placement", label: "Placement" },
  { id: "preview", label: "Preview" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const isTab = (id: string): id is TabId => tabs.some((tab) => tab.id === id);

/** The unsaved fields that are fields of the form; a state move is not one. */
function unsavedValues(
  unsaved: Partial<PropertyPatch>,
): Omit<Partial<PropertyPatch>, "editorial_state"> {
  const { editorial_state: _state, ...fields } = unsaved;
  return fields;
}

/**
 * The version to keep after a write that takes no version (unpublish, revoke): the answer when it is exactly one after
 * the version sent, else the version sent, so a save another session made in between still ends in a 409 here.
 */
const nextVersion = (sent: number, answered: number) => (answered === sent + 1 ? answered : sent);

/**
 * Screen 8, the dossier editor. Fields save through the serial queue of `useAutosave` (invariant 7, FE-01); every
 * other write waits for it (`flush`) and sends the version it resolves, so a publish carries the last edits.
 */
export function PropertyEditor({
  detail,
  onReload,
}: {
  detail: PropertyDetail;
  onReload: () => Promise<PropertyDetail>;
}) {
  const toast = useToast();
  const id = detail.property.id;
  const [values, setValues] = useState(() => valuesOf(detail.property));
  const [state, setState] = useState(detail.property.editorial_state);
  const [takenDown, setTakenDown] = useState(detail.property.taken_down_at !== null);
  const [unpublishing, setUnpublishing] = useState(false);
  const [tab, setTab] = useState<TabId>("narrative");
  const [jobs, setJobs] = useState<readonly WatchedJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const savePatch = useSavePatch(id);
  const publish = usePublish(id);
  const ranks = useRanks(id);
  const related = useRelated(id);
  const features = useFeatures(id);
  const unpublish = useUnpublish(id);
  const agentPreview = useAgentPreview(id);
  const revoke = useRevokePreviews(id);
  const autosave = useAutosave<PropertyPatch>({
    version: detail.property.version,
    save: (patch, version) => savePatch.mutateAsync({ patch, version }),
  });

  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: () =>
      autosave.flush().then(
        () => false,
        () => true,
      ),
  });

  const edit = (fields: Partial<PropertyPatch>) => {
    setValues((current) => Object.assign({}, current, unsavedValues(fields)));
    autosave.edit(fields);
  };

  /** Runs a write after the queue has drained, with the version it resolved; takes the version the write answers. */
  const afterFlush = async <Answer extends { version: number }>(
    write: (version: number) => Promise<Answer>,
  ): Promise<Answer | null> => {
    setBusy(true);
    try {
      const answer = await write(await autosave.flush());
      autosave.adopt(answer.version);
      return answer;
    } catch (failure) {
      toast({
        message: failure instanceof Error ? failure.message : "That did not go through.",
        tone: "danger",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const move = async (to: "draft" | "review") => {
    autosave.edit({ editorial_state: to });
    setBusy(true);
    try {
      await autosave.flush();
      setState(to);
    } catch (failure) {
      toast({
        message: failure instanceof Error ? failure.message : "That did not go through.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await onReload();
      setState(fresh.property.editorial_state);
      setValues(Object.assign(valuesOf(fresh.property), unsavedValues(autosave.unsaved)));
      autosave.adopt(fresh.property.version);
    } finally {
      setReloading(false);
    }
  };

  const checklist = publishChecklist(
    { ...values, hero_image: detail.property.hero_image },
    detail.media,
    values.representative_id === null ? null : { id: values.representative_id },
  );
  const factsReady = checklist.every((item) => item.id !== "facts" || item.passed);
  const heroReady = detail.property.hero_image !== null;

  const panel = {
    narrative: <NarrativeTab values={values} onEdit={edit} />,
    facts: (
      <FactsTab
        values={values}
        slugLocked={detail.property.first_published_at !== null}
        features={detail.features}
        onEdit={edit}
        onSaveFeatures={(list) => {
          void afterFlush((version) => features.mutateAsync({ features: list, version }));
        }}
      />
    ),
    sequence: <SequenceTab media={detail.media} />,
    representation: (
      <RepresentationTab
        propertyId={id}
        representative={detail.representative}
        presentedByOwner={values.presented_by_owner}
        onEdit={edit}
      />
    ),
    placement: (
      <PlacementTab
        property={detail.property}
        related={detail.related}
        onSaveRanks={(next) => {
          void afterFlush((version) => ranks.mutateAsync({ ...next, version }));
        }}
        onSaveRelated={(list) => {
          void afterFlush((version) => related.mutateAsync({ related: list, version }));
        }}
      />
    ),
    preview: <PreviewTab propertyId={id} ready={factsReady && heroReady} />,
  }[tab];

  const unsavedCount = Object.keys(autosave.unsaved).length;
  return (
    <div className="admin-editor">
      <div className="admin-editor__main">
        <h1>{values.title}</h1>
        {autosave.stale ? (
          <StaleBanner reloading={reloading} onReload={() => void reload()} />
        ) : null}
        {autosave.held ? (
          <div className="admin-banner" role="status">
            <p>Your unsaved edits are kept on the reloaded property.</p>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                void afterFlush((version) => Promise.resolve({ version }));
              }}
            >
              Save my edits
            </button>
          </div>
        ) : null}
        <p className="admin-editor__saved" aria-live="polite">
          {autosave.saving ? "Saving" : unsavedCount > 0 ? "Unsaved edits" : "Saved"}
        </p>
        <Tabs
          label="Property"
          tabs={tabs}
          active={tab}
          onChange={(next) => {
            if (isTab(next)) setTab(next);
          }}
        >
          {panel}
        </Tabs>
      </div>
      <PublishBar
        state={state}
        takenDown={takenDown}
        marketSlug={detail.property.market_slug}
        previewReady={factsReady && heroReady}
        checklist={checklist}
        pending={busy || autosave.stale}
        jobs={jobs}
        onMove={(to) => void move(to)}
        onPublish={() => {
          void afterFlush((version) => publish.mutateAsync(version)).then((answer) => {
            if (answer === null) return;
            setState("published");
            setJobs(answer.jobs);
          });
        }}
        onUnpublish={() => {
          setUnpublishing(true);
        }}
        onSendAgent={() =>
          afterFlush((version) => agentPreview.mutateAsync(version)).then((answer) => {
            if (answer !== null) setState("agent_review");
            return answer;
          })
        }
        onRevokePreviews={() =>
          afterFlush(async (version) => {
            const answer = await revoke.mutateAsync(undefined);
            return { version: nextVersion(version, answer.version) };
          }).then((answer) => answer !== null)
        }
      />
      <UnpublishDialog
        open={unpublishing}
        archived={state === "archived"}
        pending={busy}
        onCancel={() => {
          setUnpublishing(false);
        }}
        onConfirm={(body) => {
          void afterFlush(async (version) => {
            const answer = await unpublish.mutateAsync(body);
            return { ...answer, version: nextVersion(version, answer.version) };
          }).then((answer) => {
            if (answer === null) return;
            setUnpublishing(false);
            setState("archived");
            if (body.takedown) setTakenDown(true);
            setJobs(answer.jobs);
          });
        }}
      />
    </div>
  );
}
