import { requireAdmin } from "@/lib/auth";
import { ExchangeRateBanner } from "@/components/exchange-rate-banner";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        variant="admin"
        user={{
          displayName: user.display_name ?? user.email,
          email: user.email,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar variant="admin" />
        <ExchangeRateBanner variant="admin" />
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
