export function SiteFooter({ siteName, status }: { siteName: string; status?: string }) {
  return (
    <footer className="status-line">
      <span>{siteName} — a travel diary that stores its own data in a solid pod</span>
      {status !== undefined && <span>{status}</span>}
    </footer>
  );
}
