import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { bootstrapSession, signOut as authSignOut } from '@services/auth.service';
import { supabase } from '@services/supabase';

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
  checkOnboardingStatus:        (userId: string) => Promise<void>;
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
   * Check whether the user has completed onboarding by looking for at least
   * one anime in their user_anime list. Called after a session is restored.
   */
  checkOnboardingStatus: async (userId: string) => {
    try {
      const { count } = await supabase
        .from('user_anime')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      set({ hasCompletedOnboarding: (count ?? 0) > 0 });
    } catch {
      // If the query fails, leave hasCompletedOnboarding as false so
      // the user is prompted to go through onboarding again.
    }
  },

  /**
   * Call once on app start (in app/_layout.tsx).
   * Restores a persisted session from SecureStore, then marks loading done.
   */
  bootstrapSession: async () => {
    try {
      const session = await bootstrapSession();
      set({ session, user: session?.user ?? null });

      // If we have a session, check whether onboarding was completed.
      if (session?.user?.id) {
        try {
          const { count } = await supabase
            .from('user_anime')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', session.user.id);

          set({ hasCompletedOnboarding: (count ?? 0) > 0 });
        } catch {
          // Silently ignore — hasCompletedOnboarding stays false
        }
      }
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
