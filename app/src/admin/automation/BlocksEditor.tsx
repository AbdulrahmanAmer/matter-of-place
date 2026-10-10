import { useState } from "react";
import type { EmailBlock } from "../../domain/email";
import { Field } from "../ui/Field";
import {
  blockLabels,
  blockTypes,
  maxBlocks,
  maxFactRows,
  newBlock,
  type BlockType,
} from "./template-draft";

type Facts = Extract<EmailBlock, { type: "facts" }>;

function FactRows({ block, onChange }: { block: Facts; onChange: (next: Facts) => void }) {
  const setRow = (index: number, row: Facts["rows"][number]) => {
    onChange({ ...block, rows: block.rows.map((current, at) => (at === index ? row : current)) });
  };
  return (
    <div className="admin-blocks__rows">
      {block.rows.map((row, index) => (
        <div key={index} className="admin-blocks__row">
          <Field label={`Label ${String(index + 1)}`}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.label}
                onChange={(event) => {
                  setRow(index, { ...row, label: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={`Value ${String(index + 1)}`}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.value}
                onChange={(event) => {
                  setRow(index, { ...row, value: event.target.value });
                }}
              />
            )}
          </Field>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            aria-label={`Remove row ${String(index + 1)}`}
            disabled={block.rows.length === 1}
            onClick={() => {
              onChange({ ...block, rows: block.rows.filter((_, at) => at !== index) });
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={block.rows.length >= maxFactRows}
        onClick={() => {
          onChange({ ...block, rows: [...block.rows, { label: "", value: "" }] });
        }}
      >
        Add row
      </button>
    </div>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (next: EmailBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="admin-blocks__fields">
          <Field label="Text">
            {(control) => (
              <input
                {...control}
                type="text"
                value={block.text}
                onChange={(event) => {
                  onChange({ ...block, text: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Level">
            {(control) => (
              <select
                {...control}
                value={String(block.level ?? 2)}
                onChange={(event) => {
                  onChange({ ...block, level: Number(event.target.value) });
                }}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            )}
          </Field>
        </div>
      );
    case "paragraph":
      return (
        <Field label="Text">
          {(control) => (
            <textarea
              {...control}
              rows={4}
              value={block.text}
              onChange={(event) => {
                onChange({ ...block, text: event.target.value });
              }}
            />
          )}
        </Field>
      );
    case "button":
      return (
        <div className="admin-blocks__fields">
          <Field label="Label">
            {(control) => (
              <input
                {...control}
                type="text"
                value={block.label}
                onChange={(event) => {
                  onChange({ ...block, label: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Link" hint="An https address, a mailto address or a variable.">
            {(control) => (
              <input
                {...control}
                type="text"
                value={block.url}
                onChange={(event) => {
                  onChange({ ...block, url: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
      );
    case "facts":
      return <FactRows block={block} onChange={onChange} />;
    case "signature":
      return (
        <Field label="Text" hint="Empty uses the standard signature.">
          {(control) => (
            <input
              {...control}
              type="text"
              value={block.text ?? ""}
              onChange={(event) => {
                onChange(
                  event.target.value === ""
                    ? { type: "signature" }
                    : { type: "signature", text: event.target.value },
                );
              }}
            />
          )}
        </Field>
      );
  }
}

/**
 * The blocks of one template in order: text, buttons and facts, with `{{variable}}` allowed in any text. A block
 * whose text comes out empty is left out of the email, so a note the admin did not write leaves no gap.
 */
export function BlocksEditor({
  blocks,
  errors,
  onChange,
}: {
  blocks: readonly EmailBlock[];
  /** The first message of each block, by index. */
  errors: Readonly<Record<number, string>>;
  onChange: (next: EmailBlock[]) => void;
}) {
  const [adding, setAdding] = useState<BlockType | "">("");

  const replace = (index: number, next: EmailBlock) => {
    onChange(blocks.map((block, at) => (at === index ? next : block)));
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    onChange(next);
  };

  return (
    <div className="admin-blocks">
      <ol className="admin-blocks__list" aria-label="Blocks">
        {blocks.map((block, index) => {
          const name = `${blockLabels[block.type]} ${String(index + 1)}`;
          const error = errors[index];
          return (
            <li key={index} className="admin-block" data-invalid={error !== undefined}>
              <div className="admin-block__head">
                <strong>{blockLabels[block.type]}</strong>
                <span className="admin-block__position">{index + 1}</span>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    disabled={index === 0}
                    aria-label={`Move ${name} up`}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    disabled={index === blocks.length - 1}
                    aria-label={`Move ${name} down`}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      onChange(blocks.filter((_, at) => at !== index));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <BlockFields
                block={block}
                onChange={(next) => {
                  replace(index, next);
                }}
              />
              {error === undefined ? null : (
                <p className="admin-field__error" role="alert">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="admin-blocks__add">
        <Field label="Add a block">
          {(control) => (
            <select
              {...control}
              value={adding}
              onChange={(event) => {
                const chosen = blockTypes.find((type) => type === event.target.value);
                setAdding(chosen ?? "");
              }}
            >
              <option value="">Choose a block</option>
              {blockTypes.map((type) => (
                <option key={type} value={type}>
                  {blockLabels[type]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={adding === "" || blocks.length >= maxBlocks}
          onClick={() => {
            if (adding === "") return;
            onChange([...blocks, newBlock(adding)]);
            setAdding("");
          }}
        >
          Add block
        </button>
      </div>
    </div>
  );
}
