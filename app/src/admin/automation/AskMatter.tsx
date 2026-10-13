import { useState } from "react";
import { usePostMessage } from "../workforce/workforce-queries";
import { RoleGate } from "../ui/RoleGate";
import type { RecipeRow } from "./automation-queries";

/**
 * Gap audit item 31 (operator, 2026-10-12: "I write what that node does and matter creates it"): a change to this flow
 * in plain words. It goes to Matter's thread; Matter answers with the change as an admin call, which waits in Approvals
 * until a person approves it, and the runner makes it then.
 */
export function AskMatter({ recipe }: { recipe: Pick<RecipeRow, "name" | "trigger"> }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const post = usePostMessage("matter");
  const words = text.trim();
  return (
    <RoleGate action="workforce.post_message">
      <form
        className="admin-ask-matter"
        aria-label="Ask Matter to change this flow"
        onSubmit={(event) => {
          event.preventDefault();
          if (words === "") return;
          post.mutate(
            `@matter Please change the flow "${recipe.name}" (event ${recipe.trigger}): ${words} Propose it as an action for my approval.`,
            {
              onSuccess: () => {
                setText("");
                setSent(true);
              },
            },
          );
        }}
      >
        <h2>Ask Matter to change this flow</h2>
        <p className="admin-lead">
          Say what should happen, in your own words. Matter writes the change, it waits in Inbox,
          Approvals, and nothing changes until you approve it.
        </p>
        <label className="admin-visually-hidden" htmlFor="ask-matter-flow">
          The change, in your words
        </label>
        <textarea
          id="ask-matter-flow"
          rows={3}
          value={text}
          placeholder="After a request is accepted, also post a note to the team and wait a day before the email."
          onChange={(event) => {
            setText(event.target.value);
            setSent(false);
          }}
        />
        <div className="admin-actions">
          <button type="submit" className="admin-button" disabled={words === "" || post.isPending}>
            Ask Matter
          </button>
        </div>
        {sent ? (
          <p role="status">Sent. Matter's proposal appears in Approvals when it is ready.</p>
        ) : null}
        {post.isError ? <p role="alert">{post.error.message}</p> : null}
      </form>
    </RoleGate>
  );
}
