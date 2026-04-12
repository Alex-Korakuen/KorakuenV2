import { requirePartner } from "@/lib/auth";
import { ExchangeRateBanner } from "@/components/exchange-rate-banner";
import { Sidebar } from "@/components/app-shell/sidebar";

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePartner();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        variant="partner"
        user={{
          displayName: user.display_name ?? user.email,
          email: user.email,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ExchangeRateBanner variant="partner" />
        {children}
      </div>
    </div>
  );
}
