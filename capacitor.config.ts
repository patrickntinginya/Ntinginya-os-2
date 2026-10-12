import type { CapacitorConfig } from '@capacitor/cli'

// Android foundation (Phase 1). No plugins, no server.url: the app ships the built web files from `dist`.
// androidScheme 'https' is Capacitor's default, set explicitly so the WebView origin (https://localhost) never changes
// between builds. That keeps Supabase's saved session (localStorage) stable across app updates.
const config: CapacitorConfig = {
  appId: 'com.ntinginya.personallifeos',
  appName: 'Personal Life OS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
