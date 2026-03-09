"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Radar, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EventRow = {
  id: string;
  request_id: string | null;
  event_type: string;
  created_at: string;
  safety_state: string | null;
  latency_ms: number | null;
  event_payload: Record<string, unknown>;
};

type TraceEvent = {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  latency_ms: number | null;
  safety_state: string | null;
  created_at: string;
};

type TraceChange = {
  id: string;
  scope: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
};

type TracePayload = {
  events?: TraceEvent[];
  changes?: TraceChange[];
  error?: string;
};

const extractPayloadInfo = (payload: Record<string, unknown>): {
  scope: string | null;
  route: string | null;
  model: string | null;
  provider: string | null;
  error: string | null;
  error_code: string | null;
  latency: number | null;
  cost: number | null;
  context_load_ms: number | null;
  memory_retrieval_ms: number | null;
  llm_ms: number | null;
  recovery_path: string | null;
  cache_hit: boolean | null;
  generation_reused_context: boolean | null;
} => ({
  scope: (payload["scope"] as string | undefined) ?? null,
  route: (payload["route"] as string | undefined) ?? null,
  model: (payload["model"] as string | undefined) ?? null,
  provider: (payload["provider"] as string | undefined) ?? null,
  error: (payload["error"] as string | undefined) ?? (payload["error_message"] as string | undefined) ?? null,
  error_code: (payload["error_code"] as string | undefined) ?? null,
  latency: payload["latency_ms"] != null ? Number(payload["latency_ms"]) : null,
  cost: payload["cost_usd"] != null ? Number(payload["cost_usd"]) : null,
  context_load_ms: payload["context_load_ms"] != null ? Number(payload["context_load_ms"]) : null,
  memory_retrieval_ms: payload["memory_retrieval_ms"] != null ? Number(payload["memory_retrieval_ms"]) : null,
  llm_ms: payload["llm_ms"] != null ? Number(payload["llm_ms"]) : null,
  recovery_path: (payload["recovery_path"] as string | undefined) ?? null,
  cache_hit: typeof payload["cache_hit"] === "boolean" ? Boolean(payload["cache_hit"]) : null,
  generation_reused_context:
    typeof payload["generation_reused_context"] === "boolean"
      ? Boolean(payload["generation_reused_context"])
      : null
});

const isError = (event: EventRow): boolean =>
  !!event.safety_state && event.safety_state !== "ok" && event.safety_state !== "pass";

