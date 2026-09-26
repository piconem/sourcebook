import type { DrawingContent } from "@sourcebook/shared";
import "@excalidraw/excalidraw/index.css";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { useRef } from "react";
import { useAppearance } from "../../theme/AppearanceContext";
import type { SubBlockProps } from "../types";

/** Default export so it can be lazy-loaded (Excalidraw is large). */
export default function DrawingEditor({ subBlock, onChange }: SubBlockProps<DrawingContent>) {
  const last = useRef<string>(JSON.stringify(subBlock.content));
  const { elements, appState, files } = subBlock.content;
  const { surfaceScheme } = useAppearance();
  return (
    <div className="drawing">
      <Excalidraw
        theme={surfaceScheme}
        initialData={{
          elements: elements as never,
          appState: { ...appState, collaborators: new Map() } as never,
          files: files as never,
        }}
        onChange={(els, state, bin) => {
          // The UI theme is a viewer preference, not part of the drawing: keep it out of the file.
          const scene = JSON.parse(serializeAsJSON(els, state, bin, "local"));
          delete scene.appState?.theme;
          const json = JSON.stringify(scene);
          if (json === last.current) return;
          last.current = json;
          onChange(scene);
        }}
      />
    </div>
  );
}
