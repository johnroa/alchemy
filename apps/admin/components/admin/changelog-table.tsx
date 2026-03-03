"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ChangelogItem = {
  id: string;
  created_at: string;
  scope: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  request_id: string | null;
  actor_email: string | null;
};

const actionColors: Record<string, string> = {
  create: "border-emerald-300 bg-emerald-50 text-emerald-700",
  update: "border-blue-300 bg-blue-50 text-blue-700",
  delete: "border-red-300 bg-red-50 text-red-700",
  activate: "border-violet-300 bg-violet-50 text-violet-700",
  deactivate: "border-zinc-300 bg-zinc-50 text-zinc-700"
};

function actionVariantClass(action: string): string {
  const lower = action.toLowerCase();
  for (const [key, cls] of Object.entries(actionColors)) {
    if (lower.includes(key)) return cls;
  }
  return "";
}

export function ChangelogTable({ items }: { items: ChangelogItem[] }): React.JSX.Element {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;

    return items.filter((item) => {
      const haystack = [
        item.scope,
        item.action,
        item.entity_type,
        item.entity_id ?? "",
        item.actor_email ?? "",
        item.request_id ?? ""
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [items, search]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by scope, action, request id, actor…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pl-9"
        />
      </div>

      {search && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {items.length} events match &ldquo;{search}&rdquo;
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Request</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                {search ? "No events match the current filter." : "No changelog events yet."}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {item.scope}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={actionVariantClass(item.action)}>
                    {item.action}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                  {item.entity_type}
                  {item.entity_id ? `:${item.entity_id.slice(0, 8)}…` : ""}
                </TableCell>
                <TableCell className="text-xs">{item.actor_email ?? <span className="text-muted-foreground">n/a</span>}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {item.request_id ? `${item.request_id.slice(0, 12)}…` : "n/a"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
