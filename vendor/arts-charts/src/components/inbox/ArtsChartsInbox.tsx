// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * The inbox (spec §4, step 3b): a button with the server's unread count that
 * opens a panel of what the worker filed -- Rita's watch and schedule
 * replies and system notices, newest first. The host places it (a title bar,
 * a sidebar); it renders nothing when the host has no `chartsFetch`.
 *
 * - The list follows kind `inbox` on the shared `/charts/events` stream the
 *   cards use: an event, or a reconnect, means refetch (followFeed).
 * - It loads PAGE items, then older ones on a "Load older" button (a button,
 *   not an observer: keyboard- and screen-reader-reachable, and nothing loads
 *   unasked). A feed event refetches the list AS DEEP as it is loaded, in one
 *   request (`limit` = what is shown, at most MAX_PAGE): one consistent
 *   snapshot, so no gap or duplicate, and opening an old item -- which marks
 *   it read and fires an event -- does not collapse the list under the user.
 *   Deeper than MAX_PAGE it keeps paging by the cursor until the depth is
 *   covered again. Load older waits out a refetch (and a refetch outranks an
 *   older page still in flight), so the two can never overwrite each other.
 * - An item opens to its body (Rita's untrusted markdown), its snapshots and
 *   its actions; opening it marks it read. Snapshots load only for opened
 *   items, so an inbox of hundreds costs one list request.
 * - Open chart / Add to dashboard / Add as live chart go through the host's
 *   `openChart` / `addToDashboard` (the last with `{ live: true }`), each
 *   offered only when the host has it, after a `GET /charts/<id>` that turns
 *   a deleted chart into a note instead. Live is offered whatever the symbol:
 *   only the server knows live-grid's watchlist, and the card says so itself.
 * - `focusItem` (a link to one item, v12 part 2 C-3) opens the panel at that
 *   item -- expanded, marked read as opening it marks it, scrolled to and
 *   focused -- once per value: the host clears it (undefined) before the same
 *   link can act again. An item older than the loaded pages is fetched by id
 *   and shown first; one the server does not have is a note, and nothing else
 *   changes.
 */
import { useEffect, useId, useRef, useState } from "react";
import { configureArtsCharts, getHost, type ArtsChartsHost, type ChartsFetch } from "../../host";
import { Markdown } from "../../lib/markdown";
import {
  ChartServerError, deleteInboxItem, followFeed, getChart, listInbox, markInboxRead, snapshotDataUrl, type InboxItem, type InboxPage,
} from "../../lib/chartServer";
import { getInboxItem } from "../../lib/chartServer";

const KIND = { watch: "Watch", schedule: "Schedule", system: "Notice" } as const;
const UNREACHABLE = "Chart server unreachable: showing the last inbox this device saw.";
const NOT_KEPT = "That inbox item is no longer in the inbox.";

const KEPT_DAYS = 30;
/** The first page; the server's own ceiling is 200 (`limit=1..200`). */
const PAGE = 50;
const MAX_PAGE = 200;

const reason = (error: unknown) => (error instanceof ChartServerError ? error.message : "chart server unreachable");

function Snapshot({ f, url, n }: { f: ChartsFetch; url: string; n: number }) {
  // undefined: loading; null: purged; "": failed to load.
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    snapshotDataUrl(f, url).then((s) => { if (active) setSrc(s); }, () => { if (active) setSrc(""); });
    return () => { active = false; };
  }, [f, url]);
  if (src === undefined) return null;
  if (src === null) return <p className="arts-inbox-note">Snapshot {n} is no longer kept (snapshots are kept 30 days).</p>;
  if (src === "") return <p className="arts-inbox-note">Snapshot {n} did not load.</p>;
  return <img className="arts-inbox-snapshot" src={src} alt={`Snapshot of chart ${n}`} />;
}

