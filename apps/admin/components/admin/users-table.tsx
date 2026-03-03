"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserActionsSheet } from "@/components/admin/user-actions-sheet";

type User = {
  id: string;
  email: string | null;
  status: string;
  updated_at: string;
};

export function UsersTable({ users }: { users: User[] }): React.JSX.Element {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => {
      const haystack = [u.id, u.email ?? "", u.status].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [users, search]);

  const activeCount = users.filter((u) => u.status === "active").length;
  const inactiveCount = users.length - activeCount;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {activeCount} active
        </span>
        {inactiveCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-300" />
            {inactiveCount} inactive
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email or user ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {search && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {users.length} users match
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-12 text-center">
                <Users className="mx-auto mb-2 h-8 w-8 text-zinc-200" />
                <p className="text-sm text-muted-foreground">
                  {search ? "No users match the search query." : "No users found."}
                </p>
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{user.email ?? <span className="text-muted-foreground">Unknown</span>}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{user.id}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      user.status === "active"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-zinc-300 bg-zinc-50 text-zinc-600"
                    }
                  >
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(user.updated_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <UserActionsSheet userId={user.id} email={user.email} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
