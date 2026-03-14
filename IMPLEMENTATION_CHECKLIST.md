# AniRank — Implementation Checklist

---

## ✅ Milestone 1 — Project Scaffold (COMPLETE)

### Config & tooling
- [x] `package.json` — Expo SDK 52, all dependencies listed
- [x] `app.json` — name, slug, scheme, dark mode, plugins
- [x] `tsconfig.json` — strict mode, path aliases configured
- [x] `babel.config.js` — babel-preset-expo + reanimated plugin
- [x] `.env.example` — Supabase env var template
- [x] `.gitignore`

### Routing skeleton (`app/`)
- [x] `app/_layout.tsx` — root layout, GestureHandler + QueryClient providers
- [x] `app/index.tsx` — auth gate redirect (placeholder logic)
- [x] `app/(auth)/_layout.tsx`
- [x] `app/(auth)/login.tsx` — placeholder
- [x] `app/(auth)/signup.tsx` — placeholder
- [x] `app/(tabs)/_layout.tsx` — 4-tab navigator (Battles, Rankings, Friends, Profile)
- [x] `app/(tabs)/battles.tsx` — placeholder
- [x] `app/(tabs)/rankings.tsx` — placeholder
- [x] `app/(tabs)/friends.tsx` — placeholder
- [x] `app/(tabs)/profile.tsx` — placeholder
- [x] `app/onboarding/index.tsx` — placeholder
- [x] `app/battle/index.tsx` — placeholder

### Source layer (`src/`)
- [x] `src/constants/colors.ts`
- [x] `src/constants/typography.ts`
- [x] `src/constants/spacing.ts`
- [x] `src/constants/index.ts`
- [x] `src/types/database.ts` — hand-written DB type skeleton
- [x] `src/types/index.ts` — shared domain types
- [x] `src/services/supabase.ts` — Supabase client singleton (SecureStore adapter TODO)
- [x] `src/stores/auth.store.ts` — Zustand auth slice stub
- [x] `src/stores/index.ts`
- [x] `src/hooks/useSession.ts` — session hook stub
- [x] `src/hooks/index.ts`
- [x] `src/utils/elo.ts` — full Elo implementation (DEFAULT_RATING, K-factor, calculateEloUpdate)
- [x] `src/utils/index.ts`
- [x] `src/features/battle/index.ts` — scope comment
- [x] `src/features/ranking/index.ts` — scope comment
- [x] `src/features/friends/index.ts` — scope comment
- [x] `src/features/anime/index.ts` — scope comment
- [x] `src/components/ui/index.ts` — barrel placeholder
- [x] `src/components/layout/index.ts` — barrel placeholder

### Supabase
- [x] `supabase/migrations/README.md` — CLI setup instructions

---

## ✅ Milestone 2 — Database + Auth (COMPLETE)

### Supabase project
- [ ] Create Supabase project, copy URL + anon key into `.env`
- [ ] `supabase login` + `supabase link --project-ref <ref>`

### Migrations
- [x] `20240101000000_create_profiles.sql` — table, trigger, RLS
- [x] `20240101000001_create_anime.sql` — table, GIN index, RLS (read-only for users)
- [x] `20240101000002_create_user_anime.sql` — table, RLS (own data only)
- [x] `20240101000003_create_user_rankings.sql` — table, triggers, RLS (own data only)
- [x] `20240101000004_create_comparisons.sql` — table, RLS (insert + select only)
- [x] `20240101000005_create_friends.sql` — table, canonical pair constraint, trigger, RLS
- [x] `20240101000006_create_share_cards.sql` — table, RLS
- [ ] Apply migrations → `supabase db push`

### Generated types
- [x] `src/types/database.ts` — hand-written, exact match to all 7 migrations
- [ ] Replace with auto-generated output once project is live

### Auth wiring
- [x] `src/services/supabase.ts` — SecureStore adapter wired
- [x] `src/services/auth.service.ts` — signIn, signUp, signOut, bootstrapSession
- [x] `src/stores/auth.store.ts` — bootstrapSession + signOut actions added
- [x] `app/_layout.tsx` — AuthBootstrap mounts onAuthStateChange listener
- [x] `app/index.tsx` — reads real session from useSession(), shows spinner during load

### Types
- [x] `src/types/database.ts` — enum syntax error fixed, all columns accurate
- [x] `src/types/index.ts` — consolidated, no duplicate enum definitions

### Feature service stubs
- [x] `src/features/anime/anime.service.ts`
- [x] `src/features/battle/battle.service.ts`
- [x] `src/features/ranking/ranking.service.ts`
- [x] `src/features/friends/friends.service.ts`

---

## ⬜ Milestone 3 — Onboarding

- [ ] `app/(auth)/login.tsx` — Supabase email + OAuth login form
- [ ] `app/(auth)/signup.tsx` — sign-up form
- [ ] `app/onboarding/index.tsx` — seed anime selection, username setup
- [ ] `src/components/ui/` — Button, Text, Card, Spinner atoms
- [ ] `src/components/layout/Screen.tsx` — SafeAreaView wrapper
- [ ] Load custom fonts via `expo-font`

---

## ⬜ Milestone 4 — Battle System

- [ ] `src/features/battle/battle.service.ts` — write comparison to DB
- [ ] `src/features/battle/battle.store.ts` — current pair, loading state
- [ ] `src/features/battle/useBattle.ts` — pickWinner(), loadNextPair()
- [ ] `src/features/battle/BattleCard.tsx` — poster + gesture handler
- [ ] `src/features/battle/BattleArena.tsx` — two-card layout
- [ ] `app/battle/index.tsx` — wire up BattleArena
- [ ] `app/(tabs)/battles.tsx` — entry point, launches battle modal
- [ ] Integrate `calculateEloUpdate()` from `src/utils/elo.ts`
- [ ] Optimistic ranking update after each battle

---

## ⬜ Milestone 5 — Ranking Screens

- [ ] `src/features/ranking/ranking.service.ts` — fetch user_rankings
- [ ] `src/features/ranking/ranking.store.ts`
- [ ] `src/features/ranking/useRankings.ts`
- [ ] `src/features/ranking/RankingList.tsx` — ranked list, Top 25 highlight
- [ ] `src/features/ranking/ShareCard.tsx` — Top 10 / Top 25 image card
- [ ] `app/(tabs)/rankings.tsx` — wire up RankingList
- [ ] `app/(tabs)/profile.tsx` — avatar, stats, watch progress
- [ ] Share card export via `expo-sharing` + `expo-media-library`
- [ ] Tab bar icons wired up

---

## ⬜ Milestone 6 — Social Features

- [ ] `src/features/friends/friends.service.ts`
- [ ] `src/features/friends/friends.store.ts`
- [ ] `src/features/friends/useFriends.ts`
- [ ] `src/features/friends/FriendList.tsx`
- [ ] `src/features/friends/CompareView.tsx`
- [ ] `app/(tabs)/friends.tsx` — wire up FriendList + CompareView
- [ ] Global rankings view
- [ ] Real-time updates via Supabase Realtime subscriptions