function Entry({ f, item, onGone, focused, onFocused }: { f: ChartsFetch; item: InboxItem; onGone: (id: string) => void; focused: boolean; onFocused: () => void }) {
  const host = getHost();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bodyId = useId();
  const title = useRef<HTMLButtonElement | null>(null);

  const markRead = () => {
    if (item.read_at === null) void markInboxRead(f, item.id).catch(() => {}); // the feed's event refreshes the badge
  };
  const expand = () => {
    setOpen((was) => !was);
    markRead();
  };
  // A link's item: opened and read as a click would, then brought into view.
  // Keyed on `focused` alone, so a refetch never reopens an item the user closed.
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    markRead();
    title.current?.scrollIntoView?.({ block: "nearest" });
    title.current?.focus();
    onFocused(); // one-shot: a remount (panel reopened) must not act again
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (chartId: string, action: (id: string) => void) => {
    try { await getChart(f, chartId); } catch (error) {
      if (error instanceof ChartServerError && error.status === 404) { setNote("This chart was deleted on the chart server."); return; }
      // Unreachable: the host still opens the card, which says so itself.
    }
    setNote(null);
    action(chartId);
  };
  const remove = async () => {
    if (!(await host.dialog.confirm("Delete this inbox item?", { title: "Inbox", kind: "warning", okLabel: "Delete" }))) return;
    try { await deleteInboxItem(f, item.id); onGone(item.id); } catch (error) { setNote(`Not deleted: ${reason(error)}`); }
  };
  const many = item.chart_ids.length > 1;

  return (
    <li className="arts-inbox-item" data-inbox-id={item.id} data-unread={item.read_at === null ? "true" : undefined}>
      <button ref={title} type="button" className="arts-inbox-title" aria-expanded={open} aria-controls={bodyId} onClick={expand}>
        {item.read_at === null ? <span className="arts-inbox-dot" role="img" aria-label="Unread" /> : null}
        <span>{item.title}</span>
        <span className="arts-inbox-meta">{KIND[item.kind] ?? item.kind} · {new Date(item.created_at).toLocaleString()}</span>
      </button>
      {open ? (
        <div id={bodyId} className="arts-inbox-body">
          <Markdown text={item.body} openUrl={(url) => void host.openUrl(url)} />
          {item.snapshots.map((s, n) => <Snapshot key={s.url} f={f} url={s.url} n={n + 1} />)}
          {/* The server drops purged snapshot rows, so an old item with charts and no snapshots lost them to the purge. */}
          {item.snapshots.length === 0 && item.chart_ids.length > 0 && Date.now() - Date.parse(item.created_at) > KEPT_DAYS * 86_400_000
            ? <p className="arts-inbox-note">Snapshots are kept {KEPT_DAYS} days; this item's are no longer kept.</p> : null}
          <div className="arts-inbox-actions">
            {item.chart_ids.map((chartId, n) => {
              const suffix = many ? ` ${n + 1}` : "";
              const { openChart, addToDashboard } = host;
              return (
                <span key={n}>
                  {openChart ? <button type="button" onClick={() => void act(chartId, openChart)}>Open chart{suffix}</button> : null}
                  {addToDashboard ? <button type="button" onClick={() => void act(chartId, addToDashboard)}>Add to dashboard{suffix}</button> : null}
                  {addToDashboard ? <button type="button" onClick={() => void act(chartId, (id) => addToDashboard(id, { live: true }))}>Add as live chart{suffix}</button> : null}
                </span>
              );
            })}
            <button type="button" onClick={() => void remove()}>Delete</button>
          </div>
          {note === null ? null : <p className="arts-inbox-note" role="status">{note}</p>}
        </div>
      ) : null}
    </li>
  );
}

export function ArtsChartsInbox({ host, focusItem }: { host?: ArtsChartsHost; focusItem?: string }) {
  if (host !== undefined) configureArtsCharts(host);
  const f = getHost().chartsFetch;
  const [inbox, setInbox] = useState<InboxPage | null>(null);
  const [error, setError] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const focusAfter = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  // What a refetch must cover, and which list a late older page belongs to.
  const shown = useRef(0);
  const generation = useRef(0);
  shown.current = inbox?.items.length ?? 0;
  // focusItem: the id handled last (once per value), the Entry to focus, an
  // item fetched because the loaded pages lack it, and the note for a miss.
  const handled = useRef<string | undefined>(undefined);
  const [focused, setFocused] = useState<string | null>(null);
  const [linked, setLinked] = useState<InboxItem | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const loaded = inbox !== null || error;

  useEffect(() => {
    if (f === undefined) return;
    let active = true;
    const stop = followFeed(f, "inbox", async () => {
      // A refetch outranks an older page still in flight (its result is dropped).
      generation.current += 1;
      setRefreshing(true);
      try {
        const depth = Math.max(PAGE, shown.current);
        let next = await listInbox(f, { limit: Math.min(MAX_PAGE, depth) });
        // Past the server's cap, keep paging by the cursor until the depth is covered.
        while (next.next !== null && next.items.length < depth) {
          const page = await listInbox(f, { limit: Math.min(MAX_PAGE, depth - next.items.length), before: next.next });
          const have = new Set(next.items.map((i) => i.id));
          next = { items: [...next.items, ...page.items.filter((i) => !have.has(i.id))], unread: page.unread, next: page.next };
        }
        if (active) { setInbox(next); setError(false); setOlderError(null); }
      } catch { if (active) setError(true); }
      finally { if (active) setRefreshing(false); }
    });
    return () => { active = false; stop(); };
  }, [f]);

  const loadOlder = async () => {
    if (f === undefined || inbox?.next == null || loadingOlder || refreshing) return;
    const mine = generation.current;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await listInbox(f, { limit: PAGE, before: inbox.next });
      // A feed refetch landed meanwhile: its list is the truth, this page is stale.
      if (mine !== generation.current) return;
      const have = new Set(inbox.items.map((i) => i.id));
      const fresh = page.items.filter((i) => !have.has(i.id));
      focusAfter.current = fresh[0]?.id ?? null;
      setInbox({ items: [...inbox.items, ...fresh], unread: page.unread, next: page.next });
    } catch (e) {
      if (mine === generation.current) setOlderError(`Older items did not load: ${reason(e)}`);
    } finally { setLoadingOlder(false); }
  };

  useEffect(() => {
    if (focusItem === undefined) { handled.current = undefined; setFocused(null); return; }
    if (f === undefined || !loaded || handled.current === focusItem) return;
    const id = focusItem;
    handled.current = id;
    setOpen(true);
    setMissing(null);
    setLinked(null);
    setFocused(null);
    if (inbox?.items.some((i) => i.id === id)) { setFocused(id); return; }
    getInboxItem(f, id).then(
      (item) => { if (handled.current === id) { setLinked(item); setFocused(item.id); } },
      (e: unknown) => {
        if (handled.current !== id) return;
        setMissing(e instanceof ChartServerError && e.status === 404 ? NOT_KEPT : `That inbox item did not load: ${reason(e)}`);
      },
    );
  }, [focusItem, f, loaded, inbox]);

  // The Load older button may have unmounted (the last page) or been the
  // focus: hand the keyboard to the first item that arrived.
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-inbox-id="${CSS.escape(id)}"] .arts-inbox-title`)?.focus();
  }, [inbox]);

  if (f === undefined) return null;
  const unread = inbox?.unread ?? 0;
  const loadedItems = inbox?.items ?? [];
  const items = linked !== null && !loadedItems.some((i) => i.id === linked.id) ? [linked, ...loadedItems] : loadedItems;
  // A delete shows at once; the feed's event then refetches the truth.
  const gone = (id: string) => {
    setInbox((s) => s && { ...s, items: s.items.filter((i) => i.id !== id) });
    setLinked((l) => (l?.id === id ? null : l));
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from anywhere in the inbox closes it; every action is a button.
    <div
      className="arts-inbox"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
        toggle.current?.focus();
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="arts-inbox-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        onClick={() => setOpen((was) => !was)}
      >
        Inbox
        {unread > 0 ? <span className="arts-inbox-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <section id={panelId} className="arts-inbox-panel" aria-label="Inbox">
          {error ? <p className="arts-inbox-note" role="status">{UNREACHABLE}</p> : null}
          {missing === null ? null : <p className="arts-inbox-note" role="status">{missing}</p>}
          {inbox !== null && items.length === 0 ? <p className="arts-inbox-note">Nothing in the inbox.</p> : null}
          <ul className="arts-inbox-list">
            {items.map((item) => <Entry key={item.id} f={f} item={item} onGone={gone} focused={item.id === focused} onFocused={() => setFocused(null)} />)}
          </ul>
          {/* Always mounted, so a screen reader announces the text that arrives in it. */}
          <div role="status">{olderError === null ? null : <p className="arts-inbox-note">{olderError}</p>}</div>
          {inbox?.next == null ? null : (
            // aria-disabled, not disabled: a disabled button drops the keyboard's focus to the page.
            <button type="button" className="arts-inbox-older" aria-disabled={loadingOlder || refreshing} onClick={() => void loadOlder()}>Load older</button>
          )}
        </section>
      ) : null}
    </div>
  );
}
