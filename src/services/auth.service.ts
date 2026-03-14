import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignUpParams = {
  email: string;
  password: string;
  username: string;
};

export type SignInParams = {
  email: string;
  password: string;
};

export type AuthServiceError = {
  message: string;
};

// ---------------------------------------------------------------------------
// Sign up
//
// Passes `username` in raw_user_meta_data so the handle_new_user trigger
// can read it and set profiles.username on the auto-created profile row.
// ---------------------------------------------------------------------------

export async function signUp({ email, password, username }: SignUpParams) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
    },
  });

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export async function signIn({ email, password }: SignInParams) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Bootstrap — call once on app start to restore a persisted session.
// Returns the session if one exists, or null.
// ---------------------------------------------------------------------------

export async function bootstrapSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
