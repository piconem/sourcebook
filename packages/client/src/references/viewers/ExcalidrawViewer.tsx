import "@excalidraw/excalidraw/index.css";
import { Excalidraw } from "@excalidraw/excalidraw";
import { useMemo } from "react";
import { useAppearance } from "../../theme/AppearanceContext";
import type { ViewerProps } from "./types";

export default function ExcalidrawViewer({ text }: ViewerProps) {
  const { surfaceScheme } = useAppearance();
  const scene = useMemo(() => {
    try {
      return JSON.parse(text ?? "");
    } catch {
      return null;
    }
  }, [text]);
  if (!scene) return <p className="render-error">This file is not a valid Excalidraw scene.</p>;
  return (
    <div className="ref-excalidraw">
      <Excalidraw
        viewModeEnabled
        theme={surfaceScheme}
        initialData={{
          elements: scene.elements ?? [],
          appState: { ...scene.appState, collaborators: new Map(), viewModeEnabled: true },
          files: scene.files ?? {},
          scrollToContent: true,
        }}
      />
    </div>
  );
}
