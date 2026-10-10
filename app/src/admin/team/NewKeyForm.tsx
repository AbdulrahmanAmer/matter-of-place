import { useState } from "react";
import { agentScopes, type AgentScope } from "../../domain/admin-team";
import { appRoles, roleLabels } from "../../domain/contracts";
import type { AppRole } from "../../domain/rows";
import { Field } from "../ui/Field";

type AgentRole = Exclude<AppRole, "admin">;
const agentRoles = appRoles.filter((role): role is AgentRole => role !== "admin");

interface NewKeyInput {
  label: string;
  role: AgentRole;
  scopes: AgentScope[];
}

/**
 * A new agent account with its first key, or another key for an existing agent (`agents` lists them). The scopes are
 * the areas the key may work in; team and settings are never offered.
 */
export function NewKeyForm({
  agents,
  pending,
  onCreateAgent,
  onCreateKey,
}: {
  agents: readonly { id: string; name: string }[];
  pending: boolean;
  onCreateAgent: (input: NewKeyInput) => void;
  onCreateKey: (agentId: string, input: Omit<NewKeyInput, "role">) => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<AgentRole>("managing_editor");
  const [scopes, setScopes] = useState<readonly AgentScope[]>([]);
  return (
    <form
      className="admin-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        if (agentId === "") onCreateAgent({ label, role, scopes: [...scopes] });
        else onCreateKey(agentId, { label, scopes: [...scopes] });
      }}
    >
      <Field label="For">
        {(control) => (
          <select
            {...control}
            value={agentId}
            onChange={(event) => {
              setAgentId(event.target.value);
            }}
          >
            <option value="">A new agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={agentId === "" ? "Agent name" : "Key label"}>
        {(control) => (
          <input
            {...control}
            required
            maxLength={80}
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        )}
      </Field>
      {agentId === "" ? (
        <Field label="Role">
          {(control) => (
            <select
              {...control}
              value={role}
              onChange={(event) => {
                setRole(agentRoles.find((item) => item === event.target.value) ?? role);
              }}
            >
              {agentRoles.map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <fieldset>
        <legend>Areas</legend>
        {agentScopes.map((scope) => (
          <label key={scope}>
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) => {
                const on = event.target.checked;
                setScopes((current) =>
                  on ? [...current, scope] : current.filter((item) => item !== scope),
                );
              }}
            />
            {scope}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="admin-button" disabled={pending || scopes.length === 0}>
        {agentId === "" ? "Create agent and key" : "Issue key"}
      </button>
    </form>
  );
}
