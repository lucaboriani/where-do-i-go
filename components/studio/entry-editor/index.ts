/** Barrel for ONE component; see CLAUDE.md "Code structure". */
export { default } from "./entry-editor";
/** The studio is what ships this number, so it stays on the barrel even though
 *  it now lives in the hook that spends it. */
export { DRAFT_DEBOUNCE_MS } from "@/hooks/studio/use-entry-draft";
export type { EditorTrip, EntryEditorProps } from "./entry-editor";
