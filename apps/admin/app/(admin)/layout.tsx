import { AdminShell } from "@/components/admin/admin-shell";
import { requireCloudflareAccess } from "@/lib/supabase-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const identity = await requireCloudflareAccess();

  return (
    <AdminShell email={identity.email}>{children}</AdminShell>
  );
}
