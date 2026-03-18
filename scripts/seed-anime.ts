/**
 * Seed script — populates the anime catalogue from the AniList public API.
 *
 * Usage:
 *   npx tsx scripts/seed-anime.ts
 *
 * Required env vars (put in .env.local, never committed):
 *   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *
 * The script pages through AniList's top-by-popularity list and upserts rows
 * using anilist_id as the conflict key — safe to re-run, never creates dupes.
 *
 * Three-phase seeding:
 *   Phase 1   — Upsert all anime rows with prequel_anilist_id from AniList
 *               relations.  Per-row DB triggers handle label-based canonical
 *               detection and title_normalized indexing automatically.
 *   Phase 1.5 — Backfill prequel_anilist_id for DB rows that were seeded in
 *               prior runs (and therefore may have NULL prequel_anilist_id).
 *               Uses reverse SEQUEL edges seen in Phase 1: when we fetch entry
 *               X and it has a SEQUEL edge to Y, we update Y.prequel_anilist_id
 *               in the DB even if Y was not fetched in this run.
 *   Phase 2   — Call refresh_catalog() which runs the full cleanup pipeline:
 *               resolve_franchise_roots → deduplicate_canonical_tv
 *               → refresh_franchise_episode_totals → refresh_title_normalized.
 *               Operates on every DB row, not just this run's fetch window.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TARGET_COUNT     = 2500;  // how many anime to seed
const PER_PAGE         = 50;    // AniList max per request
const REQUEST_DELAY_MS = 1200;  // stay under AniList rate limit (~30 req/min)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// AniList GraphQL — includes relations for prequel_anilist_id
// ---------------------------------------------------------------------------

const ANILIST_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage lastPage }
    media(
      type: ANIME
      sort: POPULARITY_DESC
      format_in: [TV, TV_SHORT, MOVIE, SPECIAL, OVA, ONA]
    ) {
      id
      title { romaji english native }
      coverImage { extraLarge large medium }
      description(asHtml: false)
      format
      status
      seasonYear
      episodes
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

interface AniListMedia {
  id: number;
  title: { romaji: string; english: string | null; native: string | null };
  coverImage: { extraLarge: string | null; large: string | null; medium: string | null } | null;
  description: string | null;
  format: string | null;
  status: string | null;
  seasonYear: number | null;
  episodes: number | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  relations: { edges: AniListRelationEdge[] } | null;
}

interface AniListPage {
  pageInfo: { hasNextPage: boolean; currentPage: number; lastPage: number };
  media: AniListMedia[];
}

async function fetchAniListPage(page: number): Promise<AniListPage> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { page, perPage: PER_PAGE } }),
  });

  if (res.status === 429) {
    console.warn('  Rate limited — waiting 60s…');
    await sleep(60_000);
    return fetchAniListPage(page);
  }

  if (!res.ok) throw new Error(`AniList HTTP ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { data: { Page: AniListPage } };
  return json.data.Page;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(text: string | null): string | null {
  if (!text) return null;
  return text.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim() || null;
}

function mapFormat(format: string | null): 'series' | 'movie' {
  return format === 'MOVIE' ? 'movie' : 'series';
}

// ---------------------------------------------------------------------------
// Label-based sequel detection
// Covers explicit markers (Season N, Part N, Final Season, Roman numerals).
// Subtitle-differentiated continuations are handled via prequel_anilist_id
// → resolve_franchise_roots() in Phase 2.
// ---------------------------------------------------------------------------

const SEQUEL_PATTERNS = [
  /\b(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\b/i,
  /\bSeason\s+[2-9][0-9]?\b/i,
  /\bFinal\s+Season\b/i,
  /\bCour\s+[2-9]\b/i,
  /\bPart\s+[2-9]\b/i,
  /\bArc\s*$/i,
  /\bThe\s+Final\b/i,
  /\bSpecial\s+[0-9]/i,
  // Roman-numeral suffix: "Mob Psycho 100 II", "Overlord III"
  /\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$/,
];

function isSequelSeason(media: AniListMedia): boolean {
  if (media.format !== 'TV' && media.format !== 'TV_SHORT') return false;
  const titles = [media.title.romaji, media.title.english].filter((t): t is string => Boolean(t));
  return titles.some((t) => SEQUEL_PATTERNS.some((p) => p.test(t)));
}

// ---------------------------------------------------------------------------
// Prequel extraction
// Returns the AniList ID of the IMMEDIATE TV/TV_SHORT predecessor, or null.
// Only TV prequels are stored; MOVIE prequels are handled by the Class 2
// canonical trigger (franchise-movie detection).
// ---------------------------------------------------------------------------

function getPrequelAnilistId(media: AniListMedia): number | null {
  if (!media.relations?.edges) return null;
  const prequel = media.relations.edges.find(
    (e) =>
      e.relationType === 'PREQUEL' &&
      (e.node.format === 'TV' || e.node.format === 'TV_SHORT'),
  );
  return prequel?.node.id ?? null;
}

// Normalise status / format to allowed enum values
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding up to ${TARGET_COUNT} anime from AniList → Supabase…\n`);

  // -------------------------------------------------------------------------
  // Phase 1 — fetch pages and upsert rows (including prequel_anilist_id)
  // -------------------------------------------------------------------------

  let page           = 1;
  let totalProcessed = 0;
  // Reverse-direction edges: when we fetch entry X and it has SEQUEL edges to
  // Y, we record (Y.anilist_id, X.anilist_id) so we can backfill Y's
  // prequel_anilist_id even if Y was not fetched in this run.
  const allReverseEdges: Array<{ anilist_id: number; prequel_anilist_id: number }> = [];

  while (totalProcessed < TARGET_COUNT) {
    console.log(`Fetching AniList page ${page}…`);
    const pageData = await fetchAniListPage(page);

    // Collect reverse-direction prequel relationships from this page.
    for (const m of pageData.media) {
      for (const edge of m.relations?.edges ?? []) {
        if (
          edge.relationType === 'SEQUEL' &&
          (edge.node.format === 'TV' || edge.node.format === 'TV_SHORT')
        ) {
          allReverseEdges.push({ anilist_id: edge.node.id, prequel_anilist_id: m.id });
        }
      }
    }

    const rows = pageData.media.map((m) => ({
      anilist_id:          m.id,
      title:               m.title.english ?? m.title.romaji,
      title_romaji:        m.title.romaji,
      title_english:       m.title.english ?? null,
      title_native:        m.title.native  ?? null,
      cover_image_extra_large: m.coverImage?.extraLarge ?? null,
      cover_image_large:       m.coverImage?.large      ?? null,
      cover_image_medium:      m.coverImage?.medium     ?? null,
      description:         stripHtml(m.description),
      format:              safeFormat(m.format),
      status:              safeStatus(m.status),
      season_year:         m.seasonYear ?? null,
      episodes:            m.episodes   ?? null,
      // Legacy columns kept in sync
      type:                mapFormat(m.format),
      episode_count:       m.episodes   ?? null,
      release_year:        m.seasonYear ?? null,
      poster:              m.coverImage?.medium ?? m.coverImage?.large ?? null,
      // Label-based canonical detection
      is_canonical:        !isSequelSeason(m),
      // Direct predecessor's AniList ID — used by resolve_franchise_roots()
      // in Phase 2 to follow chains in SQL for ALL DB rows, not just today's fetch.
      prequel_anilist_id:  getPrequelAnilistId(m),
      // Airing metadata — kept current by refresh-anime.ts
      next_airing_episode: m.nextAiringEpisode?.episode ?? null,
      next_airing_at:      m.nextAiringEpisode
                             ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString()
                             : null,
      synced_at:           new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('anime')
      .upsert(rows, { onConflict: 'anilist_id' });

    if (error) {
      console.error('Supabase upsert error:', error.message);
      process.exit(1);
    }

    totalProcessed += rows.length;
    console.log(`  ✓ Upserted ${rows.length} rows  (running total: ${totalProcessed})`);

    if (!pageData.pageInfo.hasNextPage || totalProcessed >= TARGET_COUNT) break;

    page++;
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nPhase 1 complete. ${totalProcessed} rows upserted.`);

  // -------------------------------------------------------------------------
  // Phase 1.5 — backfill prequel_anilist_id from reverse SEQUEL edges
  //
  // Deduplicate: if multiple pages listed the same sequel entry, keep the
  // first seen (which corresponds to the direct/lowest anilist_id predecessor).
  // -------------------------------------------------------------------------

  const seenSequel = new Set<number>();
  const uniqueReverseEdges = allReverseEdges.filter((e) => {
    if (seenSequel.has(e.anilist_id)) return false;
    seenSequel.add(e.anilist_id);
    return true;
  });

  if (uniqueReverseEdges.length > 0) {
    console.log(`\nPhase 1.5: backfilling prequel_anilist_id for ${uniqueReverseEdges.length} sequel entries…`);
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
  // Phase 2 — automatic catalog pipeline
  //
  // refresh_catalog() runs all post-import cleanup in the correct order:
  //   1. resolve_franchise_roots()          — franchise chain resolution
  //   2. deduplicate_canonical_tv()         — same-title TV dedup
  //   3. refresh_franchise_episode_totals() — episode total recompute
  //   4. refresh_title_normalized()         — search index repair
  //
  // Operates on EVERY row in the DB, not just the entries fetched today.
  // Safe to re-run on reseed or partial import.
  // -------------------------------------------------------------------------

  console.log('\nPhase 2: running catalog pipeline…');
  const { error: catalogError } = await supabase.rpc('refresh_catalog');
  if (catalogError) {
    console.warn('  ⚠ refresh_catalog failed:', catalogError.message);
    console.warn('    Ensure migrations 013–020 have been applied.');
    console.warn('    Phase 1 data is intact — run: SELECT public.refresh_catalog();');
  } else {
    console.log('  ✓ Catalog pipeline complete.');
  }

  console.log(`\nDone. ${totalProcessed} anime rows seeded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
