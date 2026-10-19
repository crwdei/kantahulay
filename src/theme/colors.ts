export const Colors = {
  // Base Canvas (60%)
  bgBase: '#0B0D12',         // Deepest stage background
  bgSurface: '#141824',      // Panels, modals, sidebar
  bgCard: '#1B2030',         // Elevated cards, inputs
  bgControl: '#20283A',      // Transport and secondary buttons
  border: '#283248',         // Subtle structure borders
  borderSubtle: '#1B2030',   // Hairline dividers

  // Neutral Content (30%)
  textPrimary: '#FFFFFF',    // Main lyrics, song titles, headings
  textSecondary: '#A3ADBD',  // Artists, metadata, subtitles
  textMuted: '#6B7688',      // Inactive icons, placeholders

  // Brand Accent (10%)
  accent: '#FFD600',         // Electric Gold: brand, active sweep, code badges, primary CTA
  accentGlow: 'rgba(255, 214, 0, 0.4)', // Gold lyric & header glow

  // Functional Accents (Strict Only)
  success: '#00E676',        // Play icon only
  error: '#FF3B30',          // Stop icon and error banners only
} as const;
