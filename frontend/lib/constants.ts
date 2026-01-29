/**
 * Z-Index Scale for consistent layering across the application
 *
 * Layer Hierarchy (from bottom to top):
 * - Base content: z-0 (default)
 * - Player controls: z-10
 * - Player overlays (badges, stats): z-20
 * - Player debug panels: z-30
 * - Sidebar navigation: z-40
 * - Header & Mobile nav: z-50
 * - Modals & Dialogs: z-60
 * - Tooltips & Popovers: z-70
 * - Notifications/Toasts: z-80
 */
export const Z_INDEX = {
  // Base layers
  BASE: 0,
  ELEVATED: 10,

  // Player layers (scoped to player container)
  PLAYER_CONTROLS: 10,
  PLAYER_OVERLAY: 20,
  PLAYER_DEBUG: 30,

  // Layout layers
  SIDEBAR: 40,
  HEADER: 50,
  MOBILE_NAV: 50,

  // Overlay layers
  DROPDOWN: 55,
  MODAL: 60,
  TOOLTIP: 70,
  NOTIFICATION: 80,
  MAX: 9999,
} as const;

/**
 * Tailwind z-index classes mapping
 * Use these for consistent class names
 */
export const Z_CLASS = {
  SIDEBAR: 'z-40',
  HEADER: 'z-50',
  MOBILE_NAV: 'z-50',
  DROPDOWN: 'z-[55]',
  MODAL: 'z-[60]',
  TOOLTIP: 'z-[70]',
  NOTIFICATION: 'z-[80]',
} as const;

/**
 * Breakpoints matching Tailwind defaults
 */
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;

/**
 * Animation durations (in ms)
 */
export const ANIMATION = {
  FAST: 150,
  NORMAL: 200,
  SLOW: 300,
} as const;
