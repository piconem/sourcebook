import { moveTableColumn, moveTableRow, selectedRect } from "@tiptap/pm/tables";
import { useEditorState, type Editor } from "@tiptap/react";

/** Contextual controls shown while the cursor is inside a table. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e.isActive("table")) return null;
      try {
        const rect = selectedRect(e.state);
        return { row: rect.top, col: rect.left, rows: rect.map.height, cols: rect.map.width };
      } catch {
        return null;
      }
    },
  });
  if (!state) return null;

  const chain = () => editor.chain().focus();
  // Row 0 is the Markdown header row: it stays in place, body rows move among themselves.
  const moveRow = (to: number) =>
    chain()
      .command(({ state: s, dispatch }) => moveTableRow({ from: state.row, to, select: false })(s, dispatch))
      .run();
  const moveCol = (to: number) =>
    chain()
      .command(({ state: s, dispatch }) => moveTableColumn({ from: state.col, to, select: false })(s, dispatch))
      .run();

  const btn = (label: string, title: string, run: () => void, disabled = false) => (
    <button
      type="button"
      className="tb"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className="md-toolbar table-toolbar">
      <span className="tb-label">Row</span>
      {btn("+↑", "Insert row above", () => chain().addRowBefore().run(), state.row === 0)}
      {btn("+↓", "Insert row below", () => chain().addRowAfter().run())}
      {btn("↑", "Move row up", () => moveRow(state.row - 1), state.row <= 1)}
      {btn("↓", "Move row down", () => moveRow(state.row + 1), state.row === 0 || state.row >= state.rows - 1)}
      {btn("✕", "Delete row", () => chain().deleteRow().run(), state.row === 0)}
      <span className="tb-sep" />
      <span className="tb-label">Column</span>
      {btn("+←", "Insert column left", () => chain().addColumnBefore().run())}
      {btn("+→", "Insert column right", () => chain().addColumnAfter().run())}
      {btn("←", "Move column left", () => moveCol(state.col - 1), state.col === 0)}
      {btn("→", "Move column right", () => moveCol(state.col + 1), state.col >= state.cols - 1)}
      {btn("✕", "Delete column", () => chain().deleteColumn().run(), state.cols <= 1)}
      <span className="tb-sep" />
      {btn("Delete table", "Delete the whole table", () => chain().deleteTable().run())}
    </div>
  );
}
