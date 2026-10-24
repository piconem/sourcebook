import { APP_DESCRIPTION, APP_NAME, APP_VERSION, RELEASE_DATE } from "@sourcebook/shared";
import { BASE_PATH } from "../api/client";
import { Dialog } from "./Dialog";

/** "released 24 Oct 2026" (local date format). */
export const releaseLabel = () =>
  `released ${new Date(`${RELEASE_DATE}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

/** Software information: name, version, release date and licenses. */
export function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} title={`About ${APP_NAME}`} onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
      <div className="about">
        <p className="about-name">
          <strong>{APP_NAME}</strong>
        </p>
        <p className="muted">{APP_DESCRIPTION}</p>
        <dl className="about-facts">
          <dt>Version</dt>
          <dd>{APP_VERSION}</dd>
          <dt>Release date</dt>
          <dd>
            <time dateTime={RELEASE_DATE}>
              {new Date(`${RELEASE_DATE}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" })}
            </time>
          </dd>
          <dt>License</dt>
          <dd>
            MIT ·{" "}
            <a href={`${BASE_PATH}/THIRD_PARTY_LICENSES.txt`} target="_blank" rel="noreferrer">
              Third-party licenses
            </a>
          </dd>
        </dl>
      </div>
    </Dialog>
  );
}
