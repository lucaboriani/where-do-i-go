/**
 * The shared `<Field>` wrapper and the two class tokens every control on the
 * entry form is spent through. Moved verbatim out of entry-editor.tsx so the
 * five field groups can import it: ./notes.md#why-it-is-its-own-component
 */

import type { ReactNode } from "react";

/**
 * Tokens from app/globals.css, no arbitrary values: the fixed dark palette
 * lives at `:root` and this screen stays plain until phase 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARBITRARY-VALUE GUARDRAIL DOES NOT REACH THESE TWO CONSTANTS. Keep
 * arbitrary values out of them by hand.
 *
 * eslint.config.mjs bans `w-[137px]` and its kind with the selector
 * `JSXAttribute[name.name='className'] Literal[value=/…-\[…\]/]`, which matches
 * a string written INSIDE the attribute. These are module consts spent as
 * `className={CONTROL}` — an Identifier, not a Literal — so the rule never
 * looks at them. Measured with a throwaway probe: `disabled:bg-[#222]` in here
 * produces zero errors and the same string inline produces one. The rule is not
 * changed to suit this file; that is a separate decision with its own failing
 * test, and this note is here so the gap is known rather than discovered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `disabled:` HAS TO BE SPELLED OUT AT ALL, when every browser greys a
 * disabled control for free.
 *
 * It greys it by supplying its OWN background and text colour, and this theme
 * has already overridden both: `bg-surface` outranks the UA background, and
 * Tailwind's preflight sets `color: inherit` on form controls, so the UA's
 * disabled text colour never lands either. On a light default that would still
 * leave something visibly off; on a fixed dark palette it leaves nothing.
 *
 * Measured in a real browser, against the local Community Solid Server, with a
 * draft seeded and the banner up — `getComputedStyle` on held and free controls
 * side by side:
 *
 *     headline (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *     save     (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *     restore  (free)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
 *
 * Byte-identical. Seventeen controls that look perfectly editable while swallowing
 * every keystroke — which is a worse failure than an ugly one, because the
 * owner's conclusion is that the app is broken rather than that something is
 * being asked of them. The programmatic half of the same defect is the Save
 * button's `aria-describedby`, above.
 *
 * ONE VARIANT COVERS ALL SIXTEEN FIELDS BECAUSE `:disabled` IS INHERITED IN
 * FACT IF NOT IN NAME: a control inside a `<fieldset disabled>` is "actually
 * disabled" per HTML, so `:disabled` matches it without the attribute being on
 * the control. That is the same mechanism the hold itself relies on.
 *
 * BOTH OVERRIDES WIN ON SPECIFICITY, NOT ON SOURCE ORDER, which is worth
 * knowing because source order is the thing a Tailwind upgrade may re-sort.
 * Compiled with this project's own Tailwind 4.3.3 and read out of the emitted
 * stylesheet:
 *
 *     .cursor-pointer                          0,1,0
 *     .disabled\:cursor-not-allowed:disabled    0,2,0   wins
 *     .hover\:bg-hairline:hover                 0,2,0
 *     .disabled\:hover\:bg-surface:disabled:hover 0,3,0  wins
 *
 * The hover override earns its place: `:hover` still matches a disabled button,
 * so without it the held Save button lights up under the pointer — a control
 * that is faded and inert and still reacts, which reads as pressable.
 *
 * NONE OF THIS IS TESTED, DELIBERATELY AND ON THE RECORD. jsdom computes no
 * cascade, so the only assertion available is `toHaveClass("disabled:opacity-60")`,
 * which restates the string on the next line and would pass against a variant
 * that resolves to nothing, a token absent from `@theme`, or a rule a later
 * Tailwind outranks. The reasoning is in components/studio/entry-editor/entry-editor.test.tsx's 8e-bis
 * docblock; the pin there covers the half a stylesheet cannot silently remove.
 */
export const CONTROL = "w-full border border-hairline bg-surface px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60";

/** The same plain button for Save, Restore and Discard. Shared so the two
 *  draft controls cannot drift into looking like something other than the
 *  buttons they are — which is also why the `disabled:` variants are here and
 *  not on the Save button alone: Restore and Discard are never disabled, so
 *  these three utilities only ever fire on Save, and putting them on the shared
 *  constant is what stops the next button added here from shipping inert and
 *  looking live. See CONTROL above for why the browser does not do it for us. */
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