function EventPayloadDetail({ payload }: { payload: Record<string, unknown> }): React.JSX.Element {
  const info = extractPayloadInfo(payload);
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-zinc-50 p-3 text-xs">
      {(info.scope || info.route || info.model || info.provider) && (
        <div className="flex flex-wrap gap-3 text-muted-foreground">
          {info.route && <span><span className="font-medium text-foreground">route</span> {info.route}</span>}
          {info.scope && <span><span className="font-medium text-foreground">scope</span> {info.scope}</span>}
          {info.provider && <span><span className="font-medium text-foreground">provider</span> {info.provider}</span>}
          {info.model && <span><span className="font-medium text-foreground">model</span> {info.model}</span>}
          {info.latency && <span><span className="font-medium text-foreground">latency</span> {info.latency.toLocaleString()}ms</span>}
          {info.cost != null && info.cost > 0 && (
            <span><span className="font-medium text-foreground">cost</span> ${info.cost.toFixed(4)}</span>
          )}
        </div>
      )}
      {(info.context_load_ms != null || info.memory_retrieval_ms != null || info.llm_ms != null || info.recovery_path || info.cache_hit != null || info.generation_reused_context != null) && (
        <div className="flex flex-wrap gap-3 text-muted-foreground">
          {info.context_load_ms != null && (
            <span><span className="font-medium text-foreground">context</span> {info.context_load_ms.toLocaleString()}ms</span>
          )}
          {info.memory_retrieval_ms != null && (
            <span><span className="font-medium text-foreground">memory</span> {info.memory_retrieval_ms.toLocaleString()}ms</span>
          )}
          {info.llm_ms != null && (
            <span><span className="font-medium text-foreground">llm</span> {info.llm_ms.toLocaleString()}ms</span>
          )}
          {info.recovery_path && (
            <span><span className="font-medium text-foreground">recovery</span> {info.recovery_path}</span>
          )}
          {info.cache_hit != null && (
            <span><span className="font-medium text-foreground">cache</span> {info.cache_hit ? "hit" : "miss"}</span>
          )}
          {info.generation_reused_context != null && (
            <span><span className="font-medium text-foreground">reused</span> {info.generation_reused_context ? "yes" : "no"}</span>
          )}
        </div>
      )}
      {(info.error || info.error_code) && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-red-700">
          {info.error_code && <p className="font-semibold">{info.error_code}</p>}
          {info.error && <p>{info.error}</p>}
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer select-none text-muted-foreground/60 hover:text-muted-foreground">
          Full payload
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-zinc-600">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function TraceDetail({ requestId, trace }: { requestId: string; trace: TracePayload }): React.JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggle = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalLatency = (trace.events ?? []).reduce((sum, e) => sum + (e.latency_ms ?? 0), 0);
  const hasErrors = (trace.events ?? []).some(
    (e) => e.safety_state && e.safety_state !== "ok" && e.safety_state !== "pass"
  );

  return (
    <div className="rounded-lg border bg-muted p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{requestId}</span>
        <Badge variant="outline">{trace.events?.length ?? 0} events</Badge>
        <Badge variant="outline">{trace.changes?.length ?? 0} mutations</Badge>
        {totalLatency > 0 && (
          <Badge variant="outline" className="font-mono text-xs">{totalLatency.toLocaleString()}ms</Badge>
        )}
        {hasErrors && (
          <Badge className="border-red-300 bg-red-50 text-red-700 text-xs">errors</Badge>
        )}
      </div>

      {(trace.events?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Events</p>
          {trace.events!.map((event) => {
            const isEventError = event.safety_state && event.safety_state !== "ok" && event.safety_state !== "pass";
            const info = extractPayloadInfo(event.event_payload ?? {});
            const expanded = expandedIds.has(event.id);
            return (
              <div
                key={event.id}
                className={cn(
                  "rounded-md border",
                  isEventError ? "border-red-200 bg-red-50" : "border-border bg-background"
                )}
              >
                <button
                  className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  onClick={() => toggle(event.id)}
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px]",
                      isEventError ? "border-red-300 bg-red-100 text-red-700" : ""
                    )}
                  >
                    {event.event_type}
                  </Badge>
                  {(info.scope || info.route) && <span className="text-xs text-muted-foreground">{info.route ?? info.scope}</span>}
                  {info.model && <span className="text-xs font-mono text-muted-foreground">{info.model}</span>}
                  {isEventError && (
                    <span className="text-xs font-medium text-red-600">
                      {info.error_code ?? info.error ?? event.safety_state}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground sm:ml-auto">
                    {event.latency_ms != null ? `${event.latency_ms.toLocaleString()}ms` : ""}
                  </span>
                  {expanded ? (
                    <ChevronUp className="h-3 w-3 flex-none text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3 w-3 flex-none text-muted-foreground" />
                  )}
                </button>
                {expanded && (
                  <div className="border-t px-3 pb-3 pt-2">
                    <EventPayloadDetail payload={event.event_payload ?? {}} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(trace.changes?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mutations</p>
          {trace.changes!.map((change) => (
            <div key={change.id} className="rounded-md border px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{change.scope}</Badge>
                <span className="text-muted-foreground">{change.entity_type}</span>
                <span className="font-medium">{change.action}</span>
                {change.entity_id && (
                  <span className="font-mono text-muted-foreground">{change.entity_id.slice(0, 10)}…</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RequestTraceViewer({
  recentRequestIds,
  events
}: {
  recentRequestIds: string[];
  events: EventRow[];
}): React.JSX.Element {
  const [requestId, setRequestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());

  const loadTrace = async (targetId: string): Promise<void> => {
    const trimmed = targetId.trim();
    if (!trimmed) { toast.error("Enter a request id"); return; }
    setLoading(true);
    setActiveRequestId(trimmed);
    const response = await fetch(`/api/admin/request-trace/${trimmed}`);
    const payload = (await response.json().catch(() => null)) as TracePayload | null;
    setLoading(false);
    if (!response.ok || !payload) {
      toast.error(payload?.error ?? "Could not load request trace");
      setTrace(null);
      return;
    }
    setTrace(payload);
  };

  const toggleEvent = (id: string): void => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Inspector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4 text-muted-foreground" />
            Inspect by Request ID
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={requestId}
                onChange={(e) => setRequestId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void loadTrace(requestId); }}
                placeholder="Paste or click a request ID below…"
                className="pl-9 font-mono text-sm"
              />
            </div>
            <Button onClick={() => void loadTrace(requestId)} disabled={loading || !requestId.trim()} className="sm:w-auto">
              {loading ? "Loading…" : "Inspect"}
            </Button>
          </div>

          {recentRequestIds.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Recent request IDs — click to inspect</p>
              <div className="flex flex-wrap gap-2">
                {recentRequestIds.slice(0, 8).map((id) => (
                  <button
                    key={id}
                    onClick={() => { setRequestId(id); void loadTrace(id); }}
                    className={cn(
                      "rounded border px-2 py-1 font-mono text-xs transition-colors",
                      activeRequestId === id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {id.slice(0, 16)}…
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground animate-pulse">
              Loading trace…
            </div>
          )}

          {!loading && trace && activeRequestId && (
            <TraceDetail requestId={activeRequestId} trace={trace} />
          )}
        </CardContent>
      </Card>

      {/* Events table — clickable rows */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4 text-muted-foreground" />
              Recent Gateway Events
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Click any row to inspect. Expand to see error details and payload.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {events.filter((e) => isError(e)).length} errors
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">
              {events.length} events
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-1">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No events yet.</p>
          ) : (
            events.map((event) => {
              const error = isError(event);
              const info = extractPayloadInfo(event.event_payload ?? {});
              const expanded = expandedEventIds.has(event.id);
              return (
                <div
                  key={event.id}
                  className={cn(
                    "rounded-md border",
                    error ? "border-red-200 bg-red-50" : "border-border"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3">
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleEvent(event.id)}
                      className="flex-none text-muted-foreground hover:text-foreground"
                    >
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>

                    <span className="w-full text-xs text-muted-foreground sm:w-32 sm:flex-none">
                      {new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>

                    <Badge
                      variant="outline"
                      className={cn("font-mono text-[10px]", error ? "border-red-300 bg-red-100 text-red-700" : "")}
                    >
                      {event.event_type}
                    </Badge>

                    {info.scope && (
                      <Badge variant="secondary" className="text-[10px]">{info.scope}</Badge>
                    )}

                    {info.model && (
                      <span className="font-mono text-xs text-muted-foreground">{info.model}</span>
                    )}

                    {error && (
                      <span className="flex-1 truncate text-xs font-medium text-red-600">
                        {info.error_code ?? info.error ?? event.safety_state}
                      </span>
                    )}

                    {event.latency_ms != null && (
                      <span className="font-mono text-xs text-muted-foreground sm:ml-auto sm:flex-none">
                        {event.latency_ms.toLocaleString()}ms
                      </span>
                    )}

                    {event.request_id && (
                      <button
                        onClick={() => { setRequestId(event.request_id!); void loadTrace(event.request_id!); }}
                        className={cn(
                          "flex-none rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                          activeRequestId === event.request_id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-muted text-muted-foreground hover:bg-accent"
                        )}
                      >
                        {event.request_id.slice(0, 8)}…
                      </button>
                    )}
                  </div>

                  {expanded && (
                    <div className="border-t px-3 pb-3 pt-2">
                      <EventPayloadDetail payload={event.event_payload ?? {}} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
