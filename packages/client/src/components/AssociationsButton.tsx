import { useEffect, useRef, useState, type ReactNode } from "react";

export interface AssociationItem {
  id: string;
  label: string;
  detail?: string;
  /** Tooltip. */
  title?: string;
  missing?: boolean;
}

/**
 * Header button with a count badge, opening a popover that lists what is associated with a whole section or
 * sub-block (open, remove), what is linked in its text, and a search to add more. Used for bibliography
 * sources (📚) and reference files (📎).
 */
export function AssociationsButton(props: {
  /** CSS modifier, e.g. "citations" or "attachments". */
  variant: string;
  icon: ReactNode;
  /** Accessible name of the button, e.g. "Sources". */
  label: string;
  /** Tooltip of the button, depending on the count. */
  tooltip(count: number): string;
  /** Popover heading. */
  heading: string;
  empty: string;
  items: AssociationItem[];
  /** Linked from the text but not associated (shown, not editable here). */
  inText?: AssociationItem[];
  inTextLabel?: string;
  searchPlaceholder: string;
  /** Candidates to add for a query (the caller excludes those already associated). */
  candidates(query: string): AssociationItem[];
  onOpen(id: string): void;
  onChange(ids: string[]): Promise<void>;
  newLabel?: string;
  /** Creates a new item; `add` associates it once created. */
  onNew?(add: (id: string) => void): void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ids = props.items.map((i) => i.id);
  useEffect(() => {
    if (!open) return;
    const inDialog = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("dialog");
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && !inDialog(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !inDialog(e.target) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = async (next: string[]) => {
    setError(null);
    try {
      await props.onChange(next);
      setQ("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const count = ids.length;
  const candidates = q || count === 0 ? props.candidates(q).slice(0, 8) : [];
  return (
    <div className={`popover-wrap assoc-wrap ${props.variant}-wrap`} ref={wrap}>
      <button
        className={`icon assoc-toggle ${props.variant}-toggle${count ? " has-items" : ""}${open ? " active" : ""}`}
        title={props.tooltip(count)}
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {props.icon}
        {count > 0 && <span className="comment-count">{count}</span>}
      </button>
      {open && (
        <div className={`popover-menu assoc-popover ${props.variant}-popover`} role="dialog" aria-label={props.heading}>
          <div className="popover-title">{props.heading}</div>
          {count === 0 && <p className="muted small assoc-empty">{props.empty}</p>}
          <ul className="assoc-list">
            {props.items.map((it) => (
              <li key={it.id} className={it.missing ? "missing" : undefined}>
                <button className="assoc-open" onClick={() => props.onOpen(it.id)} title={it.title}>
                  <strong>{it.label}</strong>
                  {it.detail && <span className="muted small">{it.detail}</span>}
                </button>
                <button className="icon" aria-label={`Remove ${it.label}`} title="Remove the association" onClick={() => save(ids.filter((x) => x !== it.id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {!!props.inText?.length && (
            <p className="muted small assoc-intext">
              {props.inTextLabel ?? "In the text"}:{" "}
              {props.inText.map((it, i) => (
                <span key={it.id}>
                  {i > 0 && ", "}
                  <button className="link" title={it.title} onClick={() => props.onOpen(it.id)}>
                    {it.label}
                  </button>
                </span>
              ))}
            </p>
          )}
          <input className="bib-search" placeholder={props.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
          {candidates.length > 0 && (
            <ul className="assoc-list add">
              {candidates.map((it) => (
                <li key={it.id}>
                  <button className="assoc-open" onClick={() => save([...ids, it.id])}>
                    <strong>＋ {it.label}</strong>
                    {it.detail && <span className="muted small">{it.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {props.onNew && (
            <button className="link assoc-new" onClick={() => props.onNew!((id) => void save([...ids, id]))}>
              ＋ {props.newLabel ?? "New…"}
            </button>
          )}
          {error && <p className="render-error small">{error}</p>}
        </div>
      )}
    </div>
  );
}
