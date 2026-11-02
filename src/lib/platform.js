// Tells the web app whether it runs inside the Capacitor Android shell or in a normal browser.
// Deliberately has NO imports: Capacitor injects `window.Capacitor` into the native WebView, so the web build
// does not need the @capacitor/core package to ask this question.
export function isNativePlatform(win = globalThis.window) {
  try {
    return Boolean(win?.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}
