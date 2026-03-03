import Link from "next/link";
import { AlertCircle, BookOpen, GitBranch, ImageIcon, Link2, UserCircle2 } from "lucide-react";
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
};

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

const draftMessagePreview = (role: string, content: string): string => {
  if (role !== "assistant") return truncate(content, 200);
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return truncate(content, 200);
    const envelope = parsed as { assistant_reply?: unknown; recipe?: { title?: unknown } };
    const assistantReply = normalizeAssistantReply(envelope.assistant_reply);
    const recipeTitle = typeof envelope.recipe?.title === "string" ? envelope.recipe.title.trim() : "";
    if (assistantReply && recipeTitle) return truncate(`${assistantReply} (recipe: ${recipeTitle})`, 200);
    if (assistantReply) return truncate(assistantReply, 200);
    if (recipeTitle) return truncate(`Updated recipe: ${recipeTitle}`, 200);
  } catch {
    return truncate(content, 200);
  }
  return truncate(content, 200);
};

const buildRecipesHref = (params: { q?: string; recipe?: string }): string => {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.recipe?.trim()) query.set("recipe", params.recipe.trim());
  const queryString = query.toString();
  return queryString.length > 0 ? `/recipes?${queryString}` : "/recipes";
};

const shortId = (value: string): string => {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

const imageStatusBadgeClass = (status: string): string => {
  if (status === "ready") return "border-emerald-300/60 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-300/60 bg-red-50 text-red-700";
  return "border-amber-300/60 bg-amber-50 text-amber-700";
};

export default async function RecipesPage({
  searchParams
}: {
  searchParams: Promise<RecipesPageSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const requestedRecipeId = typeof params.recipe === "string" ? params.recipe : "";

  const { rows, totals } = await getRecipeAuditIndexData(q);
  const selectedRecipeId = requestedRecipeId || rows[0]?.id;
  const detail = selectedRecipeId ? await getRecipeAuditDetail(selectedRecipeId) : null;
  const unresolvedOwners = rows.filter((row) => !row.owner_email).length;

  return (
    <div className="space-y-4">
      {/* Header row with inline totals */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Recipes Console"
          description="Inventory, version lineage, prompt trail, attachment graph, and changelog."
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline" className="gap-1">
            <BookOpen className="h-3 w-3" /> {totals.recipes} recipes
          </Badge>
          <Badge variant="outline" className="gap-1">
            <GitBranch className="h-3 w-3" /> {totals.versions} versions
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Link2 className="h-3 w-3" /> {totals.attachments} attachments
          </Badge>
          <Badge variant="outline" className="gap-1">
            <UserCircle2 className="h-3 w-3" /> {totals.saves} saves
          </Badge>
        </div>
      </div>

      {unresolvedOwners > 0 && (
        <Alert className="border-amber-300/60 bg-amber-50/70">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-amber-900">Owner profiles need backfill</AlertTitle>
          <AlertDescription className="text-amber-800">
            {unresolvedOwners} recipes have user IDs with no email metadata in `users`.
          </AlertDescription>
        </Alert>
      )}

      {/* Two-column split layout */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr] items-start">
        {/* Recipe List — sticky scrollable */}
        <Card className="sticky top-0">
          <CardHeader className="pb-2">
            <form action="/recipes" method="get" className="flex gap-2">
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search recipes…"
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" className="h-8 px-3">
                Search
              </Button>
              {q && (
                <Link href="/recipes">
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2">
                    ✕
                  </Button>
                </Link>
              )}
            </form>
          </CardHeader>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No recipes match.</p>
            ) : (
              rows.map((row) => (
                <Link key={row.id} href={buildRecipesHref({ q, recipe: row.id })}>
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
                        <p className="truncate text-sm font-medium">{row.title}</p>
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
                      <span>{row.version_count}v</span>
                      <span>{row.save_count} saves</span>
                      <span>{row.attachment_count} att</span>
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
                      <CardTitle className="text-base">{detail.recipe.title}</CardTitle>
                      <CardDescription>
                        {detail.recipe.owner_email ?? "Unknown owner"} · {detail.recipe.visibility}
                      </CardDescription>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail.recipe.id}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
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
                  {detail.recipe.source_draft_id && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Draft: <span className="font-mono">{shortId(detail.recipe.source_draft_id)}</span>
                      </span>
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
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="prompts">
                    Prompts
                    {detail.draft_messages.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">
                        {detail.draft_messages.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="causality">Revision Map</TabsTrigger>
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

                {/* Prompts */}
                <TabsContent value="prompts">
                  <Card>
                    <CardContent className="p-0">
                      {detail.draft_messages.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          No draft messages captured for this recipe.
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
                            {detail.draft_messages.map((message) => (
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
                                  {draftMessagePreview(message.role, message.content)}
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
                                    <p className="text-sm">{attachment.child_recipe_title ?? "Untitled"}</p>
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
                                        ? "border-emerald-300/60 bg-emerald-50 text-emerald-700 text-xs"
                                        : item.action === "delete"
                                          ? "border-red-300/60 bg-red-50 text-red-700 text-xs"
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
