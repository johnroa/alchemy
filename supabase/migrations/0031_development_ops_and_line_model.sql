-- Development operations controls + ingredient line decomposition model.

create table if not exists public.recipe_ingredient_mentions (
  id uuid primary key default gen_random_uuid(),
  recipe_ingredient_id uuid not null references public.recipe_ingredients(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  mention_index int not null check (mention_index >= 0),
  mention_role text not null default 'unspecified' check (
    mention_role in ('primary', 'optional', 'alternative', 'garnish', 'unspecified')
  ),
  alternative_group_key text,
  confidence numeric(5,4) not null default 0.5 check (confidence between 0 and 1),
  source text not null default 'llm',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_ingredient_id, mention_index)
);

create index if not exists recipe_ingredient_mentions_recipe_ingredient_idx
  on public.recipe_ingredient_mentions(recipe_ingredient_id, mention_index asc);
create index if not exists recipe_ingredient_mentions_recipe_version_idx
  on public.recipe_ingredient_mentions(recipe_version_id);
create index if not exists recipe_ingredient_mentions_ingredient_idx
  on public.recipe_ingredient_mentions(ingredient_id);
create index if not exists recipe_ingredient_mentions_role_idx
  on public.recipe_ingredient_mentions(mention_role);
create index if not exists recipe_ingredient_mentions_confidence_idx
  on public.recipe_ingredient_mentions(confidence desc);

create table if not exists public.recipe_ingredient_ontology_links (
  id uuid primary key default gen_random_uuid(),
  recipe_ingredient_id uuid not null references public.recipe_ingredients(id) on delete cascade,
  mention_id uuid references public.recipe_ingredient_mentions(id) on delete cascade,
  ontology_term_id uuid not null references public.ontology_terms(id) on delete cascade,
  relation_type text not null default 'has_state',
  source text not null default 'llm',
  confidence numeric(5,4) not null default 0.5 check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_ingredient_id, mention_id, ontology_term_id, relation_type, source)
);

create index if not exists recipe_ingredient_ontology_links_recipe_ingredient_idx
  on public.recipe_ingredient_ontology_links(recipe_ingredient_id);
create index if not exists recipe_ingredient_ontology_links_mention_idx
  on public.recipe_ingredient_ontology_links(mention_id);
create index if not exists recipe_ingredient_ontology_links_term_idx
  on public.recipe_ingredient_ontology_links(ontology_term_id);
create index if not exists recipe_ingredient_ontology_links_confidence_idx
  on public.recipe_ingredient_ontology_links(confidence desc);

