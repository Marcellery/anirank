/**
 * AniRank colour tokens.
 * Dark-first palette — adjust in Milestone 5 when final design is set.
 */
export const COLORS = {
  // Background layers
  background: '#0d0d14',
  surface: '#16161f',
  surfaceElevated: '#1e1e2a',

  // Brand
  primary: '#7c6af7',       // purple accent
  primaryLight: '#a99af9',
  primaryDark: '#5a4ed4',

  // Semantic
  success: '#4caf82',
  warning: '#f0a830',
  error: '#e05555',

  // Text
  text: '#f0f0f5',
  textSecondary: '#a0a0b8',
  textMuted: '#606075',

  // Borders
  border: '#2a2a3a',
  borderLight: '#3a3a50',
} as const;

export type ColorKey = keyof typeof COLORS;
