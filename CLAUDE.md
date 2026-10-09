# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

m3u4me is a self-hosted, single-user IPTV M3U playlist manager for a local network. Playlists never leave the machine it runs on. It has an Express backend (`server.ts`) and a Vite-built React 19 frontend (`src/`), and it stores everything in one JSON file on disk.

The maintainer is a graphic designer, not a developer. The code is AI-generated, and the maintainer reviews and steers it. Keep changes readable and self-explanatory. The codebase leans on "why" comments above non-obvious code, so match that density. Don't introduce abstractions or libraries that need heavy explanation. `README.md` is end-user documentation for non-developers. When a user-visible feature or install step changes, update its Features/Installation/Updating sections too.

## Commands

- `npm run dev` runs `tsx server.ts`: Express plus Vite in middleware mode (HMR) on port 8080 (`PORT` env overrides). `.claude/launch.json` (local-only, gitignored) defines this as `m3u4me-dev` for the Browser pane.
- `npm run build` runs `vite build` and outputs to `dist/`.
- `npm run start` runs `node server.ts` in production mode. It needs `dist/` to exist, and it runs `server.ts` through Node's built-in TypeScript type stripping. That's only on by default from Node 22.18 (23.6 on the 23.x line), hence `engines` and the version check in `install.sh`. Earlier 22.x versions fail with `ERR_UNKNOWN_FILE_EXTENSION`.
- `npm run lint` runs `eslint . && tsc --noEmit`. `eslint.config.js` has no rules and only an ignore entry, so in practice this is the typecheck. There is no separate typecheck script.
- There is no test suite or test runner. Verify changes with `npm run lint` plus live checks in the running app.

## Backend: `server.ts`

All backend code lives in `server.ts`: no router modules, no ORM, no shared code with `src/`. Top-to-bottom layout:

1. Type declarations, then `readDb()`/`writeDb()`.
2. EPG fetch/parse, then channel-pool fetch/parse/diff, then channel sync (stable pool ids, `syncLinkedChannels()`).
3. Auth helpers, then the boot migration `migrateShortIds()`.
4. M3U/XML escaping helpers and `serveM3U()`.
5. `startServer()`, in this order:
   - boot refresh and the 5-minute interval
   - `/api` auth middleware
   - all routes
   - public short-URL routes
   - finally the Vite middleware (dev) or `dist/` static + `index.html` SPA catch-all (prod)

**New non-API routes must be registered before that final block**, or the catch-all swallows them.

**Runtime constraints (production runs plain `node server.ts`):**
- Use only *erasable* TypeScript syntax: no `enum`, `namespace`, constructor parameter properties, or `import x = require()`. `tsx` in dev accepts these, so a violation only breaks in production.
- `vite` is imported at the top of the file, so it's a runtime dependency even in production. That's why the Dockerfile and install script use `npm ci`, not `--omit=dev`.
- `data/` and `dist/` resolve relative to `process.cwd()`. The systemd unit makes everything except `data/` read-only, so never write files anywhere else.

**Persistence:**
- `data/db.json` (gitignored, auto-created) holds everything. `readDb()`/`writeDb()` synchronously read or rewrite the *whole file* on each request. There are no transactions and no concurrent-writer safety, which is acceptable only because the app is single-user.
- `writeDb()` is crash-safe. It writes `data/db.json.tmp` with `flush: true` (fsync), then renames it over `db.json`, so a crash, restart, full disk or power cut leaves the previous complete file. Never write `db.json` directly.
- `readDb()` returns an empty database only when `db.json` doesn't exist.
  - Any other read error throws, so nothing gets saved over data that's merely unreadable.
  - Invalid JSON is renamed, untouched, to `db.json.corrupt-<UTC timestamp>` (`setAsideDamagedDb()`), logged, and the app continues empty.
