import { notFound } from "next/navigation";

/**
 * The proxy rewrites unknown trip URLs here. This route is fully static — no
 * params, no Pod read — so notFound() runs during prerendering rather than
 * after a shell has been flushed, which is what lets the 404 status stick.
 * It renders app/(public)/not-found.tsx, so there is one 404 design.
 */
export default function NotFoundRoute(): never {
  notFound();
}
