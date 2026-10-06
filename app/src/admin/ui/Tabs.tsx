import { useId, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
}

/** A tab list with the arrow, Home and End keys; `children` is the panel of the active tab. */
export function Tabs({
  label,
  tabs,
  active,
  onChange,
  children,
}: {
  label: string;
  tabs: readonly TabItem[];
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const base = useId();

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const target = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    const next = target === undefined ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  };

  return (
    <div>
      <div className="admin-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="admin-tab"
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => {
              onChange(tab.id);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`}>
        {children}
      </div>
    </div>
  );
}
