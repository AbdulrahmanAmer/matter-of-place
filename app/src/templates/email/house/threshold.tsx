import type { ReactNode } from "react";
import type { EmailBlock } from "../../../domain/email.ts";
import { ART } from "../art.ts";
import { Blocks, emphasised, opening, sections } from "../blocks.tsx";
import { Band, Row } from "../blocks/band.tsx";
import { Colophon } from "../blocks/colophon.tsx";
import { Picture } from "../blocks/picture.tsx";
import { Stage, type StageSpec } from "../blocks/stage.tsx";
import { Shell, type EmailProps } from "../layout.tsx";
import { cx, doorLine, ink, label, type Paper, sans, serif, SIDE } from "../style.ts";

// THRESHOLD, the house of the moments, when something has happened: a submission received, a home accepted, a door
// opened to Place Notes, a sign-in (operator, 2026-10-15). Cut like the film, on value: full-width shots that flip
// between dark and light, one statement per shot, type as the actor. It opens on the door: the GIF holds the emblem,
// dollies in, and the door opens onto light, while the row's opening passes through it, the first line entering above
// the door and the second leaving below. Labels pinned under the door say where this stands; the record shot carries
// the typeset stack of the steps and the row's letter; every later statement of the row cuts to the other paper; the
// colophon closes it on Bone.

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

interface ThresholdProps extends EmailProps {
  /** Pinned under the door, after a Sandstone square: what state this is in, in two or three words. */
  label?: string | undefined;
  /** Pinned under the door on the right: where (a city and a state, the markets followed). */
  place?: string | undefined;
  /** The record shot's stack of steps. */
  stage?: StageSpec | undefined;
  /** The template's own shots, after the row's (the welcome's latest piece and its three markets). */
  after?: ReactNode;
  /** Why this email came, in the colophon's small print. */
  note?: string | undefined;
  /** The unsubscribe address of a commercial email. */
  unsubscribe?: string | undefined;
}

function DoorLine({ text, delay }: { text: string; delay: string }) {
  return (
    <p className={cx(serif.className, "mop-t-door")} style={{ ...doorLine, color: ink.bone }}>
      <span className="mop-m">
        <span className={cx("mop-r", delay)}>{emphasised(text)}</span>
      </span>
    </p>
  );
}

function Pins({ status, place }: { status: string | undefined; place: string | undefined }) {
  const pin = { ...label, color: ink.sandstone } as const;
  return (
    <table {...table} width="100%">
      <tbody>
        <tr>
          <td
            className={cx(sans.className, "mop-k", "mop-d6")}
            style={{ ...pin, textAlign: "left", whiteSpace: "nowrap" }}
          >
            {status === undefined ? null : (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    backgroundColor: ink.sandstone,
                    verticalAlign: "1px",
                    marginRight: "9px",
                  }}
                />
                {status}
              </>
            )}
          </td>
          <td
            align="right"
            className={cx(sans.className, "mop-k", "mop-d6")}
            style={{ ...pin, textAlign: "right" }}
          >
            {place}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

interface Shot {
  paper: Paper;
  blocks: EmailBlock[];
  stage?: StageSpec | undefined;
}

/** The shots after the door: the record (with the stack), then one per statement, each on the other paper. */
function shots(rest: readonly EmailBlock[], stage: StageSpec | undefined): Shot[] {
  const [record = [], ...parts] = sections(rest);
  const all: Omit<Shot, "paper">[] = [
    ...(record.length > 0 || stage !== undefined ? [{ blocks: record, stage }] : []),
    ...parts.map((blocks) => ({ blocks })),
  ];
  return all.map((shot, index) => ({ ...shot, paper: index % 2 === 0 ? "light" : "dark" }));
}

export function Threshold({
  title,
  preheader,
  site,
  blocks,
  label: status,
  place,
  stage,
  after = null,
  note,
  unsubscribe,
}: ThresholdProps) {
  const { lines, rest } = opening(blocks);
  const entering = lines.length === 2 ? lines[0] : undefined;
  const leaving = lines.at(-1);
  return (
    <Shell title={title} preheader={preheader} site={site} page={ink.bone}>
      <table {...table} width="100%" style={{ width: "100%" }}>
        <tbody>
          <Band paper="dark">
            {entering === undefined ? (
              <Row padding="40px 0 0" bleed />
            ) : (
              <Row padding={`64px ${SIDE} 0`}>
                <DoorLine text={entering} delay="mop-d3" />
              </Row>
            )}
            <Row padding="6px 0 0" align="center" bleed>
              <Picture
                src={`${site.siteUrl}${ART.doorNight.path}`}
                art={ART.doorNight}
                alt="Matter of Place"
                paper={ink.obsidian}
                ink={ink.sandstone}
                bleed
              />
            </Row>
            {leaving === undefined ? null : (
              <Row padding={`4px ${SIDE} 0`} align={entering === undefined ? "left" : "right"}>
                <DoorLine text={leaving} delay="mop-d4" />
              </Row>
            )}
            <Row padding={`44px ${SIDE} 40px`}>
              <Pins status={status} place={place === "" ? undefined : place} />
            </Row>
          </Band>
          {shots(rest, stage).map((shot, index) => (
            <Band key={index} paper={shot.paper}>
              <Row padding={shot.paper === "dark" ? `84px ${SIDE} 60px` : `72px ${SIDE} 50px`}>
                {shot.stage === undefined ? null : <Stage {...shot.stage} />}
                <Blocks
                  blocks={shot.blocks}
                  house="threshold"
                  tone={shot.paper === "dark" ? "dark" : "light"}
                />
              </Row>
            </Band>
          ))}
          {after}
          <Band paper="bone">
            <Colophon site={site} align="left" note={note} unsubscribe={unsubscribe} />
          </Band>
        </tbody>
      </table>
    </Shell>
  );
}
