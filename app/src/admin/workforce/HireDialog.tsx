import { useState, type SyntheticEvent } from "react";
import { eventTypes } from "../../domain/events";
import {
  agentToolLabels,
  agentTools,
  wakeLabels,
  type AgentTool,
  type HireInput,
} from "../../domain/workforce";
import { Dialog } from "../ui/Dialog";
import { useHire } from "./workforce-queries";

// W1: hiring a colleague. The handle (`@slug`) comes from the first name; a person can also ask the chief of staff in
// the team chat, who uses the same path.

const handleOf = (name: string) =>
  (name.trim().split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

type EventType = (typeof eventTypes)[number];

export function HireDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hire = useHire();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState<HireInput["model"]>("sonnet");
  const [wake, setWake] = useState<EventType[]>([]);
  const [tools, setTools] = useState<AgentTool[]>(["read_business", "chat"]);
  const slug = handleOf(name);

  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    hire.mutate(
      { slug, name: name.trim(), role: role.trim(), instructions, model, wake_on: wake, tools },
      {
        onSuccess: () => {
          setName("");
          setRole("");
          setInstructions("");
          setWake([]);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} label="Hire a colleague" variant="drawer">
      <form className="wf-hire" onSubmit={submit} noValidate>
        <p className="admin-eyebrow">The team</p>
        <h2>Hire a colleague</h2>
        <p className="wf-hire__lede">
          They run on this laptop with your Claude account, wake on the moments you choose, and
          propose anything that leaves the company for a person to approve.
        </p>

        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
          <small>Their handle will be @{slug === "" ? "name" : slug}</small>
        </label>
        <label className="admin-field">
          <span>What they do</span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="Writes Place Notes"
            required
          />
        </label>
        <label className="admin-field">
          <span>How they work</span>
          <textarea
            rows={5}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Their brief, in plain words. The house voice applies to everyone: calm, brief, specific."
          />
        </label>
        <label className="admin-field">
          <span>Model</span>
          <select
            value={model}
            onChange={(event) =>
              setModel(
                event.target.value === "opus"
                  ? "opus"
                  : event.target.value === "haiku"
                    ? "haiku"
                    : "sonnet",
              )
            }
          >
            <option value="opus">Opus · judgment and writing</option>
            <option value="sonnet">Sonnet · everyday work</option>
            <option value="haiku">Haiku · quick reading</option>
          </select>
        </label>

        <fieldset className="wf-hire__set">
          <legend>Wakes when</legend>
          {eventTypes.map((type) => (
            <label key={type} className="wf-check">
              <input
                type="checkbox"
                checked={wake.includes(type)}
                onChange={() => setWake(toggle(wake, type))}
              />
              {wakeLabels[type]}
            </label>
          ))}
        </fieldset>
        <fieldset className="wf-hire__set">
          <legend>May</legend>
          {agentTools.map((tool) => (
            <label key={tool} className="wf-check">
              <input
                type="checkbox"
                checked={tools.includes(tool)}
                onChange={() => setTools(toggle(tools, tool))}
              />
              {agentToolLabels[tool]}
            </label>
          ))}
        </fieldset>

        {hire.isError ? (
          <p className="admin-field__error" role="alert">
            {hire.error.message}
          </p>
        ) : null}
        <div className="wf-hire__actions">
          <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="admin-button"
            disabled={hire.isPending || slug.length < 2 || name.trim() === "" || role.trim() === ""}
          >
            Hire
          </button>
        </div>
      </form>
    </Dialog>
  );
}