- `readDb()` backfills missing top-level arrays. When adding a field to an existing record type, make it optional or nullable and tolerate its absence on old records (see `lastDownloadedAt`). Only use a boot migration like `migrateShortIds()` when a value must be backfilled.
- `settings.onboardingDone` decides whether the first-run setup shows.
  - `emptyDb()` sets it to an explicit `false`.
  - `readDb()` fills it in for databases from before onboarding existed, as "has any playlist or source", so upgrading users never see the setup. It's deliberately not in `DEFAULT_SETTINGS`, which would hide its absence.
  - `POST /api/playlists` and `/import` set it to `true` in the same write: making any playlist finishes the setup. `PUT /api/settings` ignores it.
- **Backup = the whole database.** `GET /api/backup` sends `readDb()` as a JSON attachment. `auth.json` is never included.
- **Restore** (`POST /api/backup/restore`):
  - It takes the raw file as `application/octet-stream`, with a route-level `express.raw` limit of 200 MB. The app-wide `express.json` stops at 50 MB, and real databases with big sources are larger.
  - It needs `playlists` and `channels` arrays, and any other known list that's present must be an array.
  - It first copies the current `db.json` to `data/db.json.before-restore-<UTC stamp>` (gitignored).
  - It sets `onboardingDone` to "backup has playlists, or setup was already done", so a restore never sends anyone back to the setup.
  - Then it runs `migrateShortIds()`, clears both caches and calls `loadAndRefreshAllSources()`.
- The dev server uses the real `data/db.json`, so any testing in the browser mutates real data.
- Validation is minimal. Most `POST`/`PUT` handlers spread `req.body` straight into the stored record, and the frontend is trusted to send correct shapes.

**Background refresh (EPG sources and channel-pool sources):**
- At boot, every EPG source and every non-file pool source is refreshed (`loadAndRefreshAllSources()`, which a backup restore also runs). The refresh is fire-and-forget, so it doesn't block `listen`.
- A source deleted or replaced by a restore while its fetch was in flight keeps nothing: `refreshEpgSource`, `refreshChannelPoolSource` and `detectChannelPoolChanges` check that it still exists before caching or saving.
- A 5-minute `setInterval` refreshes any source that has never been fetched, whose last attempt errored (`lastFetchError`), or whose `refreshIntervalHours` has elapsed. Defaults are 12h for EPG and 24h for pool. Failed sources are therefore retried every tick.
- Refreshes run **sequentially** (`refresh*SourcesSequentially`), not in parallel. This is deliberate: parallel large fetches made healthy sources fail at boot.
- EPG data is cached **in memory only** (`epgCache`), never persisted. After a restart it's empty until each source re-fetches. `channelCount` in `db.json` is the fallback used by `/api/stats`.
- Channel-pool entries **are** persisted (`channelPoolEntries`) and mirrored in `channelPoolCache`. Each refresh diffs old vs new entries by URL + occurrence index and appends an added/removed/renamed changelog entry. Changelog entries older than 90 days are pruned.
- Pool source fetches go through `fetchWithRetry()`: a 502/503/504 is retried up to 5 attempts in total, with growing pauses (3s, 6s, 9s, 12s). Some providers run several servers behind one address and randomly fail requests this way. EPG fetches don't retry.
- Xtream panels return HTTP 200 with an error object for bad logins. `fetchXtreamChannels` treats a non-array response as a failure, so a login hiccup doesn't wipe the cached entries.
- The EPG parser folds `<sub-title>` into `desc` as `"sub-title / desc"`. No separate `subTitle` field exists.

