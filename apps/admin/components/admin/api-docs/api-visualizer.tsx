"use client";

import { useState, useMemo } from "react";
import { Globe, Search, Server, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ResourceGroup } from "./endpoint-list";
import {
  type AdminRoute,
  groupAdminRoutes,
  groupEndpoints,
  parseEndpoints,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Main visualizer component                                          */
/* ------------------------------------------------------------------ */

interface ApiVisualizerProps {
  /** Parsed OpenAPI spec object */
  spec: Record<string, unknown>;
  /** Admin API routes discovered from filesystem */
  adminRoutes: AdminRoute[];
}

export function ApiVisualizer({ spec, adminRoutes }: ApiVisualizerProps): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "admin">("main");

  /* Parse the OpenAPI spec into grouped endpoints */
  const mainEndpoints = useMemo(() => parseEndpoints(spec), [spec]);
  const mainGroups = useMemo(() => groupEndpoints(mainEndpoints), [mainEndpoints]);
  const adminGroups = useMemo(() => groupAdminRoutes(adminRoutes), [adminRoutes]);

  /* Filter by search term */
  const searchLower = search.toLowerCase();
  const filteredMainGroups = useMemo(() => {
    if (!searchLower) return mainGroups;
    return mainGroups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (ep) =>
            ep.path.toLowerCase().includes(searchLower) ||
            ep.method.toLowerCase().includes(searchLower) ||
            ep.summary.toLowerCase().includes(searchLower)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [mainGroups, searchLower]);

  const filteredAdminGroups = useMemo(() => {
    if (!searchLower) return adminGroups;
    return adminGroups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (ep) =>
            ep.path.toLowerCase().includes(searchLower) ||
            ep.method.toLowerCase().includes(searchLower)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [adminGroups, searchLower]);

  const activeGroups = activeTab === "main" ? filteredMainGroups : filteredAdminGroups;
  const totalEndpoints = activeTab === "main" ? mainEndpoints.length : adminRoutes.length;

  /* Extract spec metadata */
  const info = spec["info"] as Record<string, unknown> | undefined;
  const specVersion = info?.["version"] as string | undefined;

  return (
    <div className="space-y-4">
      {/* Stat cards row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="h-4 w-4" />
              Main API (v1)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{mainEndpoints.length}</p>
            <p className="text-xs text-muted-foreground">
              endpoints across {mainGroups.length} resources
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Shield className="h-4 w-4" />
              Admin API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{adminRoutes.length}</p>
            <p className="text-xs text-muted-foreground">
              endpoints across {adminGroups.length} resources
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Globe className="h-4 w-4" />
              Spec Version
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{specVersion ?? "—"}</p>
            <p className="text-xs text-muted-foreground">OpenAPI 3.1.0</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab bar + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-white p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("main")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === "main"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Main API
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("admin")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === "admin"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Admin API
          </button>
        </div>

        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${totalEndpoints} endpoints...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {activeTab === "main" && (
          <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
            Base: <code className="font-mono text-zinc-700">api.cookwithalchemy.com/v1</code>
          </p>
        )}
        {activeTab === "admin" && (
          <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
            Base: <code className="font-mono text-zinc-700">admin.cookwithalchemy.com</code>
          </p>
        )}
      </div>

      {/* Endpoint groups */}
      <div className="space-y-3">
        {activeGroups.length === 0 && (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {search ? "No endpoints match your search" : "No endpoints found"}
              </p>
            </CardContent>
          </Card>
        )}
        {activeGroups.map((group) => (
          <ResourceGroup
            key={group.label}
            group={group}
            spec={activeTab === "main" ? spec : null}
            defaultOpen={activeGroups.length <= 3 || !!search}
          />
        ))}
      </div>
    </div>
  );
}
