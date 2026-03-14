import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { bootstrapSession, signOut as authSignOut } from '@services/auth.service';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

type AuthState = {
  session:                  Session | null;
  user:                     User | null;
  isLoading:                boolean;
  hasCompletedOnboarding:   boolean;

  // Actions
  setSession:                   (session: Session | null) => void;
  setIsLoading:                 (loading: boolean) => void;
  setHasCompletedOnboarding:    (value: boolean) => void;
  bootstrapSession:             () => Promise<void>;
  signOut:                      () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set) => ({
  session:                null,
  user:                   null,
  isLoading:              true,   // true until bootstrapSession resolves
  hasCompletedOnboarding: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setIsLoading: (isLoading) =>
    set({ isLoading }),

  setHasCompletedOnboarding: (hasCompletedOnboarding) =>
    set({ hasCompletedOnboarding }),

  /**
   * Call once on app start (in app/_layout.tsx).
   * Restores a persisted session from SecureStore, then marks loading done.
   */
  bootstrapSession: async () => {
    try {
      const session = await bootstrapSession();
      set({ session, user: session?.user ?? null });
    } catch {
      set({ session: null, user: null });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Signs out from Supabase and clears local state.
   */
  signOut: async () => {
    await authSignOut();
    set({ session: null, user: null, hasCompletedOnboarding: false });
  },
}));
