import { Sparkles } from "lucide-react";
import { AccountMenu } from "@/components/admin/account-menu";
import { SideNav } from "@/components/admin/side-nav";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const identity = await requireCloudflareAccess();

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      {/* Sidebar */}
      <aside className="flex w-60 flex-none flex-col border-r bg-white shadow-sm">
        <div className="flex h-14 flex-none items-center gap-3 border-b px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">CookWithAlchemy</p>
            <p className="text-xs text-muted-foreground">Admin Console</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <SideNav />
        </div>

        <div className="border-t px-2 py-3">
          <AccountMenu email={identity.email} />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-8 py-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
