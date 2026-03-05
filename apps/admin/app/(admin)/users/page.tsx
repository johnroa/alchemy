import { Users } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUsersData } from "@/lib/admin-data";

export default async function UsersPage(): Promise<React.JSX.Element> {
  const users = await getUsersData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Search users, inspect account status, and manage memory and access controls."
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-muted-foreground" />
              User Directory
            </CardTitle>
            <CardDescription className="mt-0.5">{users.length} total accounts.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <UsersTable users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
