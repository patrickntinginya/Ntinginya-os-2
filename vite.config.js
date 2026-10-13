import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'icon.svg',
        'apple-touch-icon.png',
      ],

      manifest: {
        name: 'Personal Life OS',
        short_name: 'Life OS',
        description:
          'Your personal operating system for tasks, schedule, money, goals, ideas and learning.',

        theme_color: '#256b5b',
        background_color: '#f4f5f3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/dashboard',
        scope: '/',

        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        navigateFallback: '/index.html',

        // Avoid using the app shell for API and server routes.
        navigateFallbackDenylist: [
          /^\/\.netlify\//,
          /^\/api\//,
        ],

        globPatterns: [
          '**/*.{js,css,html,svg,png}',
        ],
      },
    }),
  ],

  build: {
    minify: 'esbuild',
  },
})