**Parsing and output:**
- M3U/XSPF parsing is server-side only (`parseM3uToChannelPoolEntries`, `parseXspfToChannelPoolEntries`). It is shared by pool sources and by `POST /api/playlists/import`, which calls the parsers with `sourceId: 'import'` and converts entries into channels.
- `detectPlaylistWarning()` distinguishes real playlists from HLS single-stream links. Both the Sources "validate URL" flow and the playlist import flow use it. Its result follows a **warning → confirm** pattern: the server returns `{ warning }`, the dialog shows it, and a second submit sends `confirmWarning: true` (import) or skips validation (pool source).
- M3U output (`serveM3U`) sorts channels by category order, then `order`. It skips `isHidden` channels and escapes attribute quotes and newlines. XMLTV output escapes attributes and wraps text in CDATA.
- `serveM3U` also writes `lastDownloadedAt` to the DB, so a GET that serves a playlist is also a DB write.

**Pass provider data through faithfully.** Don't add filtering or special cases for junk in upstream EPG/playlist feeds (placeholder descriptions, odd names, and so on) unless the maintainer asks.

### Channel sync (linking)

A playlist channel can carry a `link` to one channel pool entry and then follow that entry's changes to the fields it syncs (stream link, name, logo, TVG-ID; never category). Uploaded-file sources can't be linked, because they never refresh.

