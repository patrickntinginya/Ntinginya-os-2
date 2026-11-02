#!/usr/bin/env sh
set -eu
# Run this script from the root of the Ntinginya-os-2 repository after extracting the bundle.
python3 - <<'PY'
from pathlib import Path
app_path = Path('src/App.jsx')
nav_path = Path('src/lib/navigation.js')
app = app_path.read_text()
nav = nav_path.read_text()
if "import SafeMode from './pages/SafeMode'" not in app:
    marker = "import Calm from './pages/Calm'\n"
    if marker not in app: raise SystemExit('Could not find Calm import in src/App.jsx; no files changed.')
    app = app.replace(marker, marker + "import SafeMode from './pages/SafeMode'\n", 1)
if 'path="/safe-mode"' not in app:
    marker = '            <Route path="/calm" element={<Calm />} />\n'
    if marker not in app: raise SystemExit('Could not find Calm route in src/App.jsx; no files changed.')
    app = app.replace(marker, marker + '            <Route path="/safe-mode" element={<SafeMode />} />\n', 1)
if 'to: \'/safe-mode\'' not in nav:
    marker = 'Bot, Search, Settings,'
    if marker not in nav: raise SystemExit('Could not find icon import list in src/lib/navigation.js; no files changed.')
    nav = nav.replace(marker, 'Bot, Search, Settings, ShieldCheck,', 1)
    marker = "  { to: '/motivation', labelKey: 'nav.motivation', icon: Heart },\n"
    if marker not in nav: raise SystemExit('Could not find Motivation navigation item; no files changed.')
    nav = nav.replace(marker, marker + "  { to: '/safe-mode', labelKey: 'nav.safeMode', icon: ShieldCheck },\n", 1)
app_path.write_text(app)
nav_path.write_text(nav)
print('Updated App.jsx and navigation.js. Copy src/pages/SafeMode.jsx and supabase/migrations/005_safe_mode_media.sql from this bundle into the repository.')
PY
