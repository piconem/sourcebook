import { useState } from "react";
import { useUser } from "../api/queries";
import { AppearanceDialog } from "./AppearanceDialog";
import { Avatar } from "./Avatar";
import { ScrollModeButton } from "./ScrollModeButton";
import type { ScrollMode } from "./scrollMode";
import type { NotebookKind } from "@sourcebook/shared";
import { routeHref } from "../router";
import { SettingsDialog } from "./SettingsDialog";

export function TopBar(props: {
  /** Shown in the editor: "Projects › <name>" / "Templates › <name>". */
  crumb?: { kind: NotebookKind; name: string };
  /** Scrolling mode applies to the editor only. */
  scrollMode?: ScrollMode;
  onScrollModeChange(m: ScrollMode): void;
  /** Receives the element where the open editor renders its own buttons (editor only). */
  actionsSlot?(el: HTMLElement | null): void;
}) {
  const { crumb, scrollMode, onScrollModeChange } = props;
  const { data: user } = useUser();
  const [settings, setSettings] = useState(false);
  const [appearance, setAppearance] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-left">
      <a className="brand" href="#/projects" title="Home — all projects">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5" />
          <path d="M9 7h7M9 11h5" />
        </svg>
        <span>Sourcebook</span>
      </a>
      {crumb && (
        <nav className="topbar-crumbs" aria-label="Location">
          <span aria-hidden="true">›</span>
          <a href={routeHref({ page: "home", kind: crumb.kind })}>{crumb.kind === "projects" ? "Projects" : "Templates"}</a>
          <span aria-hidden="true">›</span>
          <span className="topbar-crumb-current" title={crumb.name}>
            {crumb.name}
          </span>
        </nav>
      )}
      </div>
      <div className="topbar-actions">
      {props.actionsSlot && <div className="topbar-editor-actions" ref={props.actionsSlot} />}
      {scrollMode && <ScrollModeButton mode={scrollMode} onChange={onScrollModeChange} />}
      <button className="icon topbar-btn" title="Appearance / theme" aria-label="Appearance" onClick={() => setAppearance(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
        </svg>
      </button>
      <button
        className="topbar-user"
        title={user ? `${user.name} (@${user.username}) — Settings` : "Settings"}
        aria-label="User settings"
        onClick={() => setSettings(true)}
      >
        {user ? (
          <Avatar name={user.name} username={user.username} size={30} />
        ) : (
          <span className="avatar placeholder" style={{ width: 30, height: 30 }} />
        )}
      </button>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      <AppearanceDialog open={appearance} onClose={() => setAppearance(false)} />
    </header>
  );
}
