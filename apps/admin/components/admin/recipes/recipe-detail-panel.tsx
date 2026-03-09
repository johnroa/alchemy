import Link from "next/link";
import { AlertTriangle, BookOpen, ImageIcon, Network } from "lucide-react";
import { EntityTypeIcon } from "@/components/admin/entity-type-icon";
import { RevertVersionDialog } from "@/components/admin/revert-version-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CookbookEntryRow, RecipeAuditDetail } from "@/lib/admin-data";
import {
  chatMessagePreview,
  getContextCandidateSummary,
  getContextLoopState,
  imageStatusBadgeClass,
  shortId,
  truncate,
} from "./types";
import { CookbookCanonRetryButton } from "./cookbook-canon-retry-button";
import { RecipeRenderInspector } from "./recipe-render-inspector";
import { canonicalStatusBadgeClass, formatSourceKindLabel, variantStatusBadgeClass } from "./status";

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

        {/* Cookbook — private-first cookbook lineage */}
        <TabsContent value="cookbook">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cookbook Lineage</CardTitle>
              <CardDescription>
                Private cookbook entries linked to this canonical recipe, including canonization state, variant ancestry, and retry controls.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {cookbookEntries.length === 0 ? (
                <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  No cookbook entries. This recipe has not been saved by any user.
                </div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {cookbookEntries.map((entry) => (
                    <AccordionItem key={entry.id} value={entry.id}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex w-full flex-col gap-3 pr-4 text-left md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold">
                                {entry.private_title ?? detail.recipe.title}
                              </p>
                              <Badge variant="outline" className={canonicalStatusBadgeClass(entry.canonical_status)}>
                                canon {entry.canonical_status}
                              </Badge>
                              <Badge variant="outline" className={variantStatusBadgeClass(entry.variant_status)}>
                                {entry.variant_status ?? "no variant"}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px]">
                                {formatSourceKindLabel(entry.source_kind)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {entry.user_email ?? entry.user_id.slice(0, 8)}
                              {entry.private_summary ? ` · ${truncate(entry.private_summary, 120)}` : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              entry {shortId(entry.id)}
                            </Badge>
                            {entry.variant_id && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                variant {shortId(entry.variant_id)}
                              </Badge>
                            )}
                            <span>{new Date(entry.updated_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4">
                        {entry.canonical_failure_reason && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>{entry.canonical_failure_reason}</span>
                            </div>
                          </div>
                        )}

                        {entry.adaptation_summary && (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                            {entry.adaptation_summary}
                          </div>
                        )}

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-md border px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Cookbook Entry
                            </p>
                            <div className="mt-2 space-y-1 text-sm">
                              <p className="font-mono text-[11px]">{entry.id}</p>
                              <p>Saved {new Date(entry.saved_at).toLocaleString()}</p>
                              <p>Updated {new Date(entry.updated_at).toLocaleString()}</p>
                              <p>Auto-personalize {entry.autopersonalize ? "on" : "off"}</p>
                            </div>
                          </div>

                          <div className="rounded-md border px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Canon Linkage
                            </p>
                            <div className="mt-2 space-y-1 text-sm">
                              <p>Status: {entry.canonical_status}</p>
                              <p>Recipe: {entry.canonical_recipe_id ? shortId(entry.canonical_recipe_id) : "pending"}</p>
                              <p>Attempted: {entry.canonical_attempted_at ? new Date(entry.canonical_attempted_at).toLocaleString() : "—"}</p>
                              <p>Ready: {entry.canonical_ready_at ? new Date(entry.canonical_ready_at).toLocaleString() : "—"}</p>
                              <p>Failed: {entry.canonical_failed_at ? new Date(entry.canonical_failed_at).toLocaleString() : "—"}</p>
                            </div>
                          </div>

                          <div className="rounded-md border px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Private Variant
                            </p>
                            <div className="mt-2 space-y-1 text-sm">
                              <p>ID: {entry.variant_id ? shortId(entry.variant_id) : "—"}</p>
                              <p>Version: {entry.variant_version_id ? shortId(entry.variant_version_id) : "—"}</p>
                              <p>Status: {entry.variant_status ?? "none"}</p>
                              <p>Derivation: {entry.derivation_kind ?? "—"}</p>
                              <p>Seed: {entry.seed_origin ?? "—"}</p>
                              <p>Materialized: {entry.last_materialized_at ? new Date(entry.last_materialized_at).toLocaleString() : "—"}</p>
                            </div>
                          </div>
                        </div>

                        <Separator />

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Traceability
                            </p>
                            <div className="space-y-1 text-sm text-muted-foreground">
                              <p>Chat: {entry.source_chat_id ? shortId(entry.source_chat_id) : "—"}</p>
                              <p>Source kind: {formatSourceKindLabel(entry.source_kind)}</p>
                              <p>Source canonical version: {entry.source_canonical_version_id ? shortId(entry.source_canonical_version_id) : "—"}</p>
                              <p>Preference fingerprint: {entry.preference_fingerprint ? shortId(entry.preference_fingerprint) : "—"}</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Preview Image
                            </p>
                            <div className="space-y-1 text-sm text-muted-foreground">
                              <Badge variant="outline" className={imageStatusBadgeClass(entry.preview_image_status)}>
                                {entry.preview_image_status}
                              </Badge>
                              {entry.preview_image_url ? (
                                <Link
                                  href={entry.preview_image_url}
                                  className="block break-all text-xs underline-offset-2 hover:underline"
                                >
                                  {entry.preview_image_url}
                                </Link>
                              ) : (
                                <p>—</p>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Semantics
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {entry.variant_semantic_labels.length > 0 ? (
                                entry.variant_semantic_labels.slice(0, 8).map((label) => (
                                  <Badge key={`${entry.id}-${label}`} variant="secondary" className="text-[10px]">
                                    {label}
                                  </Badge>
                                ))
                              ) : (
                                <p className="text-sm text-muted-foreground">No variant semantic labels.</p>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <CookbookCanonRetryButton
                            entryId={entry.id}
                            disabled={entry.canonical_status === "processing"}
                          />
                          {entry.canonical_recipe_id && (
                            <Link href={`/content/recipes?recipe=${encodeURIComponent(entry.canonical_recipe_id)}`}>
                              <Button variant="outline" size="sm">
                                Open canonical
                              </Button>
                            </Link>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
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
