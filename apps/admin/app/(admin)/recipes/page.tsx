import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { RevertVersionDialog } from "@/components/admin/revert-version-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRecipeAuditDetail, getRecipeAuditIndexData } from "@/lib/admin-data";

type RecipesPageSearchParams = {
  q?: string;
  recipe?: string;
};

const truncate = (value: string, max = 280): string => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
};

const normalizeAssistantReply = (value: unknown): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const reply = (value as { text?: unknown }).text;
    if (typeof reply === "string" && reply.trim().length > 0) {
      return reply.trim();
    }
  }

  return null;
};

const draftMessagePreview = (role: string, content: string): string => {
  if (role !== "assistant") {
    return truncate(content, 260);
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return truncate(content, 260);
    }

    const envelope = parsed as {
      assistant_reply?: unknown;
      recipe?: { title?: unknown };
    };
    const assistantReply = normalizeAssistantReply(envelope.assistant_reply);
    const recipeTitle = typeof envelope.recipe?.title === "string" ? envelope.recipe.title.trim() : "";

    if (assistantReply && recipeTitle) {
      return truncate(`${assistantReply} (recipe: ${recipeTitle})`, 260);
    }

    if (assistantReply) {
      return truncate(assistantReply, 260);
    }

    if (recipeTitle) {
      return truncate(`Updated recipe: ${recipeTitle}`, 260);
    }
  } catch {
    return truncate(content, 260);
  }

  return truncate(content, 260);
};

