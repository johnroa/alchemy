import Link from "next/link";
import { AlertCircle, BookOpen, ImageIcon, Network } from "lucide-react";
import { DeltaBadge, deltaFromWindow } from "@/components/admin/delta-badge";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { PageHeader } from "@/components/admin/page-header";
import { RevertVersionDialog } from "@/components/admin/revert-version-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRecipeAuditDetail, getRecipeAuditIndexData } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

type RecipesPageSearchParams = {
  q?: string;
  recipe?: string;
  status?: string;
  sort?: string;
};

type RecipeStatusFilter = "all" | "ready" | "pending" | "failed";
type RecipeSortOrder =
  | "updated_desc"
  | "updated_asc"
  | "title_asc"
  | "title_desc"
  | "versions_desc"
  | "saves_desc";

const truncate = (value: string, max = 280): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const normalizeAssistantReply = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const reply = (value as { text?: unknown }).text;
    if (typeof reply === "string" && reply.trim().length > 0) return reply.trim();
  }
  return null;
};

const chatMessagePreview = (role: string, content: string): string => {
  if (role !== "assistant") return truncate(content, 200);
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return truncate(content, 200);
    const envelope = parsed as {
      assistant_reply?: unknown;
      recipe?: { title?: unknown };
      candidate_recipe_set?: { components?: unknown[] };
      loop_state?: unknown;
    };
    const assistantReply = normalizeAssistantReply(envelope.assistant_reply);
    const recipeTitle = typeof envelope.recipe?.title === "string" ? envelope.recipe.title.trim() : "";
    const componentCount = Array.isArray(envelope.candidate_recipe_set?.components)
      ? envelope.candidate_recipe_set.components.length
      : 0;
    if (assistantReply && componentCount > 0) {
      return truncate(`${assistantReply} (candidate tabs: ${componentCount})`, 200);
    }
    if (assistantReply && recipeTitle) return truncate(`${assistantReply} (recipe: ${recipeTitle})`, 200);
    if (assistantReply) return truncate(assistantReply, 200);
    if (recipeTitle) return truncate(`Updated recipe: ${recipeTitle}`, 200);
  } catch {
    return truncate(content, 200);
  }
  return truncate(content, 200);
};

const buildRecipesHref = (params: {
  q?: string;
  recipe?: string;
  status?: RecipeStatusFilter;
  sort?: RecipeSortOrder;
}): string => {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.recipe?.trim()) query.set("recipe", params.recipe.trim());
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.sort && params.sort !== "updated_desc") query.set("sort", params.sort);
  const queryString = query.toString();
  return queryString.length > 0 ? `/recipes?${queryString}` : "/recipes";
};

const STATUS_OPTIONS: Array<{ value: RecipeStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "ready", label: "Ready images" },
  { value: "pending", label: "Pending images" },
  { value: "failed", label: "Failed images" }
];

const SORT_OPTIONS: Array<{ value: RecipeSortOrder; label: string }> = [
  { value: "updated_desc", label: "Updated ↓" },
  { value: "updated_asc", label: "Updated ↑" },
  { value: "title_asc", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
  { value: "versions_desc", label: "Versions ↓" },
  { value: "saves_desc", label: "Saves ↓" }
];

const parseStatusFilter = (value: string | undefined): RecipeStatusFilter => {
  if (value === "ready" || value === "pending" || value === "failed") {
    return value;
  }
  return "all";
};

const parseSortOrder = (value: string | undefined): RecipeSortOrder => {
  if (
    value === "updated_asc" ||
    value === "title_asc" ||
    value === "title_desc" ||
    value === "versions_desc" ||
    value === "saves_desc"
  ) {
    return value;
  }
  return "updated_desc";
};

const isInWindow = (value: string, start: number, end: number): boolean => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= start && timestamp < end;
};

const windowDelta = deltaFromWindow;

