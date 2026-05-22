# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev
expo start              # start Expo dev server
expo start --android    # run on Android
expo start --ios        # run on iOS

# Quality
npm run lint            # ESLint via expo lint
npm run type-check      # tsc --noEmit

# Tests
npm test                # jest (single run)

# DB scripts
npm run seed:anime      # seed anime catalog (requires .env)
npx tsx scripts/refresh-anime.ts    # refresh catalog from source
npx tsx scripts/verify-catalog.ts   # verify catalog integrity
```

Env vars required: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. For scripts: `SUPABASE_SERVICE_ROLE_KEY`.

## Architecture

**Stack:** React Native + Expo Router + TypeScript, Supabase (Auth + Postgres), Zustand, TanStack Query.

**Routing:** File-based via Expo Router. Groups: `(auth)` (login/signup), `(tabs)` (main nav), plus `app/battle/`, `app/onboarding/`, `app/auth/confirm.tsx` (PKCE email confirm).

**Auth flow:** `useAuthStore` (Zustand) bootstraps session from `expo-secure-store` on app start (`app/_layout.tsx`). Checks `user_anime` count to determine onboarding status. Supabase uses PKCE flow.

**Feature modules** (`src/features/<name>/`): Each exports a `<name>.service.ts` with Supabase query functions. Features: `anime`, `battle`, `friends`, `ranking`. Services are thin wrappers — no business logic outside `battle.service.ts` (Elo) and `utils/elo.ts`.

**Elo ranking:** `src/utils/elo.ts`. Default rating 1500. K-factor: 64 (<10 battles), 32 (<30 battles), 16 (30+). `battle.service.ts` does 3 sequential DB writes per battle: INSERT `comparisons`, UPDATE winner `user_rankings`, UPDATE loser `user_rankings`.

**DB tables:** `profiles`, `anime`, `user_anime`, `user_rankings`, `comparisons`, `friends`, `share_cards`.

**Path aliases** (tsconfig.json):
- `@/*` → `src/*`
- `@features/*`, `@services/*`, `@stores/*`, `@hooks/*`, `@app-types/*`, `@utils/*`, `@ui/*`, `@layout/*`, `@constants/*`

**CI:** GitHub Actions workflow runs `scripts/refresh-anime.ts` daily at 06:00 UTC to keep the anime catalog fresh.
