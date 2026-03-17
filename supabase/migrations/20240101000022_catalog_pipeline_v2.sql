CREATE OR REPLACE FUNCTION public.resolve_franchise_roots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _depth integer;
begin
  -- 1) Clear all links
  update public.anime
  set franchise_root_id = null
  where franchise_root_id is not null;

  -- 2) Explicit prequel link
  update public.anime as a
  set franchise_root_id = p.id
  from public.anime as p
  where a.prequel_anilist_id = p.anilist_id
    and p.anilist_id is not null
    and p.format in ('TV', 'TV_SHORT')
    and a.id <> p.id;

  -- 3) Propagate upward to ultimate root
  for _depth in 1..10 loop
    update public.anime as a
    set franchise_root_id = p.franchise_root_id
    from public.anime as p
    where a.franchise_root_id = p.id
      and p.franchise_root_id is not null
      and a.id <> p.franchise_root_id;
    exit when not found;
  end loop;

  -- 4) TV sequel fallback:
  -- link TV-like sequels to the earliest matching TV root, never to movies
  with best_tv_root as (
    select distinct on (a.id)
      a.id as child_id,
      r.id as root_id
    from public.anime a
    join public.anime r
      on r.format in ('TV', 'TV_SHORT')
     and a.format in ('TV', 'TV_SHORT')
     and r.id <> a.id
     and coalesce(r.season_year, 9999) <= coalesce(a.season_year, 9999)
     and (
       lower(coalesce(a.title_english, a.title_romaji, a.title))
         like lower(coalesce(r.title_english, r.title_romaji, r.title)) || ' %'
       or lower(coalesce(a.title_english, a.title_romaji, a.title))
         like lower(coalesce(r.title_english, r.title_romaji, r.title)) || ':%'
       or lower(coalesce(a.title_english, a.title_romaji, a.title))
         = lower(coalesce(r.title_english, r.title_romaji, r.title))
     )
    where a.franchise_root_id is null
    order by
      a.id,
      coalesce(r.season_year, 9999) asc,
      r.anilist_id asc
  )
  update public.anime a
  set franchise_root_id = b.root_id
  from best_tv_root b
  where a.id = b.child_id
    and a.id <> b.root_id;

  -- 5) Non-TV fallback:
  -- movies/ovas/onas/specials with matching title prefix attach to earliest TV root
  with best_media_root as (
    select distinct on (a.id)
      a.id as child_id,
      r.id as root_id
    from public.anime a
    join public.anime r
      on r.format in ('TV', 'TV_SHORT')
     and a.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL')
     and coalesce(r.season_year, 9999) <= coalesce(a.season_year, 9999)
     and (
       lower(coalesce(a.title_english, a.title_romaji, a.title))
         like lower(coalesce(r.title_english, r.title_romaji, r.title)) || ' %'
       or lower(coalesce(a.title_english, a.title_romaji, a.title))
         like lower(coalesce(r.title_english, r.title_romaji, r.title)) || ':%'
       or lower(coalesce(a.title_english, a.title_romaji, a.title))
         = lower(coalesce(r.title_english, r.title_romaji, r.title))
     )
    where a.franchise_root_id is null
    order by
      a.id,
      coalesce(r.season_year, 9999) asc,
      r.anilist_id asc
  )
  update public.anime a
  set franchise_root_id = b.root_id
  from best_media_root b
  where a.id = b.child_id
    and a.id <> b.root_id;

  -- 6) Final propagation
  for _depth in 1..10 loop
    update public.anime as a
    set franchise_root_id = p.franchise_root_id
    from public.anime as p
    where a.franchise_root_id = p.id
      and p.franchise_root_id is not null
      and a.id <> p.franchise_root_id;
    exit when not found;
  end loop;

  -- 7) Enforce invariant: roots can never point upward
  update public.anime
  set franchise_root_id = null
  where format in ('TV', 'TV_SHORT')
    and id in (
      select distinct franchise_root_id
      from public.anime
      where franchise_root_id is not null
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reclassify_catalog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 1) Start from a safe default
  update public.anime
  set catalog_type = 'standalone_work'
  where catalog_type <> 'standalone_work';

  -- 2) Any row linked to a root is a franchise child
  update public.anime
  set catalog_type = 'franchise_child'
  where franchise_root_id is not null
    and catalog_type <> 'franchise_child';

  -- 3) Earliest TV entry in each franchise group becomes the root
  update public.anime r
  set catalog_type = 'series_root'
  where r.format in ('TV', 'TV_SHORT')
    and r.id = (
      select a.id
      from public.anime a
      where coalesce(a.franchise_root_id, a.id) = coalesce(r.franchise_root_id, r.id)
        and a.format in ('TV', 'TV_SHORT')
      order by a.season_year asc nulls last, a.anilist_id asc
      limit 1
    )
    and r.catalog_type <> 'series_root';

  -- 4) Movies/OVAs/ONAs/Specials that belong to a franchise should be children
  update public.anime m
  set catalog_type = 'franchise_child'
  where m.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL')
    and exists (
      select 1
      from public.anime tv
      where tv.format in ('TV', 'TV_SHORT')
        and tv.id <> m.id
        and (
          lower(coalesce(m.title_english, m.title_romaji, m.title))
            like lower(coalesce(tv.title_english, tv.title_romaji, tv.title)) || ' %'
          or lower(coalesce(m.title_english, m.title_romaji, m.title))
            like lower(coalesce(tv.title_english, tv.title_romaji, tv.title)) || ':%'
          or lower(coalesce(m.title_english, m.title_romaji, m.title))
            = lower(coalesce(tv.title_english, tv.title_romaji, tv.title))
        )
    )
    and m.catalog_type <> 'franchise_child';

  -- 5) Backward-compat sync
  update public.anime
  set is_canonical = (catalog_type <> 'franchise_child')
  where is_canonical <> (catalog_type <> 'franchise_child');
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_franchise_episode_totals()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Clear all totals
  update public.anime
  set franchise_episode_total = null;

  -- Standalone episodic works keep own episodes
  update public.anime
  set franchise_episode_total = episodes
  where catalog_type = 'standalone_work'
    and format in ('TV', 'TV_SHORT', 'ONA');

  -- Series roots get total episodic count across root + TV-like children
  update public.anime root
  set franchise_episode_total = totals.total_eps
  from (
    select
      r.id as root_id,
      sum(coalesce(a.episodes, 0)) as total_eps
    from public.anime r
    join public.anime a
      on a.id = r.id
      or a.franchise_root_id = r.id
    where r.catalog_type = 'series_root'
      and a.format in ('TV', 'TV_SHORT', 'ONA')
    group by r.id
  ) totals
  where root.id = totals.root_id;

  -- Children never display totals
  update public.anime
  set franchise_episode_total = null
  where catalog_type = 'franchise_child';
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_catalog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.refresh_title_normalized();
  perform public.resolve_franchise_roots();
  perform public.reclassify_catalog();
  perform public.refresh_franchise_episode_totals();
end;
$function$;

select public.refresh_catalog();
