import { useState, type ReactNode } from "react";
import type { Step, StepSpecView } from "./automation-queries";
import { gateOf } from "./flow-gate";

// The recipe as a drawing (operator, 2026-10-12: "create automations by connecting nodes like n8n"): the event, then
// each step joined by a line in the order the runner plans them. A "+" on a line inserts a step there, a node is
// dragged to a new place, and a click opens its settings below. The runner plans steps in order with conditions on
// each (B8b), so the drawing is a chain: a branch it cannot run is never drawn.

/** A step's drawing, chosen by what its type does. */
function iconOf(type: string): ReactNode {
  if (/email|mail|notify/.test(type))
    return (
      <>
        <rect x="3" y="5" width="14" height="10" />
        <path d="m3 5.5 7 5.5 7-5.5" />
      </>
    );
  if (/post|meta|social|linkedin|x_|channel/.test(type))
    return (
      <>
        <circle cx="10" cy="10" r="1.5" />
        <path d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7M4 4a8.5 8.5 0 0 0 0 12M16 4a8.5 8.5 0 0 1 0 12" />
      </>
    );
  if (/render|cover|carousel|reel|story|image|video/.test(type))
    return (
      <>
        <rect x="3" y="4" width="14" height="12" />
        <path d="m3 13.5 4.5-4 3.5 3 2.5-2 3.5 3" />
      </>
    );
  if (/newsletter|digest|notes/.test(type))
    return (
      <>
        <path d="M3 8 10 3l7 5v9H3z" />
        <path d="m3 8 7 5 7-5" />
      </>
    );
  if (/purge|cache|index|sitemap|ping/.test(type))
    return (
      <>
        <path d="M4 10a6 6 0 0 1 10.5-4M16 10a6 6 0 0 1-10.5 4" />
        <path d="M14.5 2.5V6H11M5.5 17.5V14H9" />
      </>
    );
  if (/invoice|payment|stripe/.test(type))
    return (
      <>
        <path d="M5 3h10v14l-2-1.25-1.5 1.25L10 15.75 8.5 17 7 15.75 5 17z" />
        <path d="M7.5 7h5M7.5 10h5" />
      </>
    );
  return (
    <>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8" />
    </>
  );
}

function Glyph({ type }: { type: string }) {
  return (
    <svg
      className="admin-flow__glyph"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconOf(type)}
    </svg>
  );
}

/** The line between two nodes, with the "+" that inserts a step there. */
function Link({
  index,
  gate,
  dim,
  canEdit,
  specs,
  onInsert,
}: {
  index: number;
  gate: string | null;
  dim: boolean;
  canEdit: boolean;
  specs: readonly StepSpecView[];
  onInsert: (index: number, spec: StepSpecView) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="admin-flow__link" data-dim={dim ? "" : undefined}>
      <svg
        className="admin-flow__wire"
        viewBox="0 0 64 16"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 8H58" />
        <path d="m56 4 6 4-6 4" />
      </svg>
      {gate === null ? null : <span className="admin-flow__gate">{gate}</span>}
      {canEdit ? (
        <span className="admin-flow__insert">
          <button
            type="button"
            className="admin-flow__plus"
            aria-label={`Insert a step at ${String(index + 1)}`}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            +
          </button>
          {open ? (
            <ul className="admin-flow__palette" aria-label="Steps you can add">
              {specs.map((spec) => (
                <li key={spec.type}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onInsert(index, spec);
                    }}
                  >
                    <Glyph type={spec.type} />
                    <span>{spec.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

export function FlowCanvas({
  event,
  steps,
  specs,
  canEdit,
  selected,
  onSelect,
  onInsert,
  onMoveTo,
}: {
  event: string;
  steps: readonly Step[];
  specs: readonly StepSpecView[];
  canEdit: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onInsert: (index: number, spec: StepSpecView) => void;
  onMoveTo: (from: number, to: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const labelOf = (step: Step) =>
    specs.find((spec) => spec.type === step.step_type)?.label ?? step.step_type;

  return (
    <div className="admin-flow" role="group" aria-label="The recipe as a flow">
      <ol className="admin-flow__track">
        <li className="admin-flow__node admin-flow__node--event">
          <span className="admin-eyebrow">When</span>
          <strong>{event}</strong>
        </li>
        {steps.map((step, index) => (
          <FlowStep
            key={step.id}
            step={step}
            index={index}
            label={labelOf(step)}
            canEdit={canEdit}
            specs={specs}
            selected={selected === step.id}
            dragging={dragging}
            onDrag={setDragging}
            onSelect={onSelect}
            onInsert={onInsert}
            onMoveTo={onMoveTo}
          />
        ))}
        <Link
          index={steps.length}
          gate={null}
          dim={false}
          canEdit={canEdit}
          specs={specs}
          onInsert={onInsert}
        />
        <li className="admin-flow__node admin-flow__node--end">
          <span className="admin-eyebrow">Then</span>
          <strong>Done</strong>
        </li>
      </ol>
      {canEdit && steps.length > 1 ? (
        <p className="admin-field__hint">Drag a step onto another to put it there.</p>
      ) : null}
    </div>
  );
}

function FlowStep({
  step,
  index,
  label,
  canEdit,
  specs,
  selected,
  dragging,
  onDrag,
  onSelect,
  onInsert,
  onMoveTo,
}: {
  step: Step;
  index: number;
  label: string;
  canEdit: boolean;
  specs: readonly StepSpecView[];
  selected: boolean;
  dragging: number | null;
  onDrag: (index: number | null) => void;
  onSelect: (id: string) => void;
  onInsert: (index: number, spec: StepSpecView) => void;
  onMoveTo: (from: number, to: number) => void;
}) {
  return (
    <>
      <Link
        index={index}
        gate={gateOf(step.conditions)}
        dim={!step.enabled}
        canEdit={canEdit}
        specs={specs}
        onInsert={onInsert}
      />
      <li
        className="admin-flow__node"
        data-off={step.enabled ? undefined : ""}
        data-selected={selected ? "" : undefined}
        data-dragging={dragging === index ? "" : undefined}
        draggable={canEdit}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          onDrag(index);
        }}
        onDragEnd={() => {
          onDrag(null);
        }}
        onDragOver={(event) => {
          if (dragging !== null && dragging !== index) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragging !== null && dragging !== index) onMoveTo(dragging, index);
          onDrag(null);
        }}
      >
        <button
          type="button"
          className="admin-flow__open"
          aria-pressed={selected}
          onClick={() => {
            onSelect(step.id);
          }}
        >
          <span className="admin-flow__index">{index + 1}</span>
          <Glyph type={step.step_type} />
          <span className="admin-flow__label">{label}</span>
          <span className="admin-flow__marks">
            {step.requires_approval ? <span className="admin-flow__mark">Approval</span> : null}
            {step.enabled ? null : <span className="admin-flow__mark">Off</span>}
          </span>
        </button>
      </li>
    </>
  );
}