const buildRecipesHref = (params: { q?: string; recipe?: string }): string => {
  const query = new URLSearchParams();

  if (params.q?.trim()) {
    query.set("q", params.q.trim());
  }
  if (params.recipe?.trim()) {
    query.set("recipe", params.recipe.trim());
  }

  const queryString = query.toString();
  return queryString.length > 0 ? `/recipes?${queryString}` : "/recipes";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipes Console"
        description="Full operational audit: recipe inventory, version lineage, user prompts/messages, attachment graph, and request-linked mutation history."
      />

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Recipes</CardDescription>
            <CardTitle className="text-3xl">{totals.recipes}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Versions</CardDescription>
            <CardTitle className="text-3xl">{totals.versions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Attached Recipes</CardDescription>
            <CardTitle className="text-3xl">{totals.attachments}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cookbook Saves</CardDescription>
            <CardTitle className="text-3xl">{totals.saves}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Draft-Backed Recipes</CardDescription>
            <CardTitle className="text-3xl">{totals.draftBacked}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recipe Inventory</CardTitle>
          <CardDescription>
            Every recipe record with owner, save traction, attachment count, current version metadata, and direct inspect action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action="/recipes" method="get" className="flex flex-wrap items-center gap-2">
            <Input name="q" defaultValue={q} placeholder="Search by recipe id, title, owner id, draft id..." className="max-w-xl" />
            <Button type="submit">Search</Button>
            <Link href="/recipes">
              <Button type="button" variant="outline">
                Clear
              </Button>
            </Link>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Counts</TableHead>
                <TableHead>Current Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Inspect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No recipes match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{row.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{row.owner_email ?? "unknown user"}</p>
                        <p className="font-mono text-xs text-muted-foreground">{row.owner_user_id}</p>
                      </div>
                    </TableCell>
                    <TableCell className="space-x-1">
                      <Badge variant="outline">{row.visibility}</Badge>
                      <Badge variant="secondary">{row.image_status}</Badge>
                      {row.source_draft_id ? <Badge>draft</Badge> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.version_count} versions · {row.attachment_count} attachments · {row.save_count} saves
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-mono text-xs">{row.current_version_id ?? "n/a"}</p>
                        <p className="text-xs text-muted-foreground">{truncate(row.latest_diff_summary ?? "n/a", 90)}</p>
                      </div>
                    </TableCell>
                    <TableCell>{new Date(row.updated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={buildRecipesHref({
                          q,
                          recipe: row.id
                        })}
                      >
                        <Button variant={detail?.recipe.id === row.id ? "default" : "outline"} size="sm">
                          Inspect
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipe Deep Audit</CardTitle>
          <CardDescription>
            Version timeline, user prompt trail, revision map, attachment links, and request-linked changelog for one recipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!detail ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              Select a recipe from the inventory table to inspect full lineage.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Recipe</p>
                  <p className="mt-1 text-lg font-semibold">{detail.recipe.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">{detail.recipe.id}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Owner: {detail.recipe.owner_email ?? "unknown"} · {detail.recipe.visibility} · {detail.recipe.image_status}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Draft + Current</p>
                  <p className="mt-1 text-sm">
                    Source draft: <span className="font-mono text-xs">{detail.recipe.source_draft_id ?? "n/a"}</span>
                  </p>
                  <p className="text-sm">
                    Current version: <span className="font-mono text-xs">{detail.recipe.current_version_id ?? "n/a"}</span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Created {new Date(detail.recipe.created_at).toLocaleString()} · Updated{" "}
                    {new Date(detail.recipe.updated_at).toLocaleString()}
                  </p>
                </div>
              </div>

              <Tabs defaultValue="timeline" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="prompts">Prompts</TabsTrigger>
                  <TabsTrigger value="causality">Revision Map</TabsTrigger>
                  <TabsTrigger value="changes">Changelog</TabsTrigger>
                </TabsList>

                <TabsContent value="timeline">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Diff Summary</TableHead>
                        <TableHead>Counts</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Request</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.versions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-muted-foreground">
                            No versions found for this recipe.
                          </TableCell>
                        </TableRow>
                      ) : (
                        detail.versions.map((version) => (
                          <TableRow key={version.id}>
                            <TableCell className="font-mono text-xs">{version.id}</TableCell>
                            <TableCell className="font-mono text-xs">{version.parent_version_id ?? "root"}</TableCell>
                            <TableCell>{truncate(version.diff_summary ?? "n/a", 90)}</TableCell>
                            <TableCell>{version.ingredient_count} ing · {version.step_count} steps</TableCell>
                            <TableCell>{version.event_type ?? "n/a"}</TableCell>
                            <TableCell className="font-mono text-xs">{version.request_id ?? "n/a"}</TableCell>
                            <TableCell>{new Date(version.created_at).toLocaleString()}</TableCell>
                            <TableCell className="text-right">
                              <RevertVersionDialog recipeId={detail.recipe.id} versionId={version.id} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="prompts">
                  <div className="space-y-3">
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      User message trail from draft chat is shown exactly; tweak prompts also appear in version diff summaries.
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Message Preview</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.draft_messages.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground">
                              No draft messages captured for this recipe.
                            </TableCell>
                          </TableRow>
                        ) : (
                          detail.draft_messages.map((message) => (
                            <TableRow key={message.id}>
                              <TableCell>{new Date(message.created_at).toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge variant={message.role === "user" ? "default" : "outline"}>{message.role}</Badge>
                              </TableCell>
                              <TableCell className="text-sm">{draftMessagePreview(message.role, message.content)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="causality">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Version Lineage</CardTitle>
                        <CardDescription>Parent-child map of revisions.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {detail.versions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No lineage nodes.</p>
                        ) : (
                          detail.versions.map((version, index) => (
                            <div key={version.id} className="rounded-md border p-2 text-sm">
                              <p className="font-medium">v{index + 1}</p>
                              <p className="font-mono text-xs">id: {version.id}</p>
                              <p className="font-mono text-xs">parent: {version.parent_version_id ?? "root"}</p>
                              <p className="text-xs text-muted-foreground">request: {version.request_id ?? "n/a"}</p>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Attachment Graph</CardTitle>
                        <CardDescription>Sides/appetizers/desserts linked to this main recipe.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Relation</TableHead>
                              <TableHead>Child Recipe</TableHead>
                              <TableHead>Position</TableHead>
                              <TableHead>Updated</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.attachments.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-muted-foreground">
                                  No attachments linked to this recipe.
                                </TableCell>
                              </TableRow>
                            ) : (
                              detail.attachments.map((attachment) => (
                                <TableRow key={attachment.id}>
                                  <TableCell>
                                    <Badge variant="outline">{attachment.relation_type}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <p className="text-sm">{attachment.child_recipe_title ?? "Untitled child recipe"}</p>
                                    <p className="font-mono text-xs text-muted-foreground">{attachment.child_recipe_id}</p>
                                  </TableCell>
                                  <TableCell>{attachment.position}</TableCell>
                                  <TableCell>{new Date(attachment.updated_at).toLocaleString()}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="changes">
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
                          <TableCell colSpan={5} className="text-muted-foreground">
                            No changelog entries found for this recipe and its request chain.
                          </TableCell>
                        </TableRow>
                      ) : (
                        detail.changelog.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.scope}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.entity_type}
                              {item.entity_id ? `:${item.entity_id}` : ""}
                            </TableCell>
                            <TableCell>{item.action}</TableCell>
                            <TableCell className="font-mono text-xs">{item.request_id ?? "n/a"}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
