import Link from "next/link";
import { BookOpen, ImageIcon, Network } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { RevertVersionDialog } from "@/components/admin/revert-version-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CookbookEntryRow, RecipeAuditDetail } from "@/lib/admin-data";
import { cn } from "@/lib/utils";
import {
  chatMessagePreview,
  getContextCandidateSummary,
  getContextLoopState,
  imageStatusBadgeClass,
  shortId,
  truncate,
} from "./types";
import { RecipeRenderInspector } from "./recipe-render-inspector";

type RecipeDetailPanelProps = {
  detail: RecipeAuditDetail | null;
  cookbookEntries: CookbookEntryRow[];
};

/**
 * Full audit-trail detail panel for a selected recipe. Shows a meta header card
 * plus tabbed views for timeline, chat thread, revision map, canonical
 * ingredients, cookbook entries, and changelog.
 */
export function RecipeDetailPanel({ detail, cookbookEntries }: RecipeDetailPanelProps): React.JSX.Element {
  if (!detail) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">Select a recipe to inspect</p>
          <p className="text-xs text-muted-foreground/60">
            Click any recipe from the list to view its full audit trail.
          </p>
        </CardContent>
      </Card>
    );
  }

  const loopState = detail.chat ? getContextLoopState(detail.chat.context) : null;
  const candidateSummary = detail.chat ? getContextCandidateSummary(detail.chat.context) : null;

  return (
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
                Created by {detail.recipe.owner_email ?? "Unknown"} · {detail.recipe.visibility}
              </CardDescription>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail.recipe.id}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link href={`/content/graph?recipe=${detail.recipe.id}`}>
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
          {detail.image_assignment && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Image request: <span className="font-mono">{shortId(detail.image_assignment.image_request_id)}</span>
              </span>
              <span>
                Source: <span className="font-medium">{detail.image_assignment.assignment_source ?? "pending"}</span>
              </span>
              {detail.image_assignment.asset_id && (
                <span>
                  Asset: <span className="font-mono">{shortId(detail.image_assignment.asset_id)}</span>
                </span>
              )}
              {detail.image_assignment.reused_from_recipe_id && (
                <span>
                  Reused from: <span className="font-mono">{shortId(detail.image_assignment.reused_from_recipe_id)}</span>
                </span>
              )}
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="h-auto min-w-full justify-start gap-1">
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
            <TabsTrigger value="render">Render</TabsTrigger>
            <TabsTrigger value="semantics">Semantics</TabsTrigger>
            <TabsTrigger value="cookbook">
              Cookbook
              {cookbookEntries.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {cookbookEntries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="changes">
              Changelog
              {detail.changelog.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {detail.changelog.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

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
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
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

        <TabsContent value="render">
          <RecipeRenderInspector
            recipeId={detail.recipe.id}
            cookbookEntries={cookbookEntries}
          />
        </TabsContent>

        <TabsContent value="semantics">
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Axis Coverage</CardTitle>
                <CardDescription>Canonical semantic descriptor counts by axis.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {detail.current_semantics?.axis_counts.length ? (
                  detail.current_semantics.axis_counts.map((entry) => (
                    <div key={entry.axis} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{entry.axis}</span>
                      <Badge variant="secondary">{entry.count}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No canonical semantic profile is stored on the current recipe version.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Canonical Descriptor Inventory</CardTitle>
                <CardDescription>High-confidence metadata-enrichment descriptors that now drive Explore and Cookbook chips.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Axis</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead>Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.current_semantics?.descriptors.length ? (
                      detail.current_semantics.descriptors.map((descriptor) => (
                        <TableRow key={descriptor.id}>
                          <TableCell className="font-medium">{descriptor.label}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{descriptor.axis}</TableCell>
                          <TableCell className="text-right tabular-nums">{descriptor.confidence.toFixed(2)}</TableCell>
                          <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                            {descriptor.evidence ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          No semantic descriptors stored for the current canonical version.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Cookbook — who has saved this recipe + variant status */}
        <TabsContent value="cookbook">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Variant Status</TableHead>
                    <TableHead>Derivation</TableHead>
                    <TableHead>Variant Semantics</TableHead>
                    <TableHead>Auto</TableHead>
                    <TableHead>Saved</TableHead>
                    <TableHead>Materialised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cookbookEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No cookbook entries. This recipe has not been saved by any user.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cookbookEntries.map((entry) => (
                      <TableRow key={entry.user_id}>
                        <TableCell className="text-xs">
                          {entry.user_email ?? entry.user_id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              entry.variant_status === "current" && "border-emerald-300 bg-emerald-50 text-emerald-700",
                              entry.variant_status === "stale" && "border-amber-300 bg-amber-50 text-amber-700",
                              entry.variant_status === "processing" && "border-blue-300 bg-blue-50 text-blue-700",
                              entry.variant_status === "failed" && "border-red-300 bg-red-50 text-red-700",
                              entry.variant_status === "needs_review" && "border-purple-300 bg-purple-50 text-purple-700",
                              !entry.variant_status && "text-muted-foreground"
                            )}
                          >
                            {entry.variant_status ?? "none"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.derivation_kind ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                          {entry.variant_semantic_labels.length > 0
                            ? entry.variant_semantic_labels.slice(0, 4).join(" • ")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {entry.autopersonalize ? "Yes" : "No"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entry.saved_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.last_materialized_at
                            ? new Date(entry.last_materialized_at).toLocaleString()
                            : "—"}
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
  );
}
