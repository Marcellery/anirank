/**
 * Refresh script — keeps the anime catalog current with AniList data.
 *
 * Unlike seed-anime.ts (which adds NEW entries sorted by popularity),
 * this script updates ALL entries already tracked in the DB:
 *   - episode counts  (updated when a show completes)
 *   - airing status   (RELEASING → FINISHED transitions)
 *   - next airing episode + time  (for currently-airing shows)
 *   - prequel_anilist_id  (fills gaps from earlier seed runs)
 *
 * After updating rows it calls refresh_catalog(), which recomputes:
 *   - catalog_type and is_canonical for all entries
 *   - franchise_episode_total using the updated next_airing_episode values
 *   - title_normalized
 *
 * Run on a schedule (daily cron recommended) to keep episode totals and
 * airing metadata current. Safe to re-run at any time — all updates are
 * idempotent upserts by anilist_id.
 *
 * Usage:
 *   npx tsx scripts/refresh-anime.ts
 *
 * Required env vars:
 *   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 */

import fs from 'fs';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 50;    // AniList handles up to 50 IDs per request
const REQUEST_DELAY_MS = 1200;  // ~30 req/min AniList rate limit

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// AniList GraphQL — targeted by ID, includes airing + relation data
// ---------------------------------------------------------------------------

const REFRESH_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      title { romaji english native }
      format
      episodes
      status
      seasonYear
      nextAiringEpisode {
        episode
        airingAt
      }
      relations {
        edges {
          relationType(version: 2)
          node {
            id
            format
            type
          }
        }
      }
    }
  }
}
`;

interface AniListRelationEdge {
  relationType: string;
  node: { id: number; format: string | null; type: string };
}

interface AniListRefreshMedia {
  id: number;
  title: { romaji: string; english: string | null; native: string | null };
  format: string | null;
  episodes: number | null;
  status: string | null;
  seasonYear: number | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  relations: { edges: AniListRelationEdge[] } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const VALID_STATUSES = new Set([
  'FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS',
]);

function safeStatus(s: string | null): string | null {
  return s && VALID_STATUSES.has(s) ? s : null;
}

const VALID_FORMATS = new Set([
  'TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC',
]);

function safeFormat(f: string | null): string | null {
  return f && VALID_FORMATS.has(f) ? f : null;
}

function mapFormat(format: string | null): 'series' | 'movie' {
  return format === 'MOVIE' ? 'movie' : 'series';
}

async function fetchBatch(ids: number[]): Promise<AniListRefreshMedia[]> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: REFRESH_QUERY, variables: { ids } }),
  });

  if (res.status === 429) {
    console.warn('  Rate limited — waiting 60s…');
    await sleep(60_000);
    return fetchBatch(ids);
  }

  if (!res.ok) {
    throw new Error(`AniList HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data: { Page: { media: AniListRefreshMedia[] } };
  };

  return json.data.Page.media;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('AniRank catalog refresh\n');

  // -------------------------------------------------------------------------
  // Step 1 — Load all tracked anilist_ids from the DB
  // -------------------------------------------------------------------------

  console.log('Loading tracked anilist_ids from DB…');
  const { data: dbRows, error: fetchError } = await supabase
    .from('anime')
    .select('anilist_id')
    .not('anilist_id', 'is', null);

  if (fetchError) {
    console.error('Failed to load anilist_ids:', fetchError.message);
    process.exit(1);
  }

  const anilistIds = (dbRows ?? []).map((r) => r.anilist_id as number);
  console.log(`  ${anilistIds.length} entries to refresh.\n`);

  if (anilistIds.length === 0) {
    console.log('Nothing to refresh. Run seed-anime.ts first.');
    return;
  }

  // -------------------------------------------------------------------------
  // Step 2 — Fetch current data from AniList in batches of BATCH_SIZE
  // Collect reverse SEQUEL edges for prequel_anilist_id backfill.
  // -------------------------------------------------------------------------

  const batches = chunk(anilistIds, BATCH_SIZE);
  let totalUpdated = 0;
  const allReverseEdges: Array<{ anilist_id: number; prequel_anilist_id: number }> = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Fetching batch ${i + 1}/${batches.length} (${batch.length} IDs)…`);

    let anilistMedia: AniListRefreshMedia[];
    try {
      anilistMedia = await fetchBatch(batch);
    } catch (err) {
      console.error('  AniList fetch error:', err);
      process.exit(1);
    }

    for (const m of anilistMedia) {
      for (const edge of m.relations?.edges ?? []) {
        if (
          edge.relationType === 'SEQUEL' &&
          (edge.node.format === 'TV' || edge.node.format === 'TV_SHORT')
        ) {
          allReverseEdges.push({ anilist_id: edge.node.id, prequel_anilist_id: m.id });
        }
      }
    }

    const now = new Date().toISOString();

    const updates = anilistMedia.map((m) => ({
      anilist_id: m.id,
      title: m.title.english ?? m.title.romaji,
      type: mapFormat(m.format),
      title_romaji: m.title.romaji,
      title_english: m.title.english ?? null,
      title_native: m.title.native ?? null,
      format: safeFormat(m.format),
      episodes: m.episodes ?? null,
      episode_count: m.episodes ?? null,
      status: safeStatus(m.status),
      season_year: m.seasonYear ?? null,
      release_year: m.seasonYear ?? null,
      next_airing_episode: m.nextAiringEpisode?.episode ?? null,
      next_airing_at: m.nextAiringEpisode
        ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString()
        : null,
      synced_at: now,
    }));

    const { error: upsertError } = await supabase
      .from('anime')
      .upsert(updates, { onConflict: 'anilist_id' });

    if (upsertError) {
      console.error('  Supabase upsert error:', upsertError.message);
      process.exit(1);
    }

    totalUpdated += updates.length;
    console.log(`  ✓ Updated ${updates.length} rows  (running total: ${totalUpdated})`);

    if (i < batches.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\nRefresh complete. ${totalUpdated} rows updated.`);

  // -------------------------------------------------------------------------
  // Step 3 — Backfill prequel_anilist_id from reverse SEQUEL edges
  // -------------------------------------------------------------------------

  const seenSequel = new Set<number>();
  const uniqueReverseEdges = allReverseEdges.filter((e) => {
    if (seenSequel.has(e.anilist_id)) return false;
    seenSequel.add(e.anilist_id);
    return true;
  });

  if (uniqueReverseEdges.length > 0) {
    console.log(`\nBackfilling prequel_anilist_id for ${uniqueReverseEdges.length} sequel entries…`);
    const { error: backfillError } = await supabase.rpc('backfill_prequel_from_edges', {
      edges: uniqueReverseEdges,
    });

    if (backfillError) {
      console.warn('  ⚠ backfill_prequel_from_edges failed:', backfillError.message);
      console.warn('    Ensure migration 017 has been applied.');
    } else {
      console.log('  ✓ Prequel backfill complete.');
    }
  }

  // -------------------------------------------------------------------------
  // Step 4 — Run the full catalog pipeline
  // -------------------------------------------------------------------------

  console.log('\nRunning catalog pipeline…');
  const { error: catalogError } = await supabase.rpc('refresh_catalog');

  if (catalogError) {
    console.warn('  ⚠ refresh_catalog failed:', catalogError.message);
    console.warn('    Ensure migrations 013–020 have been applied.');
    console.warn('    Episode data is updated — run: SELECT public.refresh_catalog();');
  } else {
    console.log('  ✓ Catalog pipeline complete.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
