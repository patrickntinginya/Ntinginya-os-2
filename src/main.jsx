import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { ThemeProvider } from './contexts/ThemeContext'
import { I18nProvider } from './i18n/I18nContext'
import App from './App'
import './index.css'

registerSW({ immediate: true })

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
