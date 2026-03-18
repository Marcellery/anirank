/**
 * AniRank Catalog Verification Script
 *
 * Runs structural integrity checks against the anime catalog after
 * refresh_catalog() has been applied.
 *
 * Usage:
 *   npx tsx scripts/verify-catalog.ts
 *
 * Required env vars (in .env.local, never committed):
 *   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
 *
 * Exit codes:
 *   0  — all checks passed
 *   1  — one or more checks failed
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: Missing env vars.\n' +
    '  EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local',
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnimeRow = {
  id:                      string;
  title_english:           string | null;
  title_romaji:            string | null;
  title:                   string | null;
  format:                  string | null;
  catalog_type:            string | null;
  franchise_root_id:       string | null;
  franchise_episode_total: number | null;
  season_year:             number | null;
  is_canonical:            boolean | null;
};

const SELECT_FIELDS =
  'id,title_english,title_romaji,title,format,catalog_type,' +
  'franchise_root_id,franchise_episode_total,season_year,is_canonical';

type CheckResult = {
  name:       string;
  passed:     boolean;
  scope:      number;
  violations: number;
  samples:    AnimeRow[];
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayTitle(r: AnimeRow): string {
  return r.title_english ?? r.title_romaji ?? r.title ?? '(no title)';
}

function rowSummary(r: AnimeRow): string {
  return (
    `  id=${r.id}` +
    `  "${displayTitle(r)}"` +
    `  format=${r.format ?? 'null'}` +
    `  catalog_type=${r.catalog_type ?? 'null'}` +
    `  franchise_root_id=${r.franchise_root_id ?? 'null'}` +
    `  episode_total=${r.franchise_episode_total ?? 'null'}`
  );
}

// ---------------------------------------------------------------------------
// Structural checks
// Each check fetches violation rows (0 = pass) and a scope count for context.
// ---------------------------------------------------------------------------

async function check(
  name:               string,
  violationFn:        () => Promise<AnimeRow[]>,
  scopeFn:            () => Promise<number>,
): Promise<CheckResult> {
  const [violations, scope] = await Promise.all([violationFn(), scopeFn()]);
  return {
    name,
    passed:     violations.length === 0,
    scope,
    violations: violations.length,
    samples:    violations.slice(0, 5),
  };
}

async function scopeCount(filter: Parameters<typeof db.from>[0], where: Record<string, string | null>): Promise<number> {
  let q = db.from(filter).select('id', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(where)) {
    if (val === null) q = q.is(col, null);
    else q = q.eq(col as any, val);
  }
  const { count, error } = await q;
  if (error) throw new Error(`Count query failed: ${error.message}`);
  return count ?? 0;
}

// 1. No series_root has franchise_root_id
async function checkSeriesRootHasNoParent(): Promise<CheckResult> {
  return check(
    'series_root must not have franchise_root_id',
    async () => {
      const { data, error } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .eq('catalog_type', 'series_root')
        .not('franchise_root_id', 'is', null)
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as AnimeRow[];
    },
    () => scopeCount('anime', { catalog_type: 'series_root' }),
  );
}

// 2. Every franchise_child has franchise_root_id
async function checkFranchiseChildHasRoot(): Promise<CheckResult> {
  return check(
    'franchise_child must have franchise_root_id',
    async () => {
      const { data, error } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .eq('catalog_type', 'franchise_child')
        .is('franchise_root_id', null)
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as AnimeRow[];
    },
    () => scopeCount('anime', { catalog_type: 'franchise_child' }),
  );
}

// 3. No franchise_child has franchise_episode_total
async function checkFranchiseChildHasNoTotal(): Promise<CheckResult> {
  return check(
    'franchise_child must not have franchise_episode_total',
    async () => {
      const { data, error } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .eq('catalog_type', 'franchise_child')
        .not('franchise_episode_total', 'is', null)
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as AnimeRow[];
    },
    () => scopeCount('anime', { catalog_type: 'franchise_child' }),
  );
}

// 4. No MOVIE is series_root
async function checkNoMovieIsSeriesRoot(): Promise<CheckResult> {
  return check(
    'MOVIE must not be series_root',
    async () => {
      const { data, error } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .eq('format', 'MOVIE')
        .eq('catalog_type', 'series_root')
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as AnimeRow[];
    },
    async () => {
      const { count, error } = await db
        .from('anime')
        .select('id', { count: 'exact', head: true })
        .eq('format', 'MOVIE');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  );
}

// 5. Rankable catalog pool is only series_root or standalone_work
//    (no franchise_child, no null, no unexpected values should be rankable)
async function checkRankablePoolIsClean(): Promise<CheckResult> {
  return check(
    "no unexpected catalog_type values (must be 'series_root','standalone_work','franchise_child')",
    async () => {
      const { data, error } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .not('catalog_type', 'in', '("series_root","standalone_work","franchise_child")')
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as AnimeRow[];
    },
    async () => {
      const { count, error } = await db
        .from('anime')
        .select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  );
}

// 6. No dangling chains — franchise_root_id must point to a root (franchise_root_id = null)
//    Implementation: fetch all unique franchise_root_ids, then verify each target
//    has franchise_root_id = null. Done in two Supabase queries.
async function checkNoDanglingChains(): Promise<CheckResult> {
  return check(
    'franchise_root_id must point to a row that is itself a root (no dangling chains)',
    async () => {
      // Step 1: collect all distinct franchise_root_id values
      const { data: childRows, error: e1 } = await db
        .from('anime')
        .select('franchise_root_id')
        .not('franchise_root_id', 'is', null);
      if (e1) throw new Error(e1.message);

      const rootIds = [...new Set((childRows ?? []).map(r => r.franchise_root_id as string))];
      if (rootIds.length === 0) return [];

      // Step 2: find any of those root rows that themselves have franchise_root_id set
      const { data: danglers, error: e2 } = await db
        .from('anime')
        .select(SELECT_FIELDS)
        .in('id', rootIds)
        .not('franchise_root_id', 'is', null)
        .limit(20);
      if (e2) throw new Error(e2.message);
      return (danglers ?? []) as AnimeRow[];
    },
    async () => {
      const { count, error } = await db
        .from('anime')
        .select('id', { count: 'exact', head: true })
        .not('franchise_root_id', 'is', null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  );
}

// 7. is_canonical must be synced with catalog_type
async function checkIsCanonicalSync(): Promise<CheckResult> {
  return check(
    'is_canonical must equal (catalog_type <> franchise_child)',
    async () => {
      // Mismatches: is_canonical=true but franchise_child, or is_canonical=false but not franchise_child
      const [wrong_true, wrong_false] = await Promise.all([
        db.from('anime').select(SELECT_FIELDS)
          .eq('is_canonical', false)
          .not('catalog_type', 'eq', 'franchise_child')
          .limit(10)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return (data ?? []) as AnimeRow[];
          }),
        db.from('anime').select(SELECT_FIELDS)
          .eq('is_canonical', true)
          .eq('catalog_type', 'franchise_child')
          .limit(10)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return (data ?? []) as AnimeRow[];
          }),
      ]);
      return [...wrong_true, ...wrong_false];
    },
    async () => {
      const { count, error } = await db
        .from('anime')
        .select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  );
}

// ---------------------------------------------------------------------------
// Franchise spot-checks
// ---------------------------------------------------------------------------

type SpotCheckResult = {
  franchise:       string;
  found:           boolean;
  rows:            AnimeRow[];
  issues:          string[];
};

async function spotCheck(
  franchise:           string,
  titleFragment:       string,
  expectedRootTotal?:  number,
): Promise<SpotCheckResult> {
  const { data, error } = await db
    .from('anime')
    .select(SELECT_FIELDS)
    .ilike('title_english', `%${titleFragment}%`)
    .order('season_year', { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Spot check "${franchise}" failed: ${error.message}`);

  const rows  = (data ?? []) as AnimeRow[];
  const issues: string[] = [];

  if (rows.length === 0) {
    return { franchise, found: false, rows, issues };
  }

  const roots    = rows.filter(r => r.catalog_type === 'series_root');
  const children = rows.filter(r => r.catalog_type === 'franchise_child');

  if (roots.length === 0) {
    issues.push(`no series_root found among ${rows.length} matching rows`);
  }
  if (roots.length > 1) {
    issues.push(`${roots.length} series_root rows found — expected exactly 1`);
  }
  if (expectedRootTotal !== undefined && roots.length === 1) {
    const actual = roots[0].franchise_episode_total;
    if (actual !== expectedRootTotal) {
      issues.push(`root franchise_episode_total = ${actual ?? 'null'}, expected ${expectedRootTotal}`);
    }
  }
  for (const child of children) {
    if (child.franchise_root_id === null) {
      issues.push(`franchise_child "${displayTitle(child)}" has franchise_root_id = null`);
    }
    if (child.franchise_episode_total !== null) {
      issues.push(
        `franchise_child "${displayTitle(child)}" has franchise_episode_total = ${child.franchise_episode_total}`,
      );
    }
  }

  return { franchise, found: true, rows, issues };
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function printCheck(r: CheckResult): void {
  const tag    = r.passed ? '✓' : '✗';
  const status = r.passed ? 'PASS' : 'FAIL';
  console.log(`  ${tag} [${status}] ${r.name}`);
  console.log(`         scope: ${r.scope.toLocaleString()} rows   violations: ${r.violations}`);
  if (!r.passed) {
    for (const s of r.samples) {
      console.log(`        ${rowSummary(s)}`);
    }
    if (r.violations > r.samples.length) {
      console.log(`         ... and ${r.violations - r.samples.length} more`);
    }
  }
}

function printSpotCheck(r: SpotCheckResult): void {
  const passed = r.issues.length === 0;
  const tag    = passed ? '✓' : '✗';
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`  ${tag} [${status}] ${r.franchise}`);

  if (!r.found) {
    console.log(`         (not in DB — skipped)`);
    return;
  }

  for (const row of r.rows) {
    const type  = (row.catalog_type ?? '').padEnd(16);
    const year  = String(row.season_year ?? '????').padStart(4);
    const fmt   = (row.format ?? '').padEnd(8);
    const total = String(row.franchise_episode_total ?? 'null').padStart(4);
    console.log(`         ${type}  ${year}  ${fmt}  total=${total}  "${displayTitle(row)}"`);
  }

  if (!passed) {
    for (const issue of r.issues) {
      console.log(`         ⚠  ${issue}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nAniRank Catalog Verification');
  console.log('============================');

  console.log('\nStructural checks:');
  const structural = await Promise.all([
    checkSeriesRootHasNoParent(),
    checkFranchiseChildHasRoot(),
    checkFranchiseChildHasNoTotal(),
    checkNoMovieIsSeriesRoot(),
    checkRankablePoolIsClean(),
    checkNoDanglingChains(),
    checkIsCanonicalSync(),
  ]);
  for (const r of structural) printCheck(r);

  console.log('\nFranchise spot-checks:');
  const spots = await Promise.all([
    spotCheck('Jujutsu Kaisen',  'Jujutsu Kaisen',  47),
    spotCheck('Attack on Titan', 'Attack on Titan'),
    spotCheck('Demon Slayer',    'Demon Slayer',     63),
  ]);
  for (const r of spots) printSpotCheck(r);

  const failedStructural = structural.filter(r => !r.passed);
  const failedSpots      = spots.filter(r => r.found && r.issues.length > 0);
  const totalFailed      = failedStructural.length + failedSpots.length;

  console.log('\n────────────────────────────────────────');
  if (totalFailed === 0) {
    console.log('RESULT: ALL CHECKS PASSED\n');
    process.exit(0);
  } else {
    console.log(`RESULT: ${totalFailed} CHECK(S) FAILED`);
    console.log('Run  select public.refresh_catalog();  in the Supabase SQL editor to repair.\n');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
