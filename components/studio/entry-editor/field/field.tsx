/**
 * The shared `<Field>` wrapper and the two class tokens every control on the
 * entry form is spent through. Moved verbatim out of entry-editor.tsx so the
 * five field groups can import it: ./notes.md#why-it-is-its-own-component
 */

import type { ReactNode } from "react";

/** Tokens from app/globals.css. KEEP ARBITRARY VALUES OUT OF THESE TWO CONSTANTS
 *  BY HAND, and DO NOT DELETE A `disabled:` VARIANT: this theme overrides both
 *  colours a browser greys a control with, so without them seventeen controls
 *  look editable and swallow every keystroke — measured.
 *  ./notes.md#why-the-disabled-variants-are-spelled-out */
export const CONTROL = "w-full border border-hairline bg-surface px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60";

/** The same plain button for Save, Restore and Discard, and the `disabled:`
 *  variants are HERE rather than on Save alone:
 *  ./notes.md#why-the-disabled-variants-live-on-button-and-not-on-save */
export const BUTTON =
  "cursor-pointer border border-hairline bg-surface px-4 py-2 hover:bg-hairline " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface";

/** A control with a real `<label>` — the studio is navigable by keyboard and
 *  by screen reader, and a field a screen reader cannot name is a field only
 *  some people can fill in. The hint is `aria-describedby`, not part of the
 *  label: it is guidance, not the name of the thing. */
export default function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