- **Stable pool entry ids.** At the start of every pool refresh, `carryOverPoolEntryIds()` gives each fetched entry its previous id when it's recognisably the same channel. It tries the same Xtream `stream_id` (read back out of the URL, not stored), then the same URL, then the same name + category when that pair is unique on both sides. Ambiguous matches are never guessed, and an entry whose name and URL both changed is a new channel. The changelog diff is separate and still keyed by URL, so a URL-only change shows there as removed + added.
- **Applying changes.** `syncLinkedChannels()` runs in the same DB write. `link.lastPool` is the pool entry as of the last sync. For each synced field the provider changed, the new value is applied if the channel still equals `lastPool`. Otherwise it goes into `link.pending` as a suggestion. There's no "edited" flag: differing from `lastPool` *is* the edit.
- **Lost channels.** When a linked entry can't be found (by id, then by the same identity rules against `lastPool`), `link.missingRefreshes` counts up. Only after 2 refreshes in a row (`LOST_AFTER_MISSING_REFRESHES`) is the link marked `lost` and the channel hidden with `hiddenBySync: true`. This exists because some providers' servers return different channel lists on back-to-back requests. Only sync-hidden channels get unhidden when they return. Any manual hide/unhide clears `hiddenBySync` (`afterManualChannelEdit`).
- **Safeguard.** If one refresh loses more than 30% (and more than 10) of a source's entries, nothing is marked lost and missing counts aren't increased. A `held` log entry is written instead, and the following refreshes decide.
- **Sync log.** `db.syncLogs`, per playlist, pruned to 90 days and 5000 entries per playlist. Unread counts use `Playlist.syncLogReadAt` and only count sync-originated types (`updated`, `suggested`, `lost`, `returned`, `held`). The user's own actions (`applied`, `dismissed`, `linked`, `unlinked`) never badge. The rule is mirrored in `SyncLogPanel.tsx`.
- **Guards.** Generic channel edit routes strip `link`/`hiddenBySync` (`withoutSyncState`), so only the sync routes change them. `bulk` add accepts either `{ sourceId, poolEntryId, fields }` or a complete link (so undo restores keep their link).
- **Deleting a source** unlinks its channels. They stay in their playlists, and stay hidden if sync had hidden them. Re-adding the source does *not* relink them; that was a deliberate decision.
- Default fields for new links live in `db.settings.defaultSyncFields` (in db.json, not localStorage, so they're the same on every device).

### Routes

Public routes (outside `/api`, never auth-gated, because IPTV players can't send a bearer token):
- `GET /:shortId` returns the playlist as `#EXTM3U` text. `GET /:shortId/epg` returns an XMLTV document filtered to that playlist's visible channels' `tvgId`s.
- `GET /api/playlists/:exportId.m3u` is the legacy long export URL, kept for old links. It sits under `/api`, so it *is* gated when a password is set.

`/api` groups:

| Area | Routes |
| --- | --- |
| Auth | `/auth/status`, `/auth/login` and `/auth/recover` (these three are public), plus `/auth/set-password`, `/auth/remove-password`, `/auth/logout` |
| Playlists | `/playlists` CRUD and `/playlists/import` |
| Channels (under `/playlists/:id/channels`) | single PUT/DELETE, `bulk` (add, returns new ids), `bulk-update` (same changes → many ids), `bulk-update-many` (per-id changes), `bulk-replace` (find/replace), `bulk-delete`, `reorder` |
| EPG | `/epg-sources` CRUD, `/:id/refresh`, `/:id/channels`, `/:id/now` (programmes from −3h to +6h), `/epg/tvg-ids?q=` (autocomplete), `/epg/resolve-tvg-ids` |
| Channel pool | `/channel-pool/sources` CRUD, `/upload`, `/:id/refresh`, `/:id/channels?q=&category=&sort=name\|original`, `/:id/categories`, `/validate-url`, `/changelog?page=` |
| Channel sync | `/settings` GET/PUT (default sync fields). Under `/playlists/:id/channels`: `:channelId/link` POST (link, with `useSourceValues`)/PUT (fields)/DELETE, `:channelId/link/candidates?q=`, `:channelId/link/apply` and `/dismiss` (one pending field), `bulk-link-settings`, `bulk-unlink`. Plus `/playlists/:id/sync-log?page=` and `/sync-log/read` |
| Backup | `/backup` GET (the whole db as a download), `/backup/restore` POST (raw file body, replaces the db, see Persistence) |
| Other | `/search?q=` (all three surfaces, capped at 50 per kind), `/stats` (homescreen), `/health-check` (HEAD, then GET fallback, 8s timeout), `/version` (reads `package.json`; gated like the rest, so `api.getVersion()` sends the token) |

`/api/proxy`, `/api/epg-sources/:id/programs/:channelId` (`api.getEpgPrograms`) and `api.logout` exist, but nothing in the frontend currently calls them.

### Auth (bespoke)

- `data/auth.json` (gitignored) holds a PBKDF2 hash of the password and of a one-time-shown recovery key. If that file doesn't exist, auth is a complete no-op.
- If `auth.json` exists but can't be read, isn't valid JSON or lacks a hash/salt, `readAuth()` returns `'damaged'` and the app **fails closed**.
  - `/auth/status` reports enabled, every gated route returns 401, and login/recover return `AUTH_DAMAGED_MESSAGE`.
  - Deleting the file by hand is the only way back in.
  - Never treat a damaged file as "no password". That used to switch protection off silently.
- `writeAuth()` uses the same tmp-file-plus-rename save as `writeDb()`.
- Login issues a random token kept in an in-memory `Set` (`activeSessions`), so **every server restart logs everyone out**. `set-password` and `recover` also return a fresh token, so turning a password on (in Settings or the first-run setup) doesn't bounce the current browser to the lock screen.
- The frontend keeps the token in `sessionStorage` and sends it via `authFetch()`. A 401 fires a window `auth-expired` event, and `App.tsx` responds by showing `LockScreen`.
- `src/contexts/AuthContext.tsx` is a **vestigial stub** unrelated to this. `AuthProvider` still wraps `<App>`, but nothing calls `useAuth()`. Ignore it when working on auth.

## Data model: duplicated by hand

`server.ts` and `src/apiClient.ts` each declare `Playlist`, `Channel`, `EpgSource`, `ChannelPoolSource`, `ChannelPoolEntry`, `ChannelPoolChangeLog`, the EPG programme shape, and the sync types (`SyncField`, `ChannelLink`, `PoolSnapshot`, `SyncLogEntry`, `AppSettings`). **When changing a shape, update both files.** Response-only types (`SearchResult`, `Stats`, `EpgChannel`, `LinkCandidate`) exist only in `apiClient.ts` and must match what the route actually returns. Some routes also add response-only fields: `GET /playlists` adds `pendingSyncCount`/`unreadSyncLogCount`, `GET /channel-pool/sources` adds `linkedChannelCount`, and the pool channel list adds `linkedPlaylistIds`. The matching `PUT` routes drop these if a caller echoes them back.

- **Playlist**
  - `shortId`: incrementing integer used in the public URLs.
  - `exportId`: UUID for the legacy URL.
  - `categories: string[]`: this array *is* the category display order. `PUT` rejects duplicate names, and bulk add/update endpoints auto-append unknown categories.
  - `lastDownloadedAt`: last time a player pulled the M3U; absent on old records.
- **Channel**: belongs to one playlist and one category string. `order` drives drag-reordering within the playlist. `isHidden` channels are excluded from M3U and EPG output. The optional `link` and `hiddenBySync` fields belong to channel sync (see above). Sync state is per playlist channel, so the same pool channel can be synced in one playlist and not in another.
- **EpgSource / ChannelPoolSource**: `type` is `'xml' | 'xtream'` for EPG and `'xtream' | 'playlist-url' | 'playlist-file'` for pool sources. File sources never refresh. Both carry `lastFetched`, `lastFetchError` and `channelCount`, which the sidebars display.

## Frontend

**Entry and routing:** `main.tsx` wraps everything in `BrowserRouter` and calls `initRipples()`. `App.tsx` applies the `dark`/`amoled` classes to `<html>`, updates the accent-tinted favicon, checks auth status, and shows `LockScreen` when locked. Once unlocked it fetches `/api/settings` and shows `Onboarding` while `onboardingDone` is false. Both are gates rather than routes, so every address shows them. Otherwise it renders routes:

| Path | Component |
| --- | --- |
| `/` | `Home.tsx`: homescreen with stats tiles, last download, newest pool channels, a "Sync updates waiting" card (only when suggestions are pending), per-playlist copy/download links |
| `/playlists`, `/sources`, `/epg` | `Dashboard.tsx` with `activeView` prop `'playlists' \| 'channels' \| 'epg'` (note: **`'channels'` means the Sources tab**) |
| `/settings` | `SettingsPage.tsx`: appearance, channel sync defaults, password/recovery key, backup (download, restore dialog), about + version |
| `*` | redirect to `/` |

**Data fetching (no query library):**
- `src/apiClient.ts` exports one `api` object with every REST call, plus fetch-on-mount hooks: `usePlaylists`, `useChannels`, `useEpgSources`, `useChannelPoolSources`, `useStats`.
- There's no cache or invalidation. After any mutation, call the matching `triggerRefresh()` / `triggerEpgRefresh()` / `triggerChannelPoolRefresh()`. Each one dispatches `refresh` on a plain `EventTarget`, and subscribed hooks refetch. Forgetting the trigger leaves the UI silently stale. `useStats` listens to all three buses. The source hooks also listen to `dbEvents`.
- `authFetch` throws on any non-2xx response, using the server's `{ error }` message. The exception is `/api/auth/*` calls, whose callers inspect `ok`/`status` to show inline form errors.
- `useChannels` returns a stable `EMPTY_CHANNELS` array while a fetch is in flight. Returning a fresh `[]` there once caused an infinite render loop, so keep hook return values referentially stable.

**UI state: one Zustand store (`src/store.ts`):**
- It holds active playlist/category/EPG source/pool source, `scrollTarget`, `isSidebarOpen`, `channelPoolLogOpen`, `syncLogOpenFor` (Home asks PlaylistEditor to open a sync log), `hideUrls`, `undoEntry`, `toast`, and the cosmetic settings.
- Only `logoBgColor`, `accentColor`, `isDarkMode`, `isAmoledMode` and `is24Hour` are persisted to localStorage. Everything else resets on reload.
- The sidebar *width* is local state in `Dashboard.tsx`, not in the store.
- **Errors and notifications:** in a mutation's catch block, call `console.error(e)` plus `notifyError(e, 'fallback message')`. For non-error feedback, use `notifyWarning` or `notifyInfo`. `AuthExpiredError` is ignored on purpose (the lock screen covers it). One toast shows at a time.
- **Undo:** `setUndoEntry({ description, restore })`. Existing restores re-create data via `bulkAddChannels`, so restored channels get new ids. `bulk` add keeps `isHidden` (only restores send it), so hidden channels come back hidden.
- `<Toast />` renders both the toast and the undo snackbar (Cmd/Ctrl+Z triggers undo). It's mounted in `Dashboard`, `Home`, `SettingsPage` and `Onboarding`, but not in LockScreen. Error messages users see (toasts, inline form errors, server `{ error }` text) should be plain language that says what to do next.

**Cross-surface search:**
- `Spotlight.tsx` (Cmd/Ctrl+K) queries `/api/search` and groups results as kind → container → category.
- Picking a result navigates, sets the active container, and sets `scrollTarget: { kind, id }`. The matching view (`PlaylistEditor` / `ChannelPoolViewer` / `EpgViewer`) clears any filter or pagination hiding the target, scrolls to it, highlights it, and resets `scrollTarget` to null.
- `handleSpotlightNavigate` and the keyboard-shortcuts dialog are **duplicated verbatim in `Dashboard.tsx` and `Home.tsx`**, so edit both. The top nav bar is also deliberately mirrored between the two files so nothing shifts when navigating.

**Version check:** `AppInfo.tsx`'s `useVersionInfo()` compares `api.getVersion()` (the `package.json` version) to GitHub's latest release, fetched from the browser. It drives the update banner in Dashboard/Home and the About section.

### Feature surfaces

- **First-run setup** (`Onboarding.tsx`, one file with all steps)
  - Welcome ("make it yours": accent presets + light/dark), then two paths:
    - Start fresh: Sources → Password → Playlist → Done
    - Restore a backup: Backup → Password → Done (plus the Playlist step if the backup had no playlist)
  - Naming a playlist can't be skipped. The server finishes the setup when the playlist is made, so leaving mid-way or reloading brings the setup back from Welcome.
  - The Sources step reuses `AddChannelPoolSourceDialog`/`AddEpgSourceDialog`, rendered outside the glass card (its backdrop blur would otherwise anchor their `position: fixed` to the card). It also offers "Use the TV guide from <Xtream source>", which creates an Xtream EPG source with the same login.
  - The Password step stores the token `set-password` returns. The Done step shows the playlist's short link (and `/epg` when there's a guide), then navigates and calls `onFinish`.
  - The step container is keyed by step for its entrance animation, and the scroll container resets to the top on every step change.
- `BackupDropZone.tsx`: the shared drop-or-click file picker for a backup, used by onboarding and the Settings restore dialog. It also exports `describeRestoredBackup()` and `restoreErrorMessage()`.
- **My Playlists**
  - The sidebar has the playlist list plus `CategoryList.tsx`: dnd-kit category reordering and rename/delete/add. Category mutations write the full `categories` array and suppress the auto-sync effect while in flight, to avoid a race.
  - `PlaylistEditor.tsx` covers:
    - dnd-kit channel reordering with an optimistic local order
    - click-to-edit fields
    - multi-select with bulk move/delete/hide and find/replace
    - the stream health checker (batched to `/api/health-check`)
    - TVG-ID autocomplete
    - client-side pagination of 100 channels per page
    - keyboard shortcuts: Cmd/Ctrl+A, Del, Space, Esc
  - `NewPlaylistDialog.tsx` creates an empty playlist or imports from a URL/file.
  - Channel sync in PlaylistEditor:
    - Each row has a link button, a quiet accent dot when suggestions are pending, and a "Source lost" chip.
    - `ChannelSyncPopover.tsx` (portal, anchored to the clicked element) handles suggestions, sync toggles and Unlink. It also exports `BulkSyncSettingsDialog` for the selection bar.
    - `LinkChannelDialog.tsx` links an existing channel: server-ranked candidates, then a per-field "Keep mine / Use source value" comparison.
    - `SyncLogPanel.tsx` is the per-playlist log drawer. Opening it marks the log read, and it offers Apply/Dismiss for suggestions still waiting.
    - `SyncFieldToggles.tsx` is the shared four-checkbox control (also used by Settings and Add to Playlist).
    - The My Playlists tab shows a dot (mirrored in Home) when any suggestion is pending, and the sidebar shows unread log counts.
  - `BulkEpgAssignDialog.tsx` is opened from PlaylistEditor. It fuzzy-matches channel names to EPG channel names client-side (trigram + word overlap, precomputed index, chunked with yields) and applies matches in chunks via `bulk-update-many`, with cancel & revert.
- **Sources**
  - `ChannelPoolViewer.tsx` is a virtualized list (56px rows). Search, category filter and sort run server-side. The selection persists across searches, and an `AddToPlaylistModal` bulk-adds the selection with an optional category override and an optional "Keep in sync with source" (default or custom fields, per selection; not offered for file sources). Linked pool rows show a link icon.
  - `ChannelPoolUpdateLog.tsx` is a collapsible changelog drawer.
  - `AddChannelPoolSourceDialog.tsx` adds or edits sources (Xtream, URL, or file upload).
- **EPG**
  - `EpgViewer.tsx` is a hand-virtualized timeline grid. It uses a single scroll container with sticky header and channel column, rAF-coalesced scroll handling, and programme times parsed once per fetch.
  - `EpgProgramDialog.tsx` shows programme details.
  - `AddEpgSourceDialog.tsx` adds or edits sources.
  - `AssignTvgIdDialog.tsx` is the reverse of bulk assign: pick one EPG channel, then assign it to channels from any playlist. It's opened from Dashboard via EpgViewer's `onAssignChannel`.

### Shared pieces and conventions

- `Dialog.tsx` is the shared modal shell (scrim, Escape/backdrop close, `dismissible` flag). Use it for new dialogs. The confirm dialogs inline in Dashboard/Home predate it.
- `ACCENT_PRESETS` lives in `store.ts` (Settings and onboarding). `Home.tsx` exports `HomeBackground` and `GLASS`, which onboarding reuses for its aurora background and glass card.
- `ChannelLogo.tsx` renders a logo with an initials fallback. `Logo.tsx` exports `M3U_ICON_PATH`, which `utils/favicon.ts` reuses.
- Utilities in `src/utils/`:
  - `formatTime` (always honor `is24Hour`)
  - `useDebouncedValue` (search-as-you-type)
  - `ripple.ts` (document-level ripple for every `.md-btn`)
- **Programmatic "jump to row" scrolling uses `behavior: 'instant'`**, not `'smooth'`. Smooth scrolling was observed not to animate reliably, and the virtualized lists need `scrollTop` to actually change before the target row renders.
- **Clipboard copy needs a fallback.** The app is usually opened over plain `http://<LAN-IP>`, which is not a secure context, so `navigator.clipboard` is undefined there. Follow the `execCommand('copy')` fallback pattern in `PlaylistEditor.tsx`/`Home.tsx`.
- XMLTV timestamp parsing exists twice: `parseXmltvDate` inside the `/now` route in `server.ts` and `parseXmltvTime` in `EpgProgramDialog.tsx`.
- Text search is accent-insensitive everywhere (EPG view, TVG-ID autocomplete, Sources, Link to Source, Spotlight): both sides go through `foldText()`, which exists twice (`server.ts` and `src/utils/foldText.ts`). Use it for any new search. Spotlight's `highlight()` folds per character so the bold range maps back onto the original text.
- Use relative imports. The `@/*` path alias is configured in `tsconfig.json`/`vite.config.ts`, but nothing uses it.
- There's no `@types/react`, so JSX is only loosely typed. A `key` on a custom component whose props are typed inline fails `tsc`, so put the `key` on a `React.Fragment` around it instead (see Onboarding's source rows).

