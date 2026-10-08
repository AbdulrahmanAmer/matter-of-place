import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { conciergeQuestions } from "../../domain/contracts";
import type { Property } from "../../domain/property";
import { track, type AnalyticsEvent } from "../../lib/analytics";
import { t } from "../../lib/strings";
import { services, type ConciergeAnswer } from "../../services";
import { TextButton } from "../site/text-link";

type Question = (typeof conciergeQuestions)[number];

type Entry = { id: number; question: Question; answer: ConciergeAnswer | null; failed: boolean };

const eventFor: Record<Question, AnalyticsEvent> = {
  "Is the property still available?": "property_inquiry",
  "Can I request a private showing?": "showing_request",
  "Are there similar properties nearby?": "similar_property_request",
  "Can you send the full details?": "property_inquiry",
};

/**
 * Ask Matter of Place: a private-concierge control, not a chatbot. Four
 * questions, answered by the concierge service from the dossier.
 */
export function AskMatterOfPlace({
  property,
  open,
  onOpenChange,
  onRequestShowing,
}: {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestShowing: () => void;
}) {
  const [log, setLog] = useState<Entry[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    setLog([]);
  }, [property.slug]);

  const openPanel = () => {
    onOpenChange(true);
    track("concierge_open", { slug: property.slug });
  };

  const settle = (id: number, patch: Partial<Entry>) =>
    setLog((entries) => entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  const ask = async (question: Question) => {
    const id = nextId.current++;
    track(eventFor[question], { slug: property.slug, via: "concierge" });
    setLog((entries) => [...entries, { id, question, answer: null, failed: false }]);
    try {
      const answer = await services.concierge.answer({ propertySlug: property.slug, question });
      settle(id, { answer });
    } catch {
      settle(id, { failed: true });
    }
  };

  if (!open) {
    return (
      <button type="button" className="concierge-toggle" onClick={openPanel}>
        ASK MATTER OF PLACE
      </button>
    );
  }

  return (
    <aside className="concierge-panel" aria-label="Ask Matter of Place" data-print="hide">
      <div className="concierge-head">
        <span className="eyebrow">ASK MATTER OF PLACE</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t.common.close}
          onClick={() => onOpenChange(false)}
        >
          <X size={18} />
        </button>
      </div>
      <p className="concierge-lede">Ask about this property.</p>
      <div className="concierge-log" aria-live="polite">
        {log.map((entry) => (
          <div key={entry.id}>
            <p className="concierge-q">{entry.question}</p>
            {entry.answer ? (
              <>
                <p className="concierge-a">{entry.answer.text}</p>
                {entry.answer.link && (
                  <Link
                    to="/property/$slug"
                    params={{ slug: entry.answer.link.slug }}
                    className="text-link"
                    onClick={() => onOpenChange(false)}
                  >
                    {entry.answer.link.title}
                  </Link>
                )}
                {entry.answer.action === "showing" && (
                  <TextButton onClick={onRequestShowing}>Request a showing</TextButton>
                )}
              </>
            ) : (
              <p className="concierge-a">{entry.failed ? t.forms.error : "One moment."}</p>
            )}
          </div>
        ))}
      </div>
      <div className="concierge-suggest">
        {conciergeQuestions.map((question) => (
          <button type="button" key={question} onClick={() => void ask(question)}>
            {question}
          </button>
        ))}
      </div>
    </aside>
  );
}
