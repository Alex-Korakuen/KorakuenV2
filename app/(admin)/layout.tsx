import { requireAdmin } from "@/lib/auth";
import { ExchangeRateBanner } from "@/components/exchange-rate-banner";
import { Sidebar } from "@/components/app-shell/sidebar";
import { getInboxPendingCount } from "@/app/actions/inbox";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, inboxPending] = await Promise.all([
    requireAdmin(),
    getInboxPendingCount(),
  ]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        variant="admin"
        user={{
          displayName: user.display_name ?? user.email,
          email: user.email,
        }}
        badges={{ "/inbox": inboxPending }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ExchangeRateBanner variant="admin" />
        {children}
      </div>
    </div>
  );
}
