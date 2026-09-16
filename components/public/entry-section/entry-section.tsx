import type { Section } from "@/lib/pod/schema";

/** Text only for now — photos land in Task 2 (spec §8). A server component:
 *  no hooks, no events, nothing to hydrate. */
export function EntrySection({ section }: { section: Section }) {
  return (
    <>
      {section.text && (
        <div className="wrap">
          <div className="entry-prose prose">
            {section.text.value.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}
      {/* photos: Task 2 */}
    </>
  );
}