### Styling

- Tailwind v4, configured CSS-first in `src/index.css` (no `tailwind.config.js`). It defines custom variants:
  - `dark` (class on `<html>`)
  - `amoled` (stacks with dark: `amoled:dark:bg-black`)
  - `no-hover` (touch devices; used so hover-revealed controls stay reachable)
- Surface palette used throughout:
  - page: `bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black`
  - bars/cards: `bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a]`
  - dialogs: `bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a]`
- Hand-rolled Material Design 2 replaces a component library:
  - `.md-btn` for hover/press state and ripple; put it on clickable surfaces
  - `.elev-{1,2,4,8,16,24}` shadows
  - `--md-standard/decelerate/accelerate` easing tokens
  - entrance classes: `.md-scrim`, `.md-dialog`, `.md-dialog-top`, `.md-menu`, `.md-list-in`, `.md-snackbar-in`, `.md-page-in`
  - `.home-*` classes belong to Home; onboarding reuses `.home-aurora` through `HomeBackground`
  - `.onboarding-step-in`/`.onboarding-step-back`/`.onboarding-pop` are the first-run setup's step slide and Done check-mark
- Add any new animation class to the `prefers-reduced-motion` block too.
- The `.elev-*`/`.md-btn` transitions sit in `@layer components` so Tailwind `transition-*` utilities override them. Keep new default transitions in that layer.
- The accent color is user-picked, so apply it with inline `style={{ color/backgroundColor: accentColor }}`, not Tailwind classes. Use `contrastText()` for readable text on it and `accentAlpha(hex, '18')` for tints.

