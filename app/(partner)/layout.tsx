import { requirePartner } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePartner();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold">Korakuen</span>
          <span className="text-sm text-gray-500">Socio</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {user.display_name ?? user.email}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
