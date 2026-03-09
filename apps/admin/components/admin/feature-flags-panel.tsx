"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Eye, Plus, RefreshCcw, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  FEATURE_FLAG_TYPES,
  isFeatureFlagPayload,
  type FeatureFlagEnvironment,
  type FeatureFlagType,
  type ResolveFlagsResponse,
} from "../../../../packages/shared/src/feature-flags";
import type {
  AdminFeatureFlag,
  AdminFeatureFlagConfig,
  FeatureFlagsAdminSnapshot,
} from "@/lib/feature-flags-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type FlagStatusFilter = "all" | "active" | "archived";

type EditorDraft = {
  key: string;
  name: string;
  description: string;
  flag_type: FeatureFlagType;
  owner: string;
  tags: string;
  expires_at: string;
  enabled: boolean;
  payload_json: string;
};

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
};

const toLocalDateTimeInput = (value: string | null): string => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const fromLocalDateTimeInput = (value: string): string | null => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const stringifyPayload = (config: AdminFeatureFlagConfig | null): string =>
  config?.payload_json ? JSON.stringify(config.payload_json, null, 2) : "";

const buildDraft = (
  flag: AdminFeatureFlag | null,
  environment: FeatureFlagEnvironment,
): EditorDraft => {
  const config = flag?.configs[environment] ?? null;
  return {
    key: flag?.key ?? "",
    name: flag?.name ?? "",
    description: flag?.description ?? "",
    flag_type: flag?.flag_type ?? "operational",
    owner: flag?.owner ?? "",
    tags: flag?.tags?.join(", ") ?? "",
    expires_at: toLocalDateTimeInput(flag?.expires_at ?? null),
    enabled: config?.enabled ?? false,
    payload_json: stringifyPayload(config),
  };
};

const parseTags = (value: string): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value.split(",")) {
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
};

const parsePayload = (
  value: string,
): { payload_json: Record<string, unknown> | null; error: string | null } => {
  const normalized = value.trim();
  if (!normalized) {
    return { payload_json: null, error: null };
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!isFeatureFlagPayload(parsed)) {
      return {
        payload_json: null,
        error: "Payload must be a JSON object or null.",
      };
    }
    return { payload_json: parsed, error: null };
  } catch {
    return { payload_json: null, error: "Payload must be valid JSON." };
  }
};

const getFlagStatus = (flag: AdminFeatureFlag): "active" | "archived" =>
  flag.archived_at ? "archived" : "active";

