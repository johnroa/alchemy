-- ============================================================================
-- 0051_pipeline_observability.sql
--
-- Adds an RPC for aggregated LLM pipeline observability metrics.
-- Designed for the admin dashboard — surfaces latency, cost, failure rate,
-- token usage, and stale variant counts across all pipeline scopes.
--
-- Does NOT create new tables — aggregates from existing events table
-- and user_recipe_variants.
-- ============================================================================

create or replace function public.get_pipeline_observability_stats(
  p_hours int default 24
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_since timestamptz := now() - (p_hours || ' hours')::interval;
  v_result jsonb;
begin
  -- Aggregate LLM call stats from events table, grouped by scope.
  with scope_stats as (
    select
      (e.event_payload->>'scope')::text as scope,
      count(*) as total_calls,
      count(*) filter (where e.safety_state = 'error') as error_count,
      count(*) filter (where e.safety_state = 'ok') as success_count,
      round(avg(e.latency_ms)::numeric, 0) as avg_latency_ms,
      percentile_cont(0.5) within group (order by e.latency_ms) as p50_latency_ms,
      percentile_cont(0.95) within group (order by e.latency_ms) as p95_latency_ms,
      max(e.latency_ms) as max_latency_ms,
      round(sum(coalesce(e.cost_usd, 0))::numeric, 6) as total_cost_usd,
      sum(coalesce(e.token_input, 0)) as total_input_tokens,
      sum(coalesce(e.token_output, 0)) as total_output_tokens,
      sum(coalesce(e.token_total, 0)) as total_tokens
    from public.events e
    where e.event_type = 'llm_call'
      and e.created_at >= v_since
    group by (e.event_payload->>'scope')
  ),
  -- Variant stale/processing/failed counts from user_recipe_variants.
  variant_health as (
    select
      count(*) as total_variants,
      count(*) filter (where stale_status = 'stale') as stale_count,
      count(*) filter (where stale_status = 'processing') as processing_count,
      count(*) filter (where stale_status = 'failed') as failed_count,
      count(*) filter (where stale_status = 'needs_review') as needs_review_count,
      count(*) filter (where stale_status = 'current') as current_count
    from public.user_recipe_variants
  ),
  -- Graph edge creation rate in the window.
  graph_activity as (
    select
      count(*) as edges_created,
      count(*) filter (where ge.metadata->>'source' = 'variant_aggregation') as aggregation_edges
    from public.graph_edges ge
    where ge.created_at >= v_since
  )
  select jsonb_build_object(
    'window_hours', p_hours,
    'computed_at', now(),
    'scopes', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'scope', ss.scope,
          'total_calls', ss.total_calls,
          'success_count', ss.success_count,
          'error_count', ss.error_count,
          'error_rate_pct', case when ss.total_calls > 0
            then round(ss.error_count::numeric / ss.total_calls * 100, 1)
            else 0
          end,
          'avg_latency_ms', ss.avg_latency_ms,
          'p50_latency_ms', round(ss.p50_latency_ms::numeric, 0),
          'p95_latency_ms', round(ss.p95_latency_ms::numeric, 0),
          'max_latency_ms', ss.max_latency_ms,
          'total_cost_usd', ss.total_cost_usd,
          'total_input_tokens', ss.total_input_tokens,
          'total_output_tokens', ss.total_output_tokens,
          'total_tokens', ss.total_tokens
        )
        order by ss.total_calls desc
      ) from scope_stats ss),
      '[]'::jsonb
    ),
    'variant_health', (
      select row_to_json(vh)::jsonb from variant_health vh
    ),
    'graph_activity', (
      select row_to_json(ga)::jsonb from graph_activity ga
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_pipeline_observability_stats(int)
  to service_role;
