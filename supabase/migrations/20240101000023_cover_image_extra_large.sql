-- =============================================================================
-- Migration: cover_image_extra_large (023)
--
-- Adds cover_image_extra_large to the anime table.
-- AniList coverImage.extraLarge is ~1000px wide — the highest resolution
-- cover available.  Used by the battle screen for full-card display.
-- =============================================================================

alter table public.anime
  add column if not exists cover_image_extra_large text;

comment on column public.anime.cover_image_extra_large is
  'AniList coverImage.extraLarge — highest resolution cover, ~1000px wide.';
