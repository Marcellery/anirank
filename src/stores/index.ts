/**
 * Global Zustand stores.
 *
 * Only truly cross-feature state lives here.
 * Feature-specific slices (battle.store, ranking.store, friends.store)
 * live inside their own feature folder and are NOT exported from here.
 */

export { useAuthStore } from './auth.store';