## Deployment and releases

Four supported install paths, all documented in the README:
1. **`install.sh`** (curl-piped from `main` on GitHub). For systemd Linux with apt/dnf: installs Node 22.18+ (from NodeSource), puts the app in `/opt/m3u4me` owned by an `m3u4me` system user, keeps the port in `/etc/m3u4me.env`, and installs a hardened systemd unit (`ProtectSystem=strict`, only `data/` writable). The whole body sits in `main()`, called on the last line, so a truncated `curl | bash` download can't run half a script.
2. **`scripts/m3u4me`**, installed to `/usr/local/bin` by `install.sh`. Only for `install.sh` installs: systemd only, no PM2. Provides `update`, `status`, `logs`, `start`/`stop`/`restart`, `version`, and `uninstall [--purge]`.
   - `update` checks the service is actually answering on `/api/auth/status` after restarting. If any step fails (checkout, `npm ci`, build, or start), it checks out the previous release, reinstalls and rebuilds it, and restarts it if the new one had already been started.
   - Both scripts run `git` and `npm` as the `m3u4me` user via `run_as_app`. That way git never refuses the repo for "dubious ownership", and root's git config is never touched.
3. **Docker**: `Dockerfile` (node:22-alpine, healthcheck on `/api/auth/status`) plus `docker-compose.yml` (`./data` volume).
4. **Manual PM2**: `ecosystem.config.cjs`.

**`install.sh` and `m3u4me update` deploy the newest `v*` git tag, not `main`.** Code changes reach script-installed users only once a release is tagged. `install.sh` itself is fetched from `main` directly, but installs the `scripts/m3u4me` found in the checked-out tag, and only warns if the tag predates it. So push changes to either script together with a release tag. Shell scripts stay heavily commented because users are told to read them before piping into `sudo bash`.

Release convention, from git history:
- Bump `version` in `package.json` and `package-lock.json`.
- Make one commit titled `Release vX.Y.Z: <summary>` with a user-facing changelog body.
- Tag `vX.Y.Z` and publish a GitHub release. The in-app update banner compares against the GitHub release.

Only commit, tag, push or release when explicitly asked.
