/// <reference types="expo/types/expo-env" />

// Extend ProcessEnv with the EXPO_PUBLIC_ variables used in this project.
// This gives TypeScript awareness of the env vars declared in .env.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_SUPABASE_URL: string;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY: string;
  }
}
