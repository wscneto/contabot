/**
 * Color palette and design tokens for ContaBot.
 * Built for clarity, readability in retail environments, and high accessibility.
 */

export const colors = {
  // Brand & Primaries
  primary: '#0D9488', // Emerald/Teal - precision & freshness
  primaryDark: '#0F766E',
  primaryLight: '#CCFBF1',
  primaryGlow: 'rgba(13, 148, 136, 0.15)',

  secondary: '#2563EB', // Blue - intelligence & actions
  secondaryLight: '#DBEAFE',

  // Neutrals / Surfaces
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceSubtle: '#F1F5F9',
  surfaceBorder: '#E2E8F0',
  surfaceBorderStrong: '#CBD5E1',

  // Typography
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Status & Badges
  success: '#10B981',
  successBg: '#ECFDF5',
  successText: '#065F46',

  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  warningText: '#92400E',

  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  dangerText: '#991B1B',

  info: '#3B82F6',
  infoBg: '#EFF6FF',
  infoText: '#1E40AF',

  purple: '#8B5CF6',
  purpleBg: '#F5F3FF',
  purpleText: '#5B21B6',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const typography = {
  h1: {
    fontSize: 26,
    fontWeight: '700' as const,
    lineHeight: 32,
    color: colors.textPrimary,
  },
  h2: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  h3: {
    fontSize: 17,
    fontWeight: '600' as const,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bodyStrong: {
    fontSize: 15,
    fontWeight: '600' as const,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    color: colors.textMuted,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
};

export const shadows = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
};
