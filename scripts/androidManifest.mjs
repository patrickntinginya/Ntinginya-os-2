// Applies Phase 2 changes to the GENERATED android/app/src/main/AndroidManifest.xml (the android/ folder is created by
// `npx cap add android`, so edits must be re-applied by script). Pure string function so it is unit-tested.
// Idempotent: running it twice changes nothing the second time. Throws if the file does not look like the expected template,
// so a CI build can never silently ship without deep links.
export const SCHEME = 'com.ntinginya.personallifeos'
export const HOSTS = ['login', 'reset-password']
// POST_NOTIFICATIONS: show notifications on Android 13+.  RECEIVE_BOOT_COMPLETED: let scheduled reminders be restored after a reboot.
// SCHEDULE_EXACT_ALARM: let reminders fire at the exact minute (Android 12+; the user can switch it off in system settings).
export const PERMISSIONS = ['android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.SCHEDULE_EXACT_ALARM']

const filter = () => `
            <!-- life-os: email links (sign-up confirmation, password reset) return to the app through this address -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${HOSTS.map((h) => `                <data android:scheme="${SCHEME}" android:host="${h}" />`).join('\n')}
            </intent-filter>
`

export function patchManifest(xml) {
  let out = String(xml)
  const activity = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/s.exec(out)
  if (!activity) throw new Error('AndroidManifest.xml: MainActivity not found. The Capacitor template may have changed; review scripts/androidManifest.mjs.')

  // singleTask makes Android deliver a tapped link to the already-running app instead of opening a second copy.
  if (!/android:launchMode="singleTask"/.test(activity[0])) {
    if (/android:launchMode=/.test(activity[0])) throw new Error('AndroidManifest.xml: MainActivity has an unexpected launchMode.')
    out = out.replace(activity[0], activity[0].replace('<activity', '<activity\n            android:launchMode="singleTask"'))
  }

  if (!out.includes(`android:scheme="${SCHEME}"`)) {
    const close = out.indexOf('</activity>', out.indexOf('.MainActivity'))
    if (close === -1) throw new Error('AndroidManifest.xml: closing </activity> not found.')
    out = out.slice(0, close) + filter() + '        ' + out.slice(close)
  }

  const missing = PERMISSIONS.filter((p) => !out.includes(`android:name="${p}"`))
  if (missing.length) {
    const end = out.lastIndexOf('</manifest>')
    if (end === -1) throw new Error('AndroidManifest.xml: closing </manifest> not found.')
    out = out.slice(0, end) + missing.map((p) => `    <uses-permission android:name="${p}" />\n`).join('') + out.slice(end)
  }
  return out
}