create table if not exists public.recipe_pair_stats (
  recipe_a_id uuid not null references public.recipes(id) on delete cascade,
  recipe_b_id uuid not null references public.recipes(id) on delete cascade,
  shared_ingredient_count int not null default 0 check (shared_ingredient_count >= 0),
  ingredient_jaccard numeric(10,6),
  metadata_overlap numeric(10,6),
  co_save_count int not null default 0 check (co_save_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (recipe_a_id, recipe_b_id),
  check (recipe_a_id <> recipe_b_id)
);

create index if not exists recipe_pair_stats_shared_idx
  on public.recipe_pair_stats(shared_ingredient_count desc);
create index if not exists recipe_pair_stats_jaccard_idx
  on public.recipe_pair_stats(ingredient_jaccard desc);

create table if not exists public.development_operation_runs (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null,
  status text not null check (status in ('dry_run', 'processing', 'succeeded', 'failed')),
  requested_by_email text,
  request_payload jsonb not null default '{}'::jsonb,
  preview_counts jsonb not null default '{}'::jsonb,
  result_counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists development_operation_runs_created_idx
  on public.development_operation_runs(created_at desc);
create index if not exists development_operation_runs_status_idx
  on public.development_operation_runs(status, created_at desc);
create index if not exists development_operation_runs_operation_idx
  on public.development_operation_runs(operation_key, created_at desc);

create or replace function public.admin_dev_food_data_preview(preset text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
  targets text[];
  counts jsonb := '{}'::jsonb;
  tbl text;
  cnt bigint;
  total bigint := 0;
begin
  if normalized not in (
    'recipes_domain_reset',
    'ingredients_ontology_reset',
    'graph_reset',
    'full_food_reset'
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid preset',
      detail = 'Supported presets: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset';
  end if;

  if normalized = 'recipes_domain_reset' then
    targets := array[
      'recipes',
      'recipe_versions',
      'recipe_ingredients',
      'recipe_ingredient_mentions',
      'recipe_ingredient_ontology_links',
      'recipe_metadata_jobs',
      'enrichment_runs',
      'recipe_links',
      'recipe_image_jobs',
      'recipe_auto_categories',
      'recipe_user_categories',
      'collection_items',
      'recipe_saves',
      'recipe_version_events',
      'memory_recipe_links',
      'recipe_graph_links',
      'graph_edge_evidence',
      'graph_edges',
      'graph_entities',
      'ingredient_pair_stats',
      'recipe_pair_stats'
    ];
  elsif normalized = 'ingredients_ontology_reset' then
    targets := array[
      'ingredients',
      'ingredient_aliases',
      'recipe_ingredients',
      'recipe_ingredient_mentions',
      'recipe_ingredient_ontology_links',
      'ingredient_ontology_links',
      'ontology_terms',
      'ingredient_pair_stats',
      'recipe_pair_stats',
      'recipe_graph_links',
      'graph_edge_evidence',
      'graph_edges',
      'graph_entities'
    ];
  elsif normalized = 'graph_reset' then
    targets := array[
      'recipe_graph_links',
      'graph_edge_evidence',
      'graph_edges',
      'graph_entities',
      'ingredient_pair_stats',
      'recipe_pair_stats'
    ];
  else
    targets := array[
      'recipes',
      'recipe_versions',
      'recipe_ingredients',
      'recipe_ingredient_mentions',
      'recipe_ingredient_ontology_links',
      'ingredients',
      'ingredient_aliases',
      'ingredient_ontology_links',
      'ontology_terms',
      'ingredient_pair_stats',
      'recipe_pair_stats',
      'recipe_graph_links',
      'graph_edge_evidence',
      'graph_edges',
      'graph_entities',
      'recipe_links',
      'recipe_image_jobs',
      'recipe_auto_categories',
      'recipe_user_categories',
      'collection_items',
      'recipe_saves',
      'memory_recipe_links',
      'recipe_version_events',
      'recipe_metadata_jobs',
      'enrichment_runs'
    ];
  end if;

  foreach tbl in array targets loop
    execute format('select count(*)::bigint from public.%I', tbl) into cnt;
    counts := counts || jsonb_build_object(tbl, cnt);
    total := total + coalesce(cnt, 0);
  end loop;

  return jsonb_build_object(
    'preset', normalized,
    'table_counts', counts,
    'total_rows', total
  );
end;
$$;

create or replace function public.admin_dev_food_data_wipe(
  preset text,
  confirm_text text,
  reason text default null,
  actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
  expected_confirm text;
  preview jsonb;
  post jsonb;
  run_id uuid;
begin
  expected_confirm := format('WIPE %s', upper(replace(normalized, '_', ' ')));

  if trim(coalesce(confirm_text, '')) <> expected_confirm then
    raise exception using
      errcode = '22023',
      message = 'confirmation text mismatch',
      detail = format('Expected exact confirmation text: %s', expected_confirm);
  end if;

  preview := public.admin_dev_food_data_preview(normalized);

  insert into public.development_operation_runs(
    operation_key,
    status,
    requested_by_email,
    request_payload,
    preview_counts,
    result_counts,
    created_at,
    updated_at
  )
  values (
    normalized,
    'processing',
    actor_email,
    jsonb_build_object(
      'confirm_text', confirm_text,
      'reason', coalesce(reason, ''),
      'actor_email', coalesce(actor_email, '')
    ),
    coalesce(preview -> 'table_counts', '{}'::jsonb),
    '{}'::jsonb,
    now(),
    now()
  )
  returning id into run_id;

  if normalized = 'recipes_domain_reset' then
    truncate table
      public.recipe_graph_links,
      public.graph_edge_evidence,
      public.graph_edges,
      public.graph_entities,
      public.ingredient_pair_stats,
      public.recipe_pair_stats,
      public.memory_recipe_links,
      public.recipe_version_events,
      public.recipe_links,
      public.recipe_image_jobs,
      public.recipe_auto_categories,
      public.recipe_user_categories,
      public.collection_items,
      public.recipe_saves,
      public.enrichment_runs,
      public.recipe_metadata_jobs,
      public.recipe_ingredient_ontology_links,
      public.recipe_ingredient_mentions,
      public.recipe_ingredients,
      public.recipe_versions,
      public.recipes
    restart identity cascade;
  elsif normalized = 'ingredients_ontology_reset' then
    truncate table
      public.recipe_graph_links,
      public.graph_edge_evidence,
      public.graph_edges,
      public.graph_entities,
      public.recipe_ingredient_ontology_links,
      public.recipe_ingredient_mentions,
      public.recipe_ingredients,
      public.ingredient_pair_stats,
      public.recipe_pair_stats,
      public.ingredient_ontology_links,
      public.ingredient_aliases,
      public.ingredients,
      public.ontology_terms
    restart identity cascade;
  elsif normalized = 'graph_reset' then
    truncate table
      public.recipe_graph_links,
      public.graph_edge_evidence,
      public.graph_edges,
      public.graph_entities,
      public.ingredient_pair_stats,
      public.recipe_pair_stats
    restart identity cascade;
  elsif normalized = 'full_food_reset' then
    truncate table
      public.recipe_graph_links,
      public.graph_edge_evidence,
      public.graph_edges,
      public.graph_entities,
      public.memory_recipe_links,
      public.recipe_version_events,
      public.recipe_links,
      public.recipe_image_jobs,
      public.recipe_auto_categories,
      public.recipe_user_categories,
      public.collection_items,
      public.recipe_saves,
      public.enrichment_runs,
      public.recipe_metadata_jobs,
      public.recipe_ingredient_ontology_links,
      public.recipe_ingredient_mentions,
      public.recipe_ingredients,
      public.ingredient_pair_stats,
      public.recipe_pair_stats,
      public.ingredient_ontology_links,
      public.ingredient_aliases,
      public.ingredients,
      public.ontology_terms,
      public.recipe_versions,
      public.recipes
    restart identity cascade;
  else
    raise exception using
      errcode = '22023',
      message = 'invalid preset',
      detail = 'Supported presets: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset';
  end if;

  post := public.admin_dev_food_data_preview(normalized);

  update public.development_operation_runs
  set status = 'succeeded',
      result_counts = coalesce(post -> 'table_counts', '{}'::jsonb),
      updated_at = now(),
      completed_at = now()
  where id = run_id;

  perform public.log_changelog_event(
    null,
    'development',
    'development_operation',
    run_id::text,
    'wipe_executed',
    null,
    preview,
    post,
    jsonb_build_object(
      'operation_key', normalized,
      'reason', coalesce(reason, ''),
      'requested_by_email', coalesce(actor_email, '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'run_id', run_id,
    'preset', normalized,
    'expected_confirm', expected_confirm,
    'before', preview,
    'after', post
  );
exception
  when others then
    if run_id is not null then
      update public.development_operation_runs
      set status = 'failed',
          error = sqlerrm,
          updated_at = now(),
          completed_at = now()
      where id = run_id;

      perform public.log_changelog_event(
        null,
        'development',
        'development_operation',
        run_id::text,
        'wipe_failed',
        null,
        preview,
        jsonb_build_object('error', sqlerrm),
        jsonb_build_object(
          'operation_key', normalized,
          'reason', coalesce(reason, ''),
          'requested_by_email', coalesce(actor_email, '')
        )
      );
    end if;
    raise;
end;
$$;

alter table public.recipe_ingredient_mentions enable row level security;
alter table public.recipe_ingredient_ontology_links enable row level security;
alter table public.recipe_pair_stats enable row level security;
alter table public.development_operation_runs enable row level security;

drop policy if exists recipe_ingredient_mentions_read_visible on public.recipe_ingredient_mentions;
create policy recipe_ingredient_mentions_read_visible on public.recipe_ingredient_mentions
  for select
  using (
    exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

drop policy if exists recipe_ingredient_ontology_links_read_visible on public.recipe_ingredient_ontology_links;
create policy recipe_ingredient_ontology_links_read_visible on public.recipe_ingredient_ontology_links
  for select
  using (
    exists (
      select 1
      from public.recipe_ingredients ri
      join public.recipe_versions rv on rv.id = ri.recipe_version_id
      join public.recipes r on r.id = rv.recipe_id
      where ri.id = recipe_ingredient_id
        and (r.owner_user_id = auth.uid() or r.visibility = 'public')
    )
  );

drop policy if exists recipe_pair_stats_read_authenticated on public.recipe_pair_stats;
create policy recipe_pair_stats_read_authenticated on public.recipe_pair_stats
  for select
  using (auth.role() = 'authenticated');

drop policy if exists development_operation_runs_read_authenticated on public.development_operation_runs;
create policy development_operation_runs_read_authenticated on public.development_operation_runs
  for select
  using (auth.role() = 'authenticated');
