import { useAuthStore } from '@stores/index';

/**
 * Convenience hook — returns the current session and derived booleans.
 * Fully implemented in Milestone 2 when the auth listener is wired up.
 */
export function useSession() {
  const { session, user, isLoading, hasCompletedOnboarding } = useAuthStore();

  return {
    session,
    user,
    isLoading,
    isAuthenticated: session !== null,
    hasCompletedOnboarding,
  };
}