const shortId = (value: string): string => {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

const toPercent = (value: number): string => `${value.toFixed(1)}%`;

const imageStatusBadgeClass = (status: string): string => {
  if (status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-300 bg-red-50 text-red-700";
  return "border-amber-300 bg-amber-50 text-amber-700";
};

const getContextLoopState = (context: Record<string, unknown> | undefined): string | null => {
  const value = context?.["loop_state"];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const getContextCandidateSummary = (context: Record<string, unknown> | undefined): { revision: number; components: number } | null => {
  const candidate = context?.["candidate_recipe_set"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const revision = Number((candidate as { revision?: unknown }).revision);
  const components = Array.isArray((candidate as { components?: unknown[] }).components)
    ? (candidate as { components: unknown[] }).components.length
    : 0;

  return {
    revision: Number.isFinite(revision) ? Math.trunc(revision) : 0,
    components
  };
};

export default async function RecipesPage({
  searchParams
}: {
  searchParams: Promise<RecipesPageSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const requestedRecipeId = typeof params.recipe === "string" ? params.recipe : "";
  const status = parseStatusFilter(typeof params.status === "string" ? params.status : undefined);
  const sort = parseSortOrder(typeof params.sort === "string" ? params.sort : undefined);

  const { rows, totals } = await getRecipeAuditIndexData(q);
  const filteredRows = rows.filter((row) => (status === "all" ? true : row.image_status === status));
  const sortedRows = [...filteredRows].sort((left, right) => {
    if (sort === "updated_desc") return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    if (sort === "updated_asc") return Date.parse(left.updated_at) - Date.parse(right.updated_at);
    if (sort === "title_asc") return left.title.localeCompare(right.title);
    if (sort === "title_desc") return right.title.localeCompare(left.title);
    if (sort === "versions_desc") return right.version_count - left.version_count;
    if (sort === "saves_desc") return right.save_count - left.save_count;
    return 0;
  });

  const selectedRecipeId = sortedRows.some((row) => row.id === requestedRecipeId)
    ? requestedRecipeId
    : sortedRows[0]?.id;
  const detail = selectedRecipeId ? await getRecipeAuditDetail(selectedRecipeId) : null;
  const unresolvedOwners = sortedRows.filter((row) => !row.owner_email).length;
  const loopState = detail?.chat ? getContextLoopState(detail.chat.context) : null;
  const candidateSummary = detail?.chat ? getContextCandidateSummary(detail.chat.context) : null;

  const shownRecipeCount = sortedRows.length;
  const readyImageCount = sortedRows.filter((row) => row.image_status === "ready").length;
  const failedImageCount = sortedRows.filter((row) => row.image_status === "failed").length;
  const pendingImageCount = sortedRows.filter((row) => row.image_status === "pending").length;
  const avgVersionsPerRecipe = shownRecipeCount > 0
    ? sortedRows.reduce((sum, row) => sum + row.version_count, 0) / shownRecipeCount
    : 0;
  const attachmentDensity = shownRecipeCount > 0
    ? sortedRows.reduce((sum, row) => sum + row.attachment_count, 0) / shownRecipeCount
    : 0;
  const chatBackedRate = totals.recipes > 0 ? (totals.chatBacked / totals.recipes) * 100 : 0;
  const readyImageRate = shownRecipeCount > 0 ? (readyImageCount / shownRecipeCount) * 100 : 0;
  const failedImageRate = shownRecipeCount > 0 ? (failedImageCount / shownRecipeCount) * 100 : 0;

  const now = Date.now();
  const currentWindowStart = now - 24 * 60 * 60 * 1000;
  const previousWindowStart = now - 48 * 60 * 60 * 1000;
  const newRecipesDelta = windowDelta(
    sortedRows.filter((row) => isInWindow(row.created_at, currentWindowStart, now)).length,
    sortedRows.filter((row) => isInWindow(row.created_at, previousWindowStart, currentWindowStart)).length
  );
  const updatedRecipesDelta = windowDelta(
    sortedRows.filter((row) => isInWindow(row.updated_at, currentWindowStart, now)).length,
    sortedRows.filter((row) => isInWindow(row.updated_at, previousWindowStart, currentWindowStart)).length
  );
  const failedRecipesDelta = windowDelta(
    sortedRows.filter((row) => row.image_status === "failed" && isInWindow(row.updated_at, currentWindowStart, now)).length,
    sortedRows.filter((row) => row.image_status === "failed" && isInWindow(row.updated_at, previousWindowStart, currentWindowStart)).length
  );

  const metricCards: Array<{
    label: string;
    value: string;
    hint: string;
    progress: number;
    warning?: boolean;
  }> = [
    {
      label: "Recipes",
      value: shownRecipeCount.toLocaleString(),
      hint: `${totals.recipes.toLocaleString()} total indexed`,
      progress: totals.recipes > 0 ? shownRecipeCount / totals.recipes : 0
    },
    {
      label: "Avg Versions",
      value: avgVersionsPerRecipe.toFixed(2),
      hint: `${totals.versions.toLocaleString()} versions total`,
      progress: Math.min(1, avgVersionsPerRecipe / 4)
    },
    {
      label: "Chat-backed",
      value: toPercent(chatBackedRate),
      hint: `${totals.chatBacked.toLocaleString()} recipes linked to chats`,
      progress: chatBackedRate / 100
    },
    {
      label: "Ready Image Rate",
      value: toPercent(readyImageRate),
      hint: `${readyImageCount} ready · ${pendingImageCount} pending · ${failedImageCount} failed`,
      progress: readyImageRate / 100,
      warning: readyImageRate < 70
    },
    {
      label: "Attachment Density",
      value: attachmentDensity.toFixed(2),
      hint: `${totals.attachments.toLocaleString()} linked recipes`,
      progress: Math.min(1, attachmentDensity)
    },
    {
      label: "Failed Image Rate",
      value: toPercent(failedImageRate),
      hint: `${failedImageCount} failed image states`,
      progress: failedImageRate / 100,
      warning: failedImageRate > 0
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Recipes Console"
          description="Inventory, version lineage, prompt trail, attachment graph, and changelog."
          icon={<EntityTypeIcon entityType="recipe" className="h-6 w-6" />}
        />
        <Badge variant="outline" className="font-mono text-xs">
          Showing {shownRecipeCount} / {totals.recipes}
        </Badge>
      </div>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Coverage Snapshot</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((metric) => (
            <Card
              key={metric.label}
              className={cn(
                "transition-colors",
                metric.warning
                  ? "border-amber-200 bg-amber-50"
                  : metric.progress >= 0.7
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-zinc-200"
              )}
            >
              <CardHeader className="pb-2">
                <CardDescription className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{metric.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{metric.value}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-xs text-muted-foreground">{metric.hint}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      metric.warning ? "bg-amber-500" : metric.progress >= 0.7 ? "bg-emerald-500" : "bg-zinc-500"
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, metric.progress * 100))}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          Velocity (Last 24h vs Prior 24h)
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>New Recipes</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{newRecipesDelta.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={newRecipesDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Updated Recipes</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{updatedRecipesDelta.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={updatedRecipesDelta} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed Image Changes</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{failedRecipesDelta.current}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeltaBadge delta={failedRecipesDelta} positiveIsGood={false} />
            </CardContent>
          </Card>
        </div>
      </section>

      {unresolvedOwners > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Owner profiles need backfill</AlertTitle>
          <AlertDescription className="text-amber-800">
            {unresolvedOwners} recipes have user IDs with no email metadata in `users`.
          </AlertDescription>
        </Alert>
      )}

      {/* Two-column split layout */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(420px,38%)_minmax(0,1fr)] 2xl:grid-cols-[minmax(460px,40%)_minmax(0,1fr)]">
        {/* Recipe List — sticky scrollable */}
        <Card className="sticky top-0">
          <CardHeader className="space-y-3 pb-2">
            <form action="/recipes" method="get" className="flex gap-2">
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search recipes…"
                className="h-8 text-sm"
              />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="sort" value={sort} />
              <Button type="submit" size="sm" className="h-8 px-3">
                Search
              </Button>
              {q && (
                <Link href={buildRecipesHref({ status, sort })}>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2">
                    ✕
                  </Button>
                </Link>
              )}
            </form>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {STATUS_OPTIONS.map((option) => (
                  <Link
                    key={option.value}
                    href={buildRecipesHref({ q, status: option.value, sort })}
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "cursor-pointer text-[10px]",
                        status === option.value && "border-primary/60 bg-primary/10 text-primary"
                      )}
                    >
                      {option.label}
                    </Badge>
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {SORT_OPTIONS.map((option) => (
                  <Link
                    key={option.value}
                    href={buildRecipesHref({ q, status, sort: option.value })}
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "cursor-pointer text-[10px]",
                        sort === option.value && "border-primary/60 bg-primary/10 text-primary"
                      )}
                    >
                      {option.label}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          </CardHeader>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
            {sortedRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No recipes match.</p>
            ) : (
              sortedRows.map((row) => (
                <Link key={row.id} href={buildRecipesHref({ q, recipe: row.id, status, sort })}>
                  <div
                    className={cn(
                      "border-b px-4 py-3 transition-colors hover:bg-zinc-50",
                      detail?.recipe.id === row.id
                        ? "border-l-2 border-l-primary bg-primary/5"
                        : "border-l-2 border-l-transparent"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="inline-flex max-w-full items-center gap-1.5 truncate text-sm font-semibold">
                          <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5 flex-none" />
                          <span className="truncate">{row.title}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.owner_email ?? "No owner"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("flex-none text-[10px]", imageStatusBadgeClass(row.image_status))}
                      >
                        <ImageIcon className="mr-1 h-2.5 w-2.5" />
                        {row.image_status}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                      <span>{row.version_count} versions</span>
                      <span>{row.save_count} saves</span>
                      <span>{row.attachment_count} links</span>
                      <span className="ml-auto">{new Date(row.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Deep Audit Panel */}
        <div>
          {!detail ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
                <BookOpen className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">Select a recipe to inspect</p>
                <p className="text-xs text-muted-foreground/60">
                  Click any recipe from the list to view its full audit trail.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Recipe meta header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="inline-flex items-center gap-2 text-base">
                        <EntityTypeIcon entityType="recipe" className="h-4 w-4" />
                        {detail.recipe.title}
                      </CardTitle>
                      <CardDescription>
                        {detail.recipe.owner_email ?? "Unknown owner"} · {detail.recipe.visibility}
                      </CardDescription>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail.recipe.id}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={`/graph?recipe=${detail.recipe.id}`}>
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                          <Network className="h-3 w-3" />
                          Open in Graph
                        </Button>
                      </Link>
                      <Badge variant="outline" className={imageStatusBadgeClass(detail.recipe.image_status)}>
                        <ImageIcon className="mr-1 h-3 w-3" />
                        {detail.recipe.image_status}
                      </Badge>
                      <Badge variant="secondary">{detail.versions.length} versions</Badge>
                      {detail.attachments.length > 0 && (
                        <Badge variant="secondary">{detail.attachments.length} attachments</Badge>
                      )}
                    </div>
                  </div>
                  {detail.recipe.source_chat_id && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Chat: <span className="font-mono">{shortId(detail.recipe.source_chat_id)}</span>
                      </span>
                      {loopState && (
                        <span>
                          Loop: <span className="font-medium">{loopState}</span>
                        </span>
                      )}
                      {candidateSummary && (
                        <span>
                          Candidate: <span className="font-medium">rev {candidateSummary.revision || 0} · {candidateSummary.components} tabs</span>
                        </span>
                      )}
                      {detail.recipe.current_version_id && (
                        <span>
                          Current: <span className="font-mono">{shortId(detail.recipe.current_version_id)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </CardHeader>
              </Card>

              {/* Tabs */}
              <Tabs defaultValue="timeline" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="prompts">
                    Chat Thread
                    {detail.chat_messages.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">
                        {detail.chat_messages.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="causality">Revision Map</TabsTrigger>
                  <TabsTrigger value="canonical">Canonical Ingredients</TabsTrigger>
                  <TabsTrigger value="changes">
                    Changelog
                    {detail.changelog.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">
                        {detail.changelog.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Timeline */}
                <TabsContent value="timeline">
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Version</TableHead>
                            <TableHead>Parent</TableHead>
                            <TableHead>Summary</TableHead>
                            <TableHead>Shape</TableHead>
                            <TableHead>Event</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="text-right">Revert</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.versions.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                No versions found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            detail.versions.map((version, index) => (
                              <TableRow key={version.id}>
                                <TableCell>
                                  <div>
                                    <p className="text-xs font-medium">v{index + 1}</p>
                                    <p className="font-mono text-[10px] text-muted-foreground">{shortId(version.id)}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {version.parent_version_id ? shortId(version.parent_version_id) : <span className="italic">root</span>}
                                </TableCell>
                                <TableCell className="max-w-[220px] text-xs">
                                  {truncate(version.diff_summary ?? "—", 80)}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {version.ingredient_count}i · {version.step_count}s
                                </TableCell>
                                <TableCell>
                                  {version.event_type ? (
                                    <Badge variant="outline" className="text-[10px]">{version.event_type}</Badge>
                                  ) : <span className="text-xs text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(version.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <RevertVersionDialog recipeId={detail.recipe.id} versionId={version.id} />
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Chat Thread */}
                <TabsContent value="prompts">
                  <Card>
                    <CardContent className="p-0">
                      {detail.chat_messages.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          No chat messages captured for this recipe.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-40">When</TableHead>
                              <TableHead className="w-24">Role</TableHead>
                              <TableHead>Message</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.chat_messages.map((message) => (
                              <TableRow key={message.id}>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(message.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={message.role === "user" ? "default" : "outline"}
                                    className={message.role === "assistant" ? "border-violet-300 bg-violet-50 text-violet-700" : undefined}
                                  >
                                    {message.role}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {chatMessagePreview(message.role, message.content)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Revision Map */}
                <TabsContent value="causality">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Version Lineage</CardTitle>
                        <CardDescription>Parent-child chain of all revisions.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {detail.versions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No lineage.</p>
                        ) : (
                          detail.versions.map((version, index) => (
                            <div key={version.id} className="rounded-md border p-2 text-sm">
                              <div className="flex items-center justify-between">
                                <p className="font-medium">v{index + 1}</p>
                                {version.event_type && (
                                  <Badge variant="outline" className="text-[10px]">{version.event_type}</Badge>
                                )}
                              </div>
                              <p className="font-mono text-xs text-muted-foreground">{shortId(version.id)}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                ↖ {version.parent_version_id ? shortId(version.parent_version_id) : "root"}
                              </p>
                              {version.request_id && (
                                <p className="text-xs text-muted-foreground">req: {shortId(version.request_id)}</p>
                              )}
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Attachment Graph</CardTitle>
                        <CardDescription>Linked sides, appetizers, and desserts.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Relation</TableHead>
                              <TableHead>Child Recipe</TableHead>
                              <TableHead>#</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.attachments.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                                  No attachments.
                                </TableCell>
                              </TableRow>
                            ) : (
                              detail.attachments.map((attachment) => (
                                <TableRow key={attachment.id}>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs">{attachment.relation_type}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <p className="inline-flex items-center gap-1.5 text-sm">
                                      <EntityTypeIcon entityType="recipe" className="h-3.5 w-3.5" />
                                      {attachment.child_recipe_title ?? "Untitled"}
                                    </p>
                                    <p className="font-mono text-[10px] text-muted-foreground">
                                      {shortId(attachment.child_recipe_id)}
                                    </p>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary">#{attachment.position}</Badge>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Canonical Ingredients */}
                <TabsContent value="canonical">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                      <div>
                        <CardTitle className="text-sm">Canonical Ingredient Rows</CardTitle>
                        <CardDescription>
                          Source and normalized measurements persisted for current recipe version.
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="font-mono text-xs">
                        {detail.canonical_ingredients.length} rows
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Canonical</TableHead>
                            <TableHead>Normalized (SI)</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Grouping</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.canonical_ingredients.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                                No canonical ingredient rows for current version.
                              </TableCell>
                            </TableRow>
                          ) : (
                            detail.canonical_ingredients.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>
                                  <Badge variant="secondary" className="text-[10px]">#{row.position + 1}</Badge>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <p className="font-medium">{row.source_name}</p>
                                  <p className="text-muted-foreground">
                                    {row.source_amount ?? "?"} {row.source_unit ?? ""}
                                  </p>
                                </TableCell>
                                <TableCell className="text-xs">
                                  {row.canonical_name ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <EntityTypeIcon
                                        entityType="ingredient"
                                        canonicalName={row.canonical_name}
                                        className="h-3.5 w-3.5"
                                      />
                                      {row.canonical_name}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">Unresolved</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {row.normalized_amount_si != null ? (
                                    <span>
                                      {row.normalized_amount_si} {row.normalized_unit}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">needs retry</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      row.normalized_status === "normalized"
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px]"
                                        : "border-amber-300 bg-amber-50 text-amber-700 text-[10px]"
                                    }
                                  >
                                    {row.normalized_status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  <span>{row.category ?? "Other"}</span>
                                  <span className="mx-1">·</span>
                                  <span>{row.component ?? "Main"}</span>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Changelog */}
                <TabsContent value="changes">
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Scope</TableHead>
                            <TableHead>Entity</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Request</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.changelog.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                                No changelog entries found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            detail.changelog.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(item.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{item.scope}</Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {item.entity_type}
                                  {item.entity_id ? `:${item.entity_id.slice(0, 6)}` : ""}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      item.action === "create"
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 text-xs"
                                        : item.action === "delete"
                                          ? "border-red-300 bg-red-50 text-red-700 text-xs"
                                          : "text-xs"
                                    }
                                  >
                                    {item.action}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.request_id ? shortId(item.request_id) : "—"}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
