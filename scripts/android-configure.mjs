// Usage (CI and local): node scripts/android-configure.mjs   (run after `npx cap add android` / `npx cap sync android`)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { patchManifest } from './androidManifest.mjs'

const file = process.argv[2] || 'android/app/src/main/AndroidManifest.xml'
if (!existsSync(file)) {
  console.error(`Not found: ${file}. Run "npm run cap:add:android" first.`)
  process.exit(1)
}
const before = readFileSync(file, 'utf8')
const after = patchManifest(before)
if (after !== before) writeFileSync(file, after)
console.log(after === before ? 'AndroidManifest.xml already configured.' : 'AndroidManifest.xml configured (deep links + permissions).')