export function FeatureFlagsPanel(
  { initialData }: { initialData: FeatureFlagsAdminSnapshot },
): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(initialData);
  const [environment, setEnvironment] = useState<FeatureFlagEnvironment>(
    initialData.environments.find((entry) => entry.key === "production")?.key ??
      initialData.environments[0]?.key ??
      "production",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialData.flags.find((flag) => !flag.archived_at)?.key ??
      initialData.flags[0]?.key ??
      null,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FlagStatusFilter>("active");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<ResolveFlagsResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedFlag = useMemo(
    () => snapshot.flags.find((flag) => flag.key === selectedKey) ?? null,
    [selectedKey, snapshot.flags],
  );

  const [draft, setDraft] = useState<EditorDraft>(
    buildDraft(selectedFlag, environment),
  );

  useEffect(() => {
    setDraft(buildDraft(selectedFlag, environment));
  }, [selectedFlag, environment]);

  const filteredFlags = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return snapshot.flags.filter((flag) => {
      if (statusFilter !== "all" && getFlagStatus(flag) !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        flag.key.includes(normalizedSearch) ||
        flag.name.toLowerCase().includes(normalizedSearch) ||
        flag.owner.toLowerCase().includes(normalizedSearch) ||
        flag.tags.some((tag) => tag.includes(normalizedSearch))
      );
    });
  }, [search, snapshot.flags, statusFilter]);

  const selectedEnvironment = snapshot.environments.find((entry) =>
    entry.key === environment
  ) ?? null;

  const refreshSnapshot = async (preserveKey?: string | null): Promise<void> => {
    setRefreshing(true);
    const response = await fetch("/api/admin/flags", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | {
        ok?: boolean;
        environments?: FeatureFlagsAdminSnapshot["environments"];
        flags?: FeatureFlagsAdminSnapshot["flags"];
        error?: string;
      }
      | null;
    setRefreshing(false);

    if (!response.ok || !payload?.ok || !payload.environments || !payload.flags) {
      toast.error(payload?.error ?? "Failed to load flags");
      return;
    }

    setSnapshot({
      environments: payload.environments,
      flags: payload.flags,
    });
    if (typeof preserveKey === "string") {
      setSelectedKey(preserveKey);
    }
  };

  const refreshPreview = useCallback(async (
    key: string | null,
    silent = false,
  ): Promise<void> => {
    if (!key) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    const response = await fetch("/api/admin/flags/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        environment,
        keys: [key],
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; resolution?: ResolveFlagsResponse; error?: string }
      | null;
    setPreviewLoading(false);

    if (!response.ok || !payload?.ok || !payload.resolution) {
      const message = payload?.error ?? "Failed to preview flag";
      setPreviewError(message);
      setPreview(null);
      if (!silent) {
        toast.error(message);
      }
      return;
    }

    setPreview(payload.resolution);
    setPreviewError(null);
  }, [environment]);

  useEffect(() => {
    if (!selectedFlag) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    void refreshPreview(selectedFlag.key, true);
  }, [refreshPreview, selectedFlag]);

  const submitDraft = async (): Promise<void> => {
    const { payload_json, error: payloadError } = parsePayload(draft.payload_json);
    if (payloadError) {
      toast.error(payloadError);
      return;
    }

    const expiresAt = fromLocalDateTimeInput(draft.expires_at);
    if (draft.expires_at.trim() && !expiresAt) {
      toast.error("Expires at must be a valid date/time.");
      return;
    }

    setSaving(true);
    const endpoint = "/api/admin/flags";
    const method = selectedFlag ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: selectedFlag?.key ?? draft.key,
        name: draft.name,
        description: draft.description,
        flag_type: draft.flag_type,
        owner: draft.owner,
        tags: parseTags(draft.tags),
        expires_at: expiresAt,
        environment_configs: [{
          environment_key: environment,
          enabled: draft.enabled,
          payload_json,
        }],
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
        ok?: boolean;
        environments?: FeatureFlagsAdminSnapshot["environments"];
        flags?: FeatureFlagsAdminSnapshot["flags"];
        key?: string | null;
        error?: string;
      }
      | null;
    setSaving(false);

    if (!response.ok || !payload?.ok || !payload.environments || !payload.flags) {
      toast.error(payload?.error ?? "Failed to save flag");
      return;
    }

    setSnapshot({
      environments: payload.environments,
      flags: payload.flags,
    });
    setSelectedKey(payload.key ?? draft.key);
    toast.success(selectedFlag ? "Flag updated" : "Flag created");
  };

  const updateArchiveState = async (archived: boolean): Promise<void> => {
    if (!selectedFlag) {
      return;
    }

    setSaving(true);
    const response = await fetch("/api/admin/flags", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: selectedFlag.key,
        archived,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
        ok?: boolean;
        environments?: FeatureFlagsAdminSnapshot["environments"];
        flags?: FeatureFlagsAdminSnapshot["flags"];
        key?: string | null;
        error?: string;
      }
      | null;
    setSaving(false);

    if (!response.ok || !payload?.ok || !payload.environments || !payload.flags) {
      toast.error(payload?.error ?? "Failed to update archive state");
      return;
    }

    setSnapshot({
      environments: payload.environments,
      flags: payload.flags,
    });
    setSelectedKey(payload.key ?? selectedFlag.key);
    toast.success(archived ? "Flag archived" : "Flag restored");
  };

  const activeCount = snapshot.flags.filter((flag) => !flag.archived_at).length;
  const archivedCount = snapshot.flags.length - activeCount;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Flags</CardTitle>
            <CardDescription>Total runtime flags in the registry.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {snapshot.flags.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active</CardTitle>
            <CardDescription>Non-archived flags available for resolution.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {activeCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Archived</CardTitle>
            <CardDescription>Historical flags retained for auditability.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums">
            {archivedCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Environment</CardTitle>
            <CardDescription>Current editing and preview target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Select value={environment} onValueChange={(value) => setEnvironment(value as FeatureFlagEnvironment)}>
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {snapshot.environments.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Revision {selectedEnvironment?.revision ?? 1} · updated {formatTimestamp(selectedEnvironment?.updated_at ?? null)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Registry</CardTitle>
                <CardDescription>Environment-aware runtime flags managed in Admin.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshSnapshot(selectedFlag?.key ?? null)}
                  disabled={refreshing}
                >
                  <RefreshCcw className="h-4 w-4" />
                  {refreshing ? "Refreshing..." : "Refresh"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedKey(null);
                    setPreview(null);
                    setPreviewError(null);
                    setDraft(buildDraft(null, environment));
                  }}
                >
                  <Plus className="h-4 w-4" />
                  New Flag
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search key, owner, or tag"
              />
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as FlagStatusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>{environment}</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFlags.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No flags match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFlags.map((flag) => {
                      const config = flag.configs[environment];
                      const isSelected = flag.key === selectedFlag?.key;
                      return (
                        <TableRow
                          key={flag.id}
                          className={isSelected ? "bg-accent/40" : "cursor-pointer"}
                          onClick={() => setSelectedKey(flag.key)}
                        >
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium">{flag.key}</p>
                              <div className="flex flex-wrap gap-1">
                                {flag.archived_at && (
                                  <Badge variant="secondary" className="text-[10px]">Archived</Badge>
                                )}
                                {flag.tags.slice(0, 2).map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-[10px]">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{flag.flag_type}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{flag.owner}</TableCell>
                          <TableCell>
                            <Badge variant={config?.enabled ? "default" : "outline"} className="text-[10px]">
                              {config?.enabled ? "enabled" : "disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTimestamp(config?.updated_at ?? flag.updated_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {selectedFlag ? `Edit ${selectedFlag.key}` : "Create Flag"}
              </CardTitle>
              <CardDescription>
                One flag identity across environments. The editor below is scoped to {environment}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Key</label>
                  <Input
                    value={draft.key}
                    disabled={Boolean(selectedFlag)}
                    onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                    placeholder="recipe_canon_match"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <Select
                    value={draft.flag_type}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, flag_type: value as FeatureFlagType }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select flag type" />
                    </SelectTrigger>
                    <SelectContent>
                      {FEATURE_FLAG_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Recipe Canon Match"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Owner</label>
                  <Input
                    value={draft.owner}
                    onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
                    placeholder="backend"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tags</label>
                  <Input
                    value={draft.tags}
                    onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="recipes, canon, rollout"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Expires At</label>
                  <Input
                    type="datetime-local"
                    value={draft.expires_at}
                    onChange={(event) => setDraft((current) => ({ ...current, expires_at: event.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/80 bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{environment} config</p>
                    <p className="text-xs text-muted-foreground">
                      Toggle the flag and optionally attach a JSON payload.
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">
                    revision {selectedFlag?.configs[environment]?.revision ?? 1}
                  </Badge>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Enabled</label>
                    <Select
                      value={draft.enabled ? "true" : "false"}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, enabled: value === "true" }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Enabled" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Payload JSON</label>
                    <Textarea
                      value={draft.payload_json}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, payload_json: event.target.value }))}
                      rows={10}
                      placeholder='{"mode":"shadow"}'
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void submitDraft()} disabled={saving}>
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : selectedFlag ? "Save Changes" : "Create Flag"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(buildDraft(selectedFlag, environment));
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                {selectedFlag && (
                  <Button
                    variant={selectedFlag.archived_at ? "secondary" : "destructive"}
                    onClick={() => void updateArchiveState(!selectedFlag.archived_at)}
                    disabled={saving}
                  >
                    <Archive className="h-4 w-4" />
                    {selectedFlag.archived_at ? "Restore" : "Archive"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Preview</CardTitle>
                  <CardDescription>
                    Stored resolution output for the selected environment.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshPreview(selectedFlag?.key ?? null)}
                  disabled={!selectedFlag || previewLoading}
                >
                  <Eye className="h-4 w-4" />
                  {previewLoading ? "Refreshing..." : "Refresh Preview"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!selectedFlag ? (
                <p className="text-sm text-muted-foreground">
                  Create or select a flag to preview its resolved output.
                </p>
              ) : previewError ? (
                <p className="text-sm text-red-600">{previewError}</p>
              ) : preview ? (
                <pre className="overflow-x-auto rounded-md border border-border/80 bg-muted/30 p-3 text-xs text-foreground">
                  {JSON.stringify(preview.flags[selectedFlag.key] ?? null, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No preview available yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
