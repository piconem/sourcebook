import type { Project } from "@sourcebook/shared";
import { AllCommentsButton } from "../comments/AllCommentsButton";
import type { Target } from "../router";
import { NotificationsButton } from "./NotificationsButton";

/** Editor buttons shown in the top bar: all comments of the project and change notifications. */
export function EditorActions(props: { project: Project | undefined; goTo(t: Target): void }) {
  return (
    <>
      <AllCommentsButton {...props} />
      <NotificationsButton {...props} />
    </>
  );
}
