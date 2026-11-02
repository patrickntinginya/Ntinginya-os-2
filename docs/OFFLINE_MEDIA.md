# Offline media library (Safe Mode)

**What it does**
- Safe Mode library lists the person's cloud files (private Supabase bucket `safe-mode-media`) plus files an administrator shared with everyone.
- Each file is labelled **In cloud (needs internet)** or **Available offline**, plus **Update available** / **Download failed** when relevant.
- Search, type filters, **Downloaded** and **Favorites** filters, continue-where-you-left-off for audio/video.
- **Download for offline** streams the file with a progress bar and Cancel; Retry after a failure; Update when the cloud file changed; Remove download; Delete all downloads; storage usage.
- Offline (or cloud unreachable): the library shows what is stored on the device and plays it.

**What can never be downloaded:** YouTube videos, web links, and anyone else's private files. The motivation screen labels these *Online only*.

**How it is stored:** IndexedDB, one database per signed-in user (`ntinginya-offline-media-<userId>`). A record is written only after the whole file was stored and its size matched the cloud record.
The browser asks to keep the data (`navigator.storage.persist()`), but it may still evict it; the app detects that and stops claiming the file is offline.

**Sync rules:** a file deleted in the cloud is removed from the device only after a complete, successful cloud listing. A changed cloud file keeps its old copy playable and offers an update. Nothing is ever downloaded twice at once.

## Limitations (known)
- Files up to 50 MB (bucket limit). A file is assembled in memory while downloading.
- Favorites and playback positions are per device (localStorage); they do not sync between devices.
- Another account on the same device cannot open your files (separate database), but signing out does not delete them; use *Delete all downloads* on shared devices.
- Not yet verified in a real browser or Android WebView: IndexedDB adapter, progress UI, offline playback. The core logic is unit-tested with fakes.
