import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { ThemeProvider } from './contexts/ThemeContext'
import { I18nProvider } from './i18n/I18nContext'
import App from './App'
import { isNativePlatform } from './lib/platform'
import './index.css'

// The web/PWA build registers the service worker exactly as before. Inside the Android shell the app files are
// already bundled in the APK, so a service worker would only risk serving stale cached files after an update.
if (!isNativePlatform()) registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
