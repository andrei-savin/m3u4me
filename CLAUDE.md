# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

m3u4me is a self-hosted, single-user IPTV M3U playlist manager for a local network. Playlists never leave the machine it runs on. It has an Express backend (`server.ts`) and a Vite-built React 19 frontend (`src/`), and it stores everything in one JSON file on disk.

The maintainer is a graphic designer, not a developer. The code is AI-generated, and the maintainer reviews and steers it. Keep changes readable and self-explanatory. The codebase leans on "why" comments above non-obvious code, so match that density. Don't introduce abstractions or libraries that need heavy explanation. End-user documentation is for non-developers. `README.md` is the landing page, and `docs/` holds one help page per topic (`docs/README.md` is the index). When a user-visible feature or install step changes, update the matching page too: usually `docs/features.md`, `install.md`, `updating.md` or `troubleshooting.md`, plus the README's "What it can do" list for headline features. Every docs page starts with a breadcrumb and ends with ← previous / next → links in reading order (the index's order). Keep the AI disclosure in full, near the top of `README.md`; the maintainer wants it visible, never shortened or moved down.

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

**Failed requests don't stop the app.** Express 4 doesn't catch errors from `async` handlers, and Node would exit. At the top of `startServer()`, `app.get/post/put/delete` are wrapped so any handler's error goes to the error handler registered last (just before `listen`), which answers with JSON `{ error }` in plain language. Keep that error handler last, and register routes with those four methods so they're covered.

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
- Pool sources can carry a `userAgent` (absent/empty = Node's default `node`), sent by `fetchWithRetry()` and by `validate-url` (which falls back to a VLC string). The dialog's presets live in `src/utils/userAgents.ts`. The source stores the string, not a preset name.
- Xtream panels return HTTP 200 with an error object for bad logins. `readXtreamList()` treats a non-array response as a failure (naming a rejected login when `user_info.auth` is 0), so a login hiccup doesn't wipe the cached entries. Likewise a playlist link that parses to zero channels (a web page, an empty answer) is a failure, not an empty source.
- Failed pool downloads store a plain-language reason in `lastFetchError` (plus `lastFetchErrorAt`): `httpErrorMessage()` for HTTP statuses, `describeSourceFetchError()` for network errors (fetch's real reason is in `err.cause.code`). `ChannelPoolViewer` shows it whenever the source is open: a full panel if nothing was ever downloaded, otherwise a banner above the saved channels. `POST /channel-pool/sources/:id/refresh` answers 502 with that reason on failure, so the Refresh button's toast shows it.
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
| Playlists | `/playlists` CRUD, `/playlists/import`, and `/playlists/reorder` (POST `{ ids }`: the order playlists are listed in) |
| Channels (under `/playlists/:id/channels`) | single PUT/DELETE, `bulk` (add, returns new ids), `bulk-update` (same changes → many ids), `bulk-update-many` (per-id changes), `bulk-replace` (find/replace), `bulk-delete`, `reorder` |
| EPG | `/epg-sources` CRUD, `/:id/refresh`, `/:id/channels`, `/:id/now` (programmes from −3h to +6h), `/epg/tvg-ids?q=` (autocomplete), `/epg/resolve-tvg-ids` |
| Channel pool | `/channel-pool/sources` CRUD, `/upload`, `/:id/refresh`, `/:id/channels?q=&category=&sort=name\|original`, `/:id/categories`, `/validate-url`, `/changelog?page=` |
| Channel sync | `/settings` GET/PUT (default sync fields). Under `/playlists/:id/channels`: `:channelId/link` POST (link, with `useSourceValues`)/PUT (fields)/DELETE, `:channelId/link/candidates?q=`, `:channelId/link/apply` and `/dismiss` (one pending field), `bulk-link-settings`, `bulk-unlink`. Plus `/playlists/:id/sync-log?page=` and `/sync-log/read` |
| Backup | `/backup` GET (the whole db as a download), `/backup/restore` POST (raw file body, replaces the db, see Persistence) |
| Other | `/search?q=` (all three surfaces, capped at 50 per kind), `/stats` (homescreen), `/health-check` (HEAD, then GET fallback, 8s timeout), `/version` (reads `package.json`; gated like the rest, so `api.getVersion()` sends the token) |

`/api/epg-sources/:id/programs/:channelId` (`api.getEpgPrograms`) and `api.logout` exist, but nothing in the frontend currently calls them.

### Auth (bespoke)

- `data/auth.json` (gitignored) holds a PBKDF2 hash of the password and of a one-time-shown recovery key. If that file doesn't exist, auth is a complete no-op.
- If `auth.json` exists but can't be read, isn't valid JSON or lacks a hash/salt, `readAuth()` returns `'damaged'` and the app **fails closed**.
  - `/auth/status` reports enabled, every gated route returns 401, and login/recover return `AUTH_DAMAGED_MESSAGE`.
  - Deleting the file by hand is the only way back in.
  - Never treat a damaged file as "no password". That used to switch protection off silently.
- `writeAuth()` uses the same tmp-file-plus-rename save as `writeDb()`.
- Login issues a random token kept in an in-memory `Set` (`activeSessions`), so **every server restart logs everyone out**. `set-password` and `recover` also return a fresh token, so turning a password on (in Settings or the first-run setup) doesn't bounce the current browser to the lock screen. Both clear every other session first, so a password change signs other devices out.
- **Guessing limit:** `allowLoginAttempt()` gates `/auth/login` and `/auth/recover` per network address (`req.ip`): 5 tries, then a wait that doubles from 30 seconds up to 15 minutes, answered as 429 with a plain message the lock screen shows. The try is counted before the password is checked. `clearLoginAttempts()` runs on success. In memory only.
- Passwords need `MIN_PASSWORD_LENGTH` (8) characters when set; the same number is in `SettingsPage.tsx`, `Onboarding.tsx` and `docs/password.md`. Existing shorter passwords still log in.
- The frontend keeps the token in `sessionStorage` and sends it via `authFetch()`. A 401 fires a window `auth-expired` event, and `App.tsx` responds by showing `LockScreen`.
- `src/contexts/AuthContext.tsx` is a **vestigial stub** unrelated to this. `AuthProvider` still wraps `<App>`, but nothing calls `useAuth()`. Ignore it when working on auth.

## Data model: duplicated by hand

`server.ts` and `src/apiClient.ts` each declare `Playlist`, `Channel`, `EpgSource`, `ChannelPoolSource`, `ChannelPoolEntry`, `ChannelPoolChangeLog`, the EPG programme shape, and the sync types (`SyncField`, `ChannelLink`, `PoolSnapshot`, `SyncLogEntry`, `AppSettings`). **When changing a shape, update both files.** Response-only types (`SearchResult`, `Stats`, `EpgChannel`, `LinkCandidate`) exist only in `apiClient.ts` and must match what the route actually returns. Some routes also add response-only fields: `GET /playlists` adds `channelCount`/`pendingSyncCount`/`unreadSyncLogCount`, `GET /channel-pool/sources` adds `linkedChannelCount`, and the pool channel list adds `linkedPlaylistIds`. The matching `PUT` routes drop these if a caller echoes them back.

- **Playlist**
  - `shortId`: incrementing integer used in the public URLs. It never changes; the order playlists are *listed* in is simply their order in `db.playlists`, which `POST /playlists/reorder` rearranges (drag a playlist in the list pane).
  - `exportId`: UUID for the legacy URL.
  - `categories: string[]`: this array *is* the category display order. `PUT` rejects duplicate names, and bulk add/update endpoints auto-append unknown categories.
  - `lastDownloadedAt`: last time a player pulled the M3U; absent on old records.
- **Stream headers** (`httpReferrer`, `httpUserAgent`, optional on `ChannelPoolEntry`, `Channel` and `PoolSnapshot`, stored only when set): the Referer/User-Agent some streams need. They're parsed from `http-referrer`/`http-user-agent` attributes and `#EXTVLCOPT:` lines, written back both ways by `serveM3U`, and sent by the health check. Sync treats them as part of `url`: they follow the url toggle silently (no log entry or suggestion), and a user's own edit to them is kept. Edited in `StreamHeadersDialog.tsx`, opened from a row's "Referrer · UA" chip or the right-click menu. `splitExtinf()` finds the channel name after the first comma *outside quotes*, because user-agent values contain commas.
- **Channel**: belongs to one playlist and one category string. `order` drives drag-reordering within the playlist. `isHidden` channels are excluded from M3U and EPG output. The optional `link` and `hiddenBySync` fields belong to channel sync (see above). Sync state is per playlist channel, so the same pool channel can be synced in one playlist and not in another.
- **EpgSource / ChannelPoolSource**: `type` is `'xml' | 'xtream'` for EPG and `'xtream' | 'playlist-url' | 'playlist-file'` for pool sources. File sources never refresh. Both carry `lastFetched`, `lastFetchError` and `channelCount`, which the sidebars display.

## Frontend

**Entry and routing:** `main.tsx` wraps everything in `BrowserRouter`, calls `initRipples()`, imports the Geist fonts, and applies the Material You palette and font before the first render (see Styling). `App.tsx` applies the `dark`/`amoled` classes and `data-font` to `<html>`, re-applies the palette when the accent or colour style changes (and gives the favicon the palette's primary colour, the same shade as the logo), checks auth status, and shows `LockScreen` when locked. Once unlocked it fetches `/api/settings` and shows `Onboarding` while `onboardingDone` is false. Both are gates rather than routes, so every address shows them. Otherwise it renders routes:

| Path | Component |
| --- | --- |
| `/` | `Home.tsx`: flat cards on the tinted page, like the rest of the app. "Your playlists" first (a card each: link for a TV app with copy/download, Open, a chip when sync suggestions wait, plus New playlist), then Overview (the total-channels card in `primary-container` and three count tiles), then Recent activity (last playlist fetch, newest pool channels) |
| `/playlists`, `/sources`, `/epg` | `Dashboard.tsx` with `activeView` prop `'playlists' \| 'channels' \| 'epg'` (note: **`'channels'` means the Sources tab**) |
| `/settings` | `SettingsPage.tsx`: appearance (theme Auto/Light/Dark plus an AMOLED black switch), channel sync defaults, password/recovery key, backup (download, restore dialog), about + version |
| `*` | redirect to `/` |

**Data fetching (no query library):**
- `src/apiClient.ts` exports one `api` object with every REST call, plus fetch-on-mount hooks: `usePlaylists`, `useChannels`, `useEpgSources`, `useChannelPoolSources`, `useStats`.
- There's no cache or invalidation. After any mutation, call the matching `triggerRefresh()` / `triggerEpgRefresh()` / `triggerChannelPoolRefresh()`. Each one dispatches `refresh` on a plain `EventTarget`, and subscribed hooks refetch. Forgetting the trigger leaves the UI silently stale. `useStats` listens to all three buses. The source hooks also listen to `dbEvents`.
- `authFetch` throws on any non-2xx response, using the server's `{ error }` message. The exception is `/api/auth/*` calls, whose callers inspect `ok`/`status` to show inline form errors.
- `useChannels` returns a stable `EMPTY_CHANNELS` array while a fetch is in flight. Returning a fresh `[]` there once caused an infinite render loop, so keep hook return values referentially stable.

**UI state: one Zustand store (`src/store.ts`):**
- It holds active playlist/category/EPG source/pool source, `scrollTarget`, `isSidebarOpen` (starts closed below 1024px), `channelPoolLogOpen` (opens the phone update-log sheet), `syncLogOpenFor` (Home asks PlaylistEditor to open a sync log), `hideUrls`, `undoEntry`, `toast`, and the cosmetic settings.
- Only `logoBgColor`, `accentColor`, `colorStyle`, `themeMode` (`'auto'` | `'light'` | `'dark'`), `isAmoledMode`, `is24Hour`, `fontFamily` (`'geist'` | `'system'`) `nameColumnWidth` (the playlist editor's dragged name-column width; null = automatic), and what was open last (`activePlaylistId`, `activeCategory`, `activeChannelPoolSourceId`, `activeEpgSourceId`) are persisted to localStorage. Everything else resets on reload.
- **Theme:** `isDarkMode` is derived, never saved: `resolveDark(themeMode)`, recomputed by `setThemeMode`, by persist's `merge` on load, and by a module-level `prefers-color-scheme` listener (so Auto follows the device live). `isAmoledMode` is an add-on to dark, not a theme: only its own switch changes it, and the `amoled` class stays on in light mode (the CSS only uses `:root.amoled.dark`). `applyColorScheme()` (`materialTheme.ts`) sets the classes; `main.tsx` calls it before first paint, `App.tsx` on changes. Persist `version: 1`'s `migrate` moved everyone from the old saved `isDarkMode` to Auto.
- **Something is always open.** Dashboard's fallback effects open the first playlist/source/guide when the remembered one is missing or none is set, so a tab never lands on an empty pane behind the closed drawer. They run only when a list *arrives* (reading the current id with `useStore.getState()`), never when the selection changes, because a newly created item becomes active before the refetched list contains it. `NothingSelected` therefore only shows for an empty list (with an Add button) or a failed load (Try again), and nothing while loading.
- The sidebar *width* is local state in `Dashboard.tsx`, not in the store.
- **Errors and notifications:** in a mutation's catch block, call `console.error(e)` plus `notifyError(e, 'fallback message')`. For non-error feedback, use `notifyWarning` or `notifyInfo`. `AuthExpiredError` is ignored on purpose (the lock screen covers it). One toast shows at a time.
- **Undo:** `setUndoEntry({ description, restore })`. Existing restores re-create data via `bulkAddChannels`, so restored channels get new ids. `bulk` add keeps `isHidden` (only restores send it), so hidden channels come back hidden.
- `<Toast />` renders both the toast and the undo snackbar (Cmd/Ctrl+Z triggers undo). It's mounted in `Dashboard`, `Home`, `SettingsPage` and `Onboarding`, but not in LockScreen. The first three pass `withTabBar`, which lifts it above the phone tab bar. Error messages users see (toasts, inline form errors, server `{ error }` text) should be plain language that says what to do next.

**Cross-surface search:**
- `Spotlight.tsx` (Cmd/Ctrl+K) queries `/api/search` and groups results by kind → container → category, one group per place, each under a single sticky Finder-style path line (`My Playlists › LynkTV › Anglia`; icon only on phones). Rows show the name; the second line appears only when the TVG ID and/or stream link matched (`matchesQuery`), showing just what matched (the link without `https://`).
- Picking a result navigates, sets the active container, and sets `scrollTarget: { kind, id }`. The matching view (`PlaylistEditor` / `ChannelPoolViewer` / `EpgViewer`) clears any filter or pagination hiding the target, scrolls to it, highlights it, and resets `scrollTarget` to null.
- `handleSpotlightNavigate` is **duplicated verbatim in `Dashboard.tsx` and `Home.tsx`**, so edit both. Both screens share the desktop top bar (`DesktopTopBar.tsx`: ☰, logo, the three tabs with a sliding underline, search, shortcuts (hidden on touch-only screens, `no-hover:hidden`), Settings), the update strip (`UpdateBanner.tsx`) and `KeyboardShortcutsDialog.tsx`, so nothing shifts when navigating. Home passes its frosted-glass surface to the bars. Phones use the shared `MobileTopBar`/`MobileTabBar` instead (see Phone layout).

**Version check:** `AppInfo.tsx`'s `useVersionInfo()` compares `api.getVersion()` (the `package.json` version) to GitHub's latest release, fetched from the browser. It drives `UpdateBanner` (Dashboard/Home) and the About section.

### Feature surfaces

- **First-run setup** (`Onboarding.tsx`, one file with all steps)
  - Welcome ("make it yours": accent presets + Auto/Light/Dark), then two paths:
    - Start fresh: Sources → Password → Playlist → Done
    - Restore a backup: Backup → Password → Done (plus the Playlist step if the backup had no playlist)
  - Naming a playlist can't be skipped. The server finishes the setup when the playlist is made, so leaving mid-way or reloading brings the setup back from Welcome.
  - The Sources step reuses `AddChannelPoolSourceDialog`/`AddEpgSourceDialog`, rendered outside the card (the step's slide-in transform would otherwise anchor their `position: fixed` to the card). It also offers "Use the TV guide from <Xtream source>", which creates an Xtream EPG source with the same login.
  - The Password step stores the token `set-password` returns. The Done step shows the playlist's short link (and `/epg` when there's a guide), then navigates and calls `onFinish`.
  - The step container is keyed by step for its entrance animation, and the scroll container resets to the top on every step change.
- `BackupDropZone.tsx`: the shared drop-or-click file picker for a backup, used by onboarding and the Settings restore dialog. It also exports `describeRestoredBackup()` and `restoreErrorMessage()`.
- **My Playlists**
  - The list pane has the playlists and, below them, `CategoryList.tsx`. Both lists are rows of `SortableNavRow.tsx` (no icons; name, count, rename/hide/delete) and can be reordered with dnd-kit: with a mouse the whole row is the drag handle (dragging starts after 5px, a grip fades in over the left padding as a hint) and the buttons appear on hover. On touch screens and in the drawer (`touch`) rows are just name and count until the section header's Edit / Done button (`PaneSectionHeader`'s `onToggleEdit`; Dashboard's `editingList`, one list at a time) shows a real grip and the buttons. Hover-revealed buttons are never used on touch: a tap counts as a hover on iPads. Source and guide rows (`SourceRow`) work the same way. Playlist order is saved with `api.reorderPlaylists`. Categories also get rename/delete/add. Category mutations write the full `categories` array and suppress the auto-sync effect while in flight, to avoid a race. Each category also has an eye button that hides/shows all its channels via `bulk-update`. There's no stored per-category flag: a category shows as hidden when every channel in it is hidden. Undo restores each channel's previous `isHidden` via `bulk-update-many`.
  - `PlaylistEditor.tsx` covers (desktop; see Phone layout for its phone rows and sheet):
    - a header (playlist name as an overline, the category as the title, the count) with Sync log, Check streams, Assign EPG, a ⋮ (Find & Replace, Channel list PDF, Hide stream links) and the one filled "Link & download" button. Button labels appear once the pane is wide enough, via a container query (`@container` on the editor, `@4xl:` on the labels), so they follow the pane, not the window.
    - while channels are selected, the header turns into the selection bar (Move to, Sync, Unlink, Check, Delete, ✕)
    - rows without zebra stripes: the drag handle and link/eye/delete/⋮ buttons appear on hover (always on touch screens, via `canHover` from `useIsPhone.ts`); the link button (when linked) and the eye-off (when hidden) always show. The row's ⋮ opens the same menu as a right-click (Insert above/below, Link/Sync settings, Stream headers, Delete), because touch screens can't right-click; there, Delete lives only in that menu, so a touch row has three buttons and a mouse row four (`sharedWidth` and the column header's spacer account for both). **Never make a feature right-click-only.** Hidden channels are dimmed, selected rows use `secondary-container`, a search jump flashes `tertiary-container`.
    - the "Add channel" FAB, bottom-right on every size (desktop adds a row for inline editing at once; phones open the sheet)
    - a name column whose width is measured, not guessed: left alone, the TV guide column gets about 38% of the row (200–380px) and the name the rest; dragging the header divider saves a width in the store (`nameColumnWidth`), double-clicking it goes back to automatic
    - dnd-kit channel reordering with an optimistic local order
    - click-to-edit fields
    - multi-select with bulk move/delete/hide and find/replace
    - the stream health checker (batched to `/api/health-check`)
    - TVG-ID autocomplete (`TvgIdAutocomplete.tsx`: `inline` mode in desktop rows, `field` mode in the phone sheet). Its list is at least 360px wide whatever the column, and each row puts the guide channel's name on its own line, with the guide and the id (the part that truncates) underneath.
    - client-side pagination of 100 channels per page
    - keyboard shortcuts: Cmd/Ctrl+A, Del, Space, Esc
  - `NewPlaylistDialog.tsx` creates an empty playlist or imports from a URL/file.
  - Channel sync in PlaylistEditor:
    - Each row has a link button, a quiet accent dot when suggestions are pending, and a "Source lost" chip. A TVG-ID found in a guide shows as an outlined chip (guide channel name · source), without an icon.
    - `ChannelSyncPopover.tsx` (portal, anchored to the clicked element) handles suggestions, sync toggles and Unlink. Its inside is the exported `ChannelSyncDetails`, which the phone channel sheet shows inline. It also exports `BulkSyncSettingsDialog` for the selection bar.
    - `LinkChannelDialog.tsx` links an existing channel: server-ranked candidates, then a per-field "Keep mine / Use source value" comparison.
    - `SyncLogPanel.tsx` is the per-playlist log drawer. Opening it marks the log read, and it offers Apply/Dismiss for suggestions still waiting.
    - `SyncFieldToggles.tsx` is the shared four-checkbox control (also used by Settings and Add to Playlist).
    - The My Playlists tab shows a dot (mirrored in Home) when any suggestion is pending, and the sidebar shows unread log counts.
  - `ChannelListPdf.tsx` (toolbar "PDF" button, next to Sync log) is a printable A4 channel list copied from the maintainer's demo PDF.
    - It's a preview in the shared `Dialog`, portaled into `<body>`. "Save PDF" waits for the font and logos (max 15s), then calls `window.print()`. The `@media print` block in `index.css` hides the app and the dialog's header/footer (`pdf-no-print`), and flattens the dialog's layout (`pdf-print-reset`), so only the sheets print. It's browser print-to-PDF, not a PDF library, which keeps any logo format and system-font fallback for glyphs Inter lacks.
    - The dialog chrome uses the app's font (Geist or system). Only the sheets use Inter, and their fixed colours, because they copy the demo.
    - Order and numbering mirror `serveM3U` (hidden channels left out, numbers run through the whole playlist). EPG ✓ means the TVG-ID is in PlaylistEditor's `tvgIdLabels` (found in a loaded guide).
    - Pagination is computed, not measured: every row is 36.99pt, so page 1 fits 17 rows and later pages 20 (`FIRST_PAGE_ROWS`/`PAGE_ROWS`). Change those if the `.pdf-*` sizes change.
    - Fonts come from `@fontsource-variable/inter` (bundled, offline). "Inter Display" is the same font at `opsz` 32.
  - `BulkEpgAssignDialog.tsx` is opened from PlaylistEditor. It fuzzy-matches channel names to EPG channel names client-side (trigram + word overlap, precomputed index, chunked with yields) and applies matches in chunks via `bulk-update-many`, with cancel & revert.
- **Sources**
  - `ChannelPoolViewer.tsx` is a virtualized list (56px rows) under a title header (with `SourceActions.tsx`: Refresh, not for file sources, and Edit) and a toolbar (search, category, sort, Hide stream links, "Add N to playlist" while something is selected). Search, category filter and sort run server-side. The selection persists across searches, and an `AddToPlaylistModal` bulk-adds the selection with an optional category override and an optional "Keep in sync with source" (default or custom fields, per selection; not offered for file sources). Linked pool rows show a link icon.
  - `ChannelPoolUpdateLog.tsx` is a collapsible changelog strip on the right of the pane.
  - `AddChannelPoolSourceDialog.tsx` adds or edits sources (Xtream, URL, or file upload).
- **EPG**
  - `EpgViewer.tsx` is a hand-virtualized timeline grid under a title header (Dashboard passes `sourceName`, plus `onRefresh`/`onEdit` for its `SourceActions`). The header shows above the loading, failed and empty states too; the empty state shows the guide's `lastFetchError` and Edit / Download again buttons. What's on now is a `secondary-container` block with a progress fill; past programmes are quieter. It uses a single scroll container with sticky header and channel column, rAF-coalesced scroll handling, and programme times parsed once per fetch.
  - `EpgProgramDialog.tsx` shows programme details.
  - `AddEpgSourceDialog.tsx` adds or edits sources.
  - `AssignTvgIdDialog.tsx` is the reverse of bulk assign: pick one EPG channel, then assign it to channels from any playlist. It's opened from Dashboard via EpgViewer's `onAssignChannel`.

### Phone layout

Below 768px (Tailwind's `md`) the app switches to a phone layout. Tablets and computers keep the desktop layout, except a tablet whose browser asks for the mobile site (iPad Safari's "Request Mobile Website" sends a user agent with "Mobile"): an inline script in `index.html` then sets the viewport to `width=767` (no `initial-scale`, which iPads let override the width) so the page lays out as a phone and is scaled up. Desktop markup itself is left alone: phone-only pieces are `md:hidden`, desktop-only pieces `hidden md:flex`, and phone-only sizes `max-md:…`. Don't put `max-md:` and an existing `sm:` on the same property (their order in the CSS isn't obvious); Home's count tiles use `max-sm:` to match its existing `sm:` grid.

- **CSS vs `useIsPhone()`** (`src/utils/useIsPhone.ts`, `PHONE_QUERY` must match `md`): CSS for showing, hiding and sizing; the hook only where the phone needs different components or behaviour (`PhoneChannelRow` instead of `SortableChannelItem`, the channel sheet, long-press, selection bars, the EPG channel-column width, the update-log sheet, mounting the tab bar). The same file has `useIsNarrow()` (`NARROW_QUERY`, below 1024px = `max-lg:`) for the floating drawer, and `canHover` for showing hover-revealed buttons all the time on touch screens.
- **Shell:** `MobileTopBar.tsx` (☰, title with optional `overline`, or the logo; Search via the synthetic Cmd+K event; one `OverflowMenu` ⋮) and `MobileTabBar.tsx` (Home/Playlists/Sources/EPG/Settings, in the page flow as the last row, a `secondary-container` pill on the current tab, with the pending-sync dot) are shared by Dashboard, Home and Settings, on the page colour; their desktop navs are `hidden md:grid`/`md:flex`. `OverflowMenu.tsx` is the ⋮ menu (48px rows, `openUp` for bottom bars, Escape closes it).
- **Touch screens of any size** (`canHover` false, the `no-hover:` variant): buttons are at least 44px (`.icon-btn`/`.btn` `min-*` sizes in `index.css`), playlist rows are 64px with wider handle and button columns (`sharedWidth` accounts for them), Sources rows 64px (`ROW`), the list pane starts at 320px, and list rows keep their buttons behind Edit (see My Playlists). The Browser pane can't emulate `(hover: none)` at tablet width, so check these on a real iPad.
- **Drawer (phones and upright tablets, below 1024px):** the list pane becomes `max-lg:fixed` over the page with a scrim and the logo on top, `min(320px, 85vw)` wide, starts closed, and closes as soon as anything is picked or created in it: a playlist, a category (`CategoryList`'s `onPick`, also after adding one), a source or a guide. Rename, delete and hide leave it open. To switch category, open ☰ again. In the drawer (and on touch screens) rows show their rename pencil and buttons after tapping the section's Edit (no double-click or hover). From 1024px it's a resizable panel beside the content again, collapsible with ☰.
- **Layering rule:** phone overlays (drawer, sheets) are `z-50` and come *before* the dialogs they open in the page, so dialogs paint on top. Never move them with a CSS `transform` (it would re-anchor `position: fixed` children); `.md-sheet-in` ends on `transform: none`. Bars shown while something is selected are `fixed bottom-0 z-40` and cover the tab bar on purpose.
- **`BottomSheet.tsx`** is the phone counterpart of `Dialog` (title row with ✕, scrolling body, footer with `pb-safe`, `dismissible`, `fullHeight`). Used by `ChannelEditSheet.tsx` and the Sources update log.
- **One bar, one ⋮, one way to navigate.** The user found a second (coloured) toolbar, two ⋮ menus and a tappable category title confusing, so on phones: ☰ is the only way to switch playlist/category/source/guide, the title only says where you are, and each screen has exactly one ⋮.
- **Playlist editor:** its desktop toolbar is `hidden md:block`. Dashboard passes `phoneMenuSlot` (an empty spot in `MobileTopBar`, via `menuSlotRef`) and the editor portals its ⋮ into it with every playlist action (link & download, Sync log with a dot for unread, Select, Reorder, Find & Replace, Assign EPG, stream checks, PDF, Hide stream links). Stream-check progress and Reorder mode show as strips under the top bar. Tapping a `PhoneChannelRow` opens `ChannelEditSheet`; long-press (`src/utils/useLongPress.ts`, cancelled by movement so scrolling never selects) selects, and while anything is selected a tap toggles selection. **Reorder mode** shows a `touch-none` grip per row; dragging uses the same `PointerSensor`.
- **Adding a channel on a phone** uses the round + button (FAB) or the sheet's Insert above/below. Both open `ChannelEditSheet` with `isNew`: nothing is created until Add (`handleCreateChannel`), so Cancel leaves nothing behind. Desktop's Add/Insert still create a "New Channel" immediately for inline editing.
- **`ChannelEditSheet` is one form.** Every setting in it (text fields, "Show in playlist", stream headers, the sync checkboxes via `ChannelSyncDetails`' `fields`/`onFieldsChange`) is a draft until Save; ✕ and Cancel discard it (`BottomSheet`'s `canClose` keeps ✕ working while `dismissible` blocks stray outside taps). The user reported mixing instant-save toggles into it as a big bug. Only buttons that *do* something (Use new / Keep mine, Link, Unlink, Insert, Delete) act immediately.
- **The sheet sends only fields that changed** (`handleSheetSave` → `handleChannelSave`, then `updateChannelLink` if the sync checkboxes changed). Any `isHidden` key in a channel PUT clears `hiddenBySync` (`afterManualChannelEdit`), so never echo unchanged values.
- **Sources:** full-width search plus a filter button for category/sort, tap a row to select, a bottom "Add to playlist" bar. The top bar's ⋮ (Dashboard's `menuItems`) has Refresh source, Edit source, the update log in a sheet (`channelPoolLogOpen`) and Hide stream links.
- **EPG:** a fixed 104px channel column (tap it to assign the guide channel). The top bar's ⋮ has Refresh guide and Edit guide. "Now" centring accounts for the pinned column on every screen size (`scrollLeftToCenter`).
- **Global:** shell roots use `h-dvh` (not `h-screen`, which hides content behind mobile browser bars). `index.html` has `viewport-fit=cover`; `pt-safe`/`pb-safe` utilities and the `body` side padding handle notches and home bars. `.md-btn`'s hover tint only applies on `(hover: hover)` devices, so it doesn't stick after a tap. Form inputs in phone UI use `text-base` (16px), or iPhones zoom the page on focus.
- **Testing:** the Browser pane can emulate the size but sends mouse events, so long-press, touch dragging, safe areas and the on-screen keyboard need a check on a real phone over the LAN.

### Shared pieces and conventions

- `Dialog.tsx` is the shared modal shell (scrim, Escape/backdrop close, `dismissible` flag, 28px corners on `bg-dialog`). Use it for new dialogs: 24px padding, a `text-headline-sm` title, `text-body-md` text, text buttons on the right. `ConfirmDialog.tsx` is the "are you sure?" version (title, message, Cancel + one confirm, `danger` for red). Its scrim scrolls (`items-start overflow-y-auto` plus `my-auto` on the panel), so a dialog taller than the screen can be scrolled; one that fits stays centred.
- Small shared controls: `Checkbox.tsx` (the M3 checkbox picture, put inside the clickable element), `Switch.tsx` (M3 switch), `SegmentedButtons.tsx` (2–4 joined choices, e.g. Theme and Font in Settings), `SyncFieldToggles.tsx` (filter chips).
- `ACCENT_PRESETS` lives in `store.ts` (Settings and onboarding).
- **Icons are Material Symbols (rounded)**, through `Icon.tsx`: `<Icon name="delete" className="text-[20px]" />`. It's a font (`@fontsource-variable/material-symbols-rounded`, bundled; the `@font-face` is in `index.css`), so the name is the snake_case one from fonts.google.com/icons, the size is a font-size class (24px by default, 20px in dense rows and labelled buttons) and `filled` gives the solid version (current phone tab). There is no lucide-react any more.
- `ChannelLogo.tsx` renders a logo with an initials fallback. `Logo.tsx` exports `M3U_ICON_PATH`, which `utils/favicon.ts` reuses.
- Utilities in `src/utils/`:
  - `formatTime` (always honor `is24Hour`)
  - `useDebouncedValue` (search-as-you-type)
  - `ripple.ts` (document-level press ripple for every `.md-btn`: grows from the pointer just far enough to cover the surface, holds while pressed, fades after release; only the innermost `.md-btn` ripples). A surface must keep `md-btn` (its `overflow: hidden` clips the ripple) for as long as it can be pressed, so rows keep it when they become the current one.
- **Programmatic "jump to row" scrolling uses `behavior: 'instant'`**, not `'smooth'`. Smooth scrolling was observed not to animate reliably, and the virtualized lists need `scrollTop` to actually change before the target row renders.
- **Clipboard copy needs a fallback.** The app is usually opened over plain `http://<LAN-IP>`, which is not a secure context, so `navigator.clipboard` is undefined there. Always copy through `src/utils/copyToClipboard.ts` (it falls back to `execCommand('copy')`, iPhone-safe, and resolves to whether it worked).
- XMLTV timestamp parsing exists twice: `parseXmltvDate` inside the `/now` route in `server.ts` and `parseXmltvTime` in `EpgProgramDialog.tsx`.
- Text search is accent-insensitive everywhere (EPG view, TVG-ID autocomplete, Sources, Link to Source, Spotlight): both sides go through `foldText()`, which exists twice (`server.ts` and `src/utils/foldText.ts`). Use it for any new search. Spotlight's `highlight()` folds per character so the bold range maps back onto the original text.
- Use relative imports. The `@/*` path alias is configured in `tsconfig.json`/`vite.config.ts`, but nothing uses it.
- There's no `@types/react`, so JSX is only loosely typed. A `key` on a custom component whose props are typed inline fails `tsc`, so put the `key` on a `React.Fragment` around it instead (see Onboarding's source rows).

### Styling (Material Design 3)

- Tailwind v4, configured CSS-first in `src/index.css` (no `tailwind.config.js`). It defines custom variants:
  - `dark` (class on `<html>`)
  - `amoled` (stacks with dark: `amoled:dark:…`); rarely needed now that colours are tokens
  - `no-hover` (touch devices; used so hover-revealed controls stay reachable)
- **Colours are Material You tokens, not hand-picked greys.** `src/utils/materialTheme.ts` turns the accent into the M3 palette with Google's `@material/material-color-utilities` (the colour style picked in Settings: `COLOR_STYLES` there lists all nine of the library's schemes, Tonal spot by default, stored as `colorStyle`) and writes it as `--md-*` variables into a `<style id="md-theme">` (`:root` light, `:root.dark` dark). `index.css` maps them to Tailwind names with `@theme inline`, so use classes, never inline accent styles:
  - roles: `bg-primary`/`text-on-primary`, `bg-primary-container`, `bg-secondary-container`/`text-on-secondary-container` (selection, active pills), `bg-tertiary-container` (search-jump highlight, notes), `text-error`/`bg-error-container`, `text-on-surface`, `text-on-surface-variant` (secondary text, icons), `border-outline`/`border-outline-variant` (dividers), `bg-surface-container*`, `bg-inverse-surface`
  - app surfaces: `bg-page` (the tinted background, bars sit on it), `bg-pane` (rounded content panels), `bg-search`, `bg-drawer`, `bg-dialog`, `bg-menu`; `text-success`/`text-warning` for stream checks (M3 has no such roles)
  - they switch with dark mode on their own, so no `dark:` twins. AMOLED is CSS only: `:root.amoled.dark` swaps the surfaces for true black (panes get `border-pane-border`), the accent roles stay generated.
  - the raw `accentColor` is only used for the colour swatches (with `contrastText()` for the tick on them). The favicon uses the palette's primary, like the logo.
  - the snackbar (`bg-snackbar`, `text-on-snackbar`, `text-snackbar-accent`) is dark in every theme: M3's inverse surface would be white in dark mode, which the maintainer rejected
  - on a selected row (`secondary-container`), outlined chips switch to `border-outline` and tags get `tag-on-selected`, or they'd vanish into the selection colour
- **Fonts:** Geist and Geist Mono from `@fontsource-variable/geist(-mono)` (Google Fonts' files, bundled, offline), or the system font when Settings → Font is System (`data-font="system"` on `<html>`). `font-sans`/`font-mono` follow it.
- **Type scale** (one class sets size, line height and weight): `text-headline-sm` (pane and dialog titles), `text-title-lg/md/sm`, `text-body-lg/md/sm`, `text-label-lg/md/sm` (buttons, chips, column headers). Sentence case everywhere, no uppercase labels.
- **Corners** use Tailwind's own scale, which already has M3's steps: `rounded-sm` (menus, fields), `rounded-lg` (chips), `rounded-xl` (cards, notices), `rounded-2xl` (panes, FAB), `rounded-[28px]` (dialogs, sheets, search view), `rounded-full` (buttons, nav items, search fields).
- **Elevation:** surfaces separate by tone; shadows only for floating things: `shadow-level-1/2/3`.
- **Component classes** (in `@layer components`, so Tailwind utilities on the same element win):
  - `.md-btn`: the state layer (8% hover tint, only on the innermost hovered `.md-btn`; M3 focus ring) and the press ripple; put it on every clickable surface
  - buttons: `btn` + `btn-filled` (one per screen, the main action) / `btn-tonal` / `btn-outlined` / `btn-text`; `icon-btn` (40px round, size with `w-*/h-*`); `fab`
  - `tag` (small row labels like "Source lost"), `chip`/`chip-on`, `badge`, `field` + `field-label` (outlined text field), `menu` + `menu-item` + `menu-divider`, `nav-item`/`nav-item-on` (pill rows in the list pane), `checkbox`
- Motion: `--md-standard/decelerate/accelerate` (M3 curves). Entrance classes: `.md-scrim`, `.md-dialog`, `.md-dialog-top`, `.md-menu`, `.md-list-in`, `.md-snackbar-in`, `.md-page-in`, `.md-sheet-in`. `.onboarding-step-in`/`-back`/`.onboarding-pop` are the setup's step slide and Done tick.
- Add any new animation class to the `prefers-reduced-motion` block too.

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
