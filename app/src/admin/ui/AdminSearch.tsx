import { useRouter } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { adminSearchKindLabels } from "../../domain/admin-search";
import { useAdminSearch } from "../dashboard/search-queries";

const SETTLE_MS = 250;

/**
 * The top bar's one search box (W3, admin pass): requests, people, properties, inquiries, invoices and stories as you
 * type, each group only when the person may open it. Enter opens the first hit, Escape closes the list, and with
 * nothing found Enter still searches the requests list as before.
 */
export function AdminSearch() {
  const router = useRouter();
  const listId = useId();
  const [text, setText] = useState("");
  const [settled, setSettled] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const search = useAdminSearch(settled);
  const groups = search.data?.groups ?? [];
  const first = groups[0]?.items[0];
  const shown = open && settled.trim().length >= 2;

  const go = (href: string) => {
    setOpen(false);
    setText("");
    void router.navigate({ href });
  };

  return (
    <form
      className="admin-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = text.trim();
        if (query === "") return;
        go(first?.href ?? `/admin/requests?search=${encodeURIComponent(query)}`);
      }}
    >
      <input
        type="search"
        name="search"
        aria-label="Search everything"
        aria-controls={listId}
        aria-expanded={shown}
        placeholder="Search requests, people, properties and more"
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          // A click on a result lands before the list closes.
          setTimeout(() => {
            setOpen(false);
          }, 150);
        }}
      />
      {shown ? (
        <div id={listId} className="admin-search__results" role="region" aria-label="Search results">
          {search.isFetching && groups.length === 0 ? (
            <p className="admin-search__note">Searching.</p>
          ) : null}
          {search.isError ? (
            <p className="admin-search__note">Search did not answer. Try again in a moment.</p>
          ) : null}
          {search.isSuccess && groups.length === 0 ? (
            <p className="admin-search__note">Nothing matches “{settled.trim()}”.</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.kind} aria-label={adminSearchKindLabels[group.kind]}>
              <h2 className="admin-eyebrow">{adminSearchKindLabels[group.kind]}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      onClick={(event) => {
                        event.preventDefault();
                        go(item.href);
                      }}
                    >
                      <span className="admin-search__title">{item.title}</span>
                      <span className="admin-search__detail">{item.detail}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </form>
  );
}
