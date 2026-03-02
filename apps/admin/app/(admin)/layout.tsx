import { AccountMenu } from "@/components/admin/account-menu";
import { SideNav } from "@/components/admin/side-nav";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const identity = await requireCloudflareAccess();

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 p-4 lg:grid-cols-[240px,1fr]">
        <aside className="rounded-xl border bg-background p-4 shadow-sm">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">CookWithAlchemy</p>
            <h2 className="text-lg font-semibold">Admin Console</h2>
          </div>
          <SideNav />
        </aside>

        <main className="space-y-4">
          <header className="flex justify-end rounded-xl border bg-background p-3 shadow-sm">
            <AccountMenu email={identity.email} />
          </header>
          <section className="rounded-xl border bg-background p-6 shadow-sm">{children}</section>
        </main>
      </div>
    </div>
  );
}
