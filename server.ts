import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { createGunzip } from "zlib";
import { Readable, pipeline } from "stream";
import { XMLParser } from "fast-xml-parser";
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, "db.json");

// Define types matching frontend
interface Playlist {
  id: string;
  name: string;
  userId: string;
  categories: string[];
  exportId: string;
  shortId: number;
  // Set whenever this playlist's M3U is served (short URL or legacy export URL) — i.e. the
  // last time some IPTV player/client actually pulled it, not the last edit. Null until the
  // first such request. Absent entirely on playlists that predate this field (treated as null).
  lastDownloadedAt: number | null;
  // When the user last opened this playlist's sync log. Entries newer than this count as unread.
  // Absent on playlists that predate channel sync (treated as "never opened").
  syncLogReadAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

// ── Channel sync ("linking") types ──
// The channel fields a linked playlist channel can keep in sync with its channel pool channel.
// Category is deliberately not one of them: categories are the user's own organisation.
type SyncField = 'url' | 'name' | 'logo' | 'tvgId';
const SYNC_FIELDS: SyncField[] = ['url', 'name', 'logo', 'tvgId'];
type SyncFieldToggles = Record<SyncField, boolean>;

// A pool channel's values as of the last sync. Comparing a playlist channel's current value
// against this is how sync tells "the user changed this field themselves" (the value differs)
// apart from "still as the provider left it" (the value matches).
interface PoolSnapshot {
  name: string;
  url: string;
  logo: string | null;
  tvgId: string | null;
  // Never synced, but needed to recognise the pool channel again by name + category.
  category: string;
  // Synced together with url (see StreamHeaders). Absent on links made before they existed.
  httpReferrer?: string | null;
  httpUserAgent?: string | null;
}

interface ChannelLink {
  sourceId: string;
  poolEntryId: string;
  fields: SyncFieldToggles;
  lastPool: PoolSnapshot;
  // Provider changes to fields the user had changed themselves, waiting for Apply or Dismiss.
  pending: Partial<Record<SyncField, string | null>>;
  // The pool channel has disappeared from its source.
  lost: boolean;
  // How many refreshes in a row the pool channel has been missing from, before it counts as lost.
  // Absent while the channel is present.
  missingRefreshes?: number;
}

interface Channel {
  id: string;
  playlistId: string;
  name: string;
  url: string;
  logo: string | null;
  tvgId: string | null;
  category: string;
  // See StreamHeaders. Absent when the channel needs none.
  httpReferrer?: string | null;
  httpUserAgent?: string | null;
  order: number;
  isHidden?: boolean;
  // Present only on channels kept in sync with a channel pool channel.
  link?: ChannelLink;
  // True when sync (not the user) hid this channel because its pool channel was lost, so sync
  // is allowed to unhide it again if the channel comes back. Cleared when the user hides or
  // unhides the channel themselves.
  hiddenBySync?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface EpgSource {
  id: string;
  name: string;
  url: string;
  type: 'xml' | 'xtream';
  xtreamCredentials?: { username: string; password: string };
  refreshIntervalHours: number; // configurable per source, default 12
  lastFetched: number | null;
  lastFetchError: string | null; // set when the most recent refresh attempt failed; cleared on success
  channelCount: number;
  createdAt: number;
  updatedAt: number;
}

interface ChannelPoolSource {
  id: string;
  name: string;
  type: 'xtream' | 'playlist-url' | 'playlist-file';
  url: string | null;
  xtreamCredentials?: { username: string; password: string };
  // Sent as the User-Agent header when downloading, because some providers only serve
  // requests that look like a known IPTV app. Absent/empty = Node's default ("node").
  userAgent?: string | null;
  refreshIntervalHours: number;
  lastFetched: number | null;
  lastFetchError: string | null; // set when the most recent refresh attempt failed; cleared on success
  lastFetchErrorAt?: number | null; // when lastFetchError happened; absent on old records
  channelCount: number;
  createdAt: number;
  updatedAt: number;
}

interface ChannelPoolEntry {
  id: string;
  sourceId: string;
  name: string;
  url: string;
  logo: string | null;
  category: string;
  tvgId: string | null;
  // See StreamHeaders. Absent when the provider's playlist doesn't ask for any.
  httpReferrer?: string | null;
  httpUserAgent?: string | null;
}

// Some providers only serve a stream when the player sends a particular Referer and/or
// User-Agent (for example iptv-org's playlists, written as http-referrer="…" / http-user-agent="…"
// attributes and #EXTVLCOPT lines). They belong to the stream link: a different link usually
// needs different ones, so sync treats them as part of `url` rather than as fields of their own.
// Stored only when set, so channels and pool entries without them stay as small as before.
interface StreamHeaders {
  httpReferrer?: string | null;
  httpUserAgent?: string | null;
}
const STREAM_HEADER_FIELDS = ['httpReferrer', 'httpUserAgent'] as const;

function sameStreamHeaders(a: StreamHeaders, b: StreamHeaders): boolean {
  return STREAM_HEADER_FIELDS.every(f => (a[f] || null) === (b[f] || null));
}

function copyStreamHeaders(target: StreamHeaders, from: StreamHeaders) {
  for (const f of STREAM_HEADER_FIELDS) {
    const value = typeof from[f] === 'string' ? from[f]!.trim() : '';
    if (value) target[f] = value;
    else delete target[f];
  }
}

// Only the header fields that are set, for spreading into a new record.
function pickStreamHeaders(from: StreamHeaders): StreamHeaders {
  const headers: StreamHeaders = {};
  copyStreamHeaders(headers, from);
  return headers;
}

interface ChannelPoolChangeLog {
  id: string;
  sourceId: string;
  sourceName: string;
  timestamp: number;
  added: { name: string; category: string }[];
  removed: { name: string; category: string }[];
  renamed: { oldName: string; newName: string; category: string }[];
}

// One event in a playlist's sync log.
// - updated:   sync applied a provider change
// - suggested: a provider change is waiting for Apply or Dismiss
// - applied / dismissed: the user handled a suggestion
// - lost / returned: the pool channel disappeared from / came back to its source
// - held:      many channels vanished in one refresh, so hiding them was held back
// - linked / unlinked: the link was created or removed
interface SyncLogEntry {
  id: string;
  playlistId: string;
  channelId: string | null; // null for playlist-wide entries ('held')
  channelName: string;
  sourceName: string;
  timestamp: number;
  type: 'updated' | 'suggested' | 'applied' | 'dismissed' | 'lost' | 'returned' | 'held' | 'linked' | 'unlinked';
  field?: SyncField;
  oldValue?: string | null;
  newValue?: string | null;
  count?: number; // 'held': how many linked channels went missing
  reason?: 'source-deleted'; // 'unlinked': set when the link went away with its source
}

interface AppSettings {
  // Which fields "Keep in sync with source" syncs when the user doesn't pick custom ones.
  defaultSyncFields: SyncFieldToggles;
  // False until the first-run setup (Onboarding.tsx) is finished, which happens when the first
  // playlist is made (see POST /api/playlists) or a backup with playlists is restored.
  // Absent in databases from before onboarding existed; readDb() fills it in.
  onboardingDone: boolean;
}

// onboardingDone is left out on purpose: readDb() decides it for databases that don't have it,
// and a default here would hide that they don't.
const DEFAULT_SETTINGS: Omit<AppSettings, 'onboardingDone'> = {
  defaultSyncFields: { url: true, name: true, logo: true, tvgId: true },
};

// What db.json holds, and what readDb() returns. Each source's channels and the source update
// log are kept apart from it (see "Where the data lives" below).
interface Database {
  playlists: Playlist[];
  channels: Channel[];
  epgSources: EpgSource[];
  channelPoolSources: ChannelPoolSource[];
  syncLogs: SyncLogEntry[];
  settings: AppSettings;
}

function emptyDb(): Database {
  return { playlists: [], channels: [], epgSources: [], channelPoolSources: [], syncLogs: [], settings: { ...DEFAULT_SETTINGS, onboardingDone: false } };
}

// ── Where the data lives ─────────────────────────────────────────────────
// Everything is kept in memory while the app runs, and loaded from disk only once, at start.
// The app used to read and rewrite one big db.json on every request. With a few large sources
// that file reached tens of MB, so renaming a single channel meant reading it seven times and
// saving it once: seconds of work, and enough memory to push a small server into swap.
//
// On disk the data is split by how often it changes, so a small change saves a small file:
// - data/db.json                playlists, channels, sources' settings, sync log, app settings.
//                               Small. Saved on every change.
// - data/pool/<source id>.json  one source's channels. Saved only when that source is
//                               refreshed, uploaded or deleted.
// - data/pool-changelog.json    the source update log. Saved only when a refresh adds to it.
//
// Because readDb() now hands every caller the *same* object (it used to hand out a fresh copy):
// - a route must check the request first and only then change anything, since a change made
//   before an early `return` would stay in memory without being saved;
// - a route that only reads must not reorder a stored list in place (sort a copy instead).
// Files in data/ are only read at start, so stop the app before replacing them by hand.
const POOL_DIR = path.join(DATA_DIR, "pool");
const CHANGELOG_FILE = path.join(DATA_DIR, "pool-changelog.json");

let memoryDb: Database | null = null;
// Every source's channels, by source id. This is where they live while the app runs.
const channelPoolCache = new Map<string, ChannelPoolEntry[]>();
let channelPoolChangeLogs: ChannelPoolChangeLog[] = [];

// Date and time in UTC for the names of safety copies. No ":" in it: that isn't allowed in
// file names on Windows or some NAS shares.
function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Saves in two steps so a file is never half-written: the data goes into <file>.tmp first,
// and only once that has fully succeeded is it renamed over the real file. A rename is
// all-or-nothing. So if the app crashes or is restarted, the disk fills up, or the power goes
// out mid-save, the file is still the previous complete version, and at worst the last change
// is lost. A failed save leaves a stray .tmp behind; the next save simply overwrites it.
// The .tmp has to sit next to the file: the systemd unit only allows writes in data/, and the
// rename only works within one folder/disk.
// `flush: true` makes sure the .tmp is physically on the disk before the rename. Without
// it, on some filesystems a power cut just after a save can still leave an empty file,
// because the rename can reach the disk before the data does. It costs some time per save
// on slow disks such as SD cards; keeping the data is worth more.
// `indented` keeps db.json readable in a text editor. The big files skip it, which halves
// the work of saving them.
function saveJsonFile(file: string, value: unknown, indented: boolean) {
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, indented ? JSON.stringify(value, null, 2) : JSON.stringify(value), { flush: true });
  fs.renameSync(tmpFile, file);
}

// Source ids are made by the app (uuids), but a restored backup could carry anything, so the
// id is encoded: it can then never point outside data/pool/.
function poolFileOf(sourceId: string): string {
  return path.join(POOL_DIR, `${encodeURIComponent(sourceId)}.json`);
}

// Saves one source's channels as they are in memory right now.
function savePoolEntries(sourceId: string) {
  fs.mkdirSync(POOL_DIR, { recursive: true });
  saveJsonFile(poolFileOf(sourceId), channelPoolCache.get(sourceId) || [], false);
}

function deletePoolEntries(sourceId: string) {
  channelPoolCache.delete(sourceId);
  fs.rmSync(poolFileOf(sourceId), { force: true });
}

function saveChangeLogs() {
  saveJsonFile(CHANGELOG_FILE, channelPoolChangeLogs, false);
}

// The channels of every source in one list, for the few places that look across sources.
function allPoolEntries(): ChannelPoolEntry[] {
  return Array.from(channelPoolCache.values()).flat();
}

// The whole database as JSON text, in the one-file shape db.json had before it was split.
// Backups still use this shape, so backups made by any version can be restored by any version.
// The text is handed out in pieces (db.json first, then the sources' channels 5,000 at a time,
// then the update log) instead of as one piece: with a few hundred thousand source channels
// the whole text is hundreds of MB, and building it in one go ran a 1 GB server out of memory.
function* fullDatabasePieces(): Generator<string> {
  const core = JSON.stringify(readDb(), null, 2);
  // db.json's text without its closing "}", so the two big lists can be added inside it.
  yield core.slice(0, core.lastIndexOf('}')).trimEnd();
  yield ',\n  "channelPoolEntries": [';
  let first = true;
  for (const entries of channelPoolCache.values()) {
    for (let i = 0; i < entries.length; i += 5000) {
      const list = JSON.stringify(entries.slice(i, i + 5000)); // "[{…},{…}]"
      yield (first ? '\n' : ',\n') + list.slice(1, -1);       // the same without the [ ]
      first = false;
    }
  }
  yield '\n  ],\n  "channelPoolChangeLogs": ';
  yield JSON.stringify(channelPoolChangeLogs);
  yield '\n}\n';
}

// Saves a full backup next to db.json, piece by piece, with the same tmp-file-then-rename
// steps as saveJsonFile().
function saveFullDatabaseCopy(file: string) {
  const tmpFile = `${file}.tmp`;
  const handle = fs.openSync(tmpFile, 'w');
  try {
    for (const piece of fullDatabasePieces()) fs.writeSync(handle, piece);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tmpFile, file);
}

// Reads one of the big list files. A missing file is an empty list (a source that hasn't been
// downloaded yet). A damaged one is moved aside like a damaged db.json (see setAsideDamagedDb):
// the source's channels simply download again on the next refresh.
function readSavedList<T>(file: string): T[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Can't read ${file} (${(e as Error).message}). Nothing was changed. Check the file's permissions and that the disk is healthy.`);
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* handled below, together with "valid JSON but not a list" */ }
  const backupFile = `${file}.corrupt-${fileStamp()}`;
  fs.renameSync(file, backupFile);
  console.error(`${file} is damaged and couldn't be loaded. It was moved, unchanged, to ${backupFile}. Sources download their channels again on their next refresh.`);
  return [];
}

// A file read from disk gives every channel its own copy of its source id and category name,
// although thousands of channels share the same few. This makes them share one copy again,
// which saves about 100 bytes a channel (100 MB for a million channels).
function shareRepeatedText(entries: ChannelPoolEntry[], sourceId: string): ChannelPoolEntry[] {
  const categories = new Map<string, string>();
  for (const entry of entries) {
    entry.sourceId = sourceId;
    if (!categories.has(entry.category)) categories.set(entry.category, entry.category);
    entry.category = categories.get(entry.category)!;
  }
  return entries;
}

// Fills in whatever a database from an older version doesn't have yet.
function withDefaults(parsed: any): Database {
  if (!parsed.epgSources) parsed.epgSources = [];
  if (!parsed.channelPoolSources) parsed.channelPoolSources = [];
  if (!parsed.syncLogs) parsed.syncLogs = [];
  parsed.settings = {
    ...DEFAULT_SETTINGS,
    ...(parsed.settings || {}),
    defaultSyncFields: { ...DEFAULT_SETTINGS.defaultSyncFields, ...(parsed.settings?.defaultSyncFields || {}) },
    // A database from before onboarding existed counts as set up once it has anything in it,
    // so people updating m3u4me never get the welcome screens. New installs start with an
    // explicit false (emptyDb), so this guess only applies to those older databases.
    onboardingDone: parsed.settings?.onboardingDone ?? (
      (parsed.playlists?.length || 0) > 0 || parsed.channelPoolSources.length > 0 || parsed.epgSources.length > 0
    ),
  };
  return parsed;
}

// Returns the database. The first call loads it from disk; every later call returns the same
// object straight from memory, which is what makes requests fast. If loading fails, nothing is
// kept, so the next call tries again.
function readDb(): Database {
  if (!memoryDb) memoryDb = loadDbFromDisk();
  return memoryDb;
}

function loadDbFromDisk(): Database {
  channelPoolCache.clear();
  channelPoolChangeLogs = [];

  let text: string;
  try {
    text = fs.readFileSync(DB_FILE, "utf-8");
  } catch (e) {
    // No db.json at all is the one case where "start with an empty database" is right.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
    // Anything else (no permission, a failing SD card…) means the data is there but can't be
    // read right now. Treating that as empty would let the next save replace it for good,
    // so stop with an error instead, and nothing gets written.
    throw new Error(`Can't read ${DB_FILE} (${(e as Error).message}). Nothing was changed. Check the file's permissions and that the disk is healthy.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return setAsideDamagedDb();
  }

  // A db.json from before the split (m3u4me 3.0.0 and older), or one copied in by hand, still
  // has the sources' channels and the update log inside it. Split it now, once.
  if (parsed.channelPoolEntries || parsed.channelPoolChangeLogs) {
    keepCopyOfOldDb();
    try {
      return storeFullDatabase(parsed);
    } catch (e) {
      throw new Error(`Can't finish updating the data folder for this version of m3u4me (${(e as Error).message}). Your data is untouched in ${DB_FILE}. Check that m3u4me can write to its data folder and that the disk isn't full, then start it again.`);
    }
  }

  const db = withDefaults(parsed);
  for (const source of db.channelPoolSources) {
    channelPoolCache.set(source.id, shareRepeatedText(readSavedList<ChannelPoolEntry>(poolFileOf(source.id)), source.id));
  }
  channelPoolChangeLogs = readSavedList<ChannelPoolChangeLog>(CHANGELOG_FILE);
  return db;
}

// Before an old one-file db.json is split, it's kept as db.json.before-split-<date and time>,
// so going back to an older m3u4me stays possible (put it back as db.json). A hard link is
// tried first: it's a second name for the same file, so it takes no time and no disk space,
// and it keeps the old content when db.json is replaced. Disks that can't do that (some
// network shares) get a normal copy. If neither works the split still goes ahead: it never
// removes anything, the same data just ends up in several files.
function keepCopyOfOldDb() {
  const copyFile = `${DB_FILE}.before-split-${fileStamp()}`;
  try {
    fs.linkSync(DB_FILE, copyFile);
  } catch {
    try {
      fs.copyFileSync(DB_FILE, copyFile);
    } catch (e) {
      console.error(`Couldn't keep a copy of the old ${DB_FILE} (${(e as Error).message}). Carrying on without one.`);
    }
  }
}

// Takes a whole database in the one-file shape (an old db.json, or a backup), saves it as the
// split files and makes it the database in memory. The big files are written first and db.json
// last, so until the very last step an old db.json on disk is still complete.
function storeFullDatabase(full: any): Database {
  const entries: ChannelPoolEntry[] = Array.isArray(full.channelPoolEntries) ? full.channelPoolEntries : [];
  const changeLogs: ChannelPoolChangeLog[] = Array.isArray(full.channelPoolChangeLogs) ? full.channelPoolChangeLogs : [];
  delete full.channelPoolEntries;
  delete full.channelPoolChangeLogs;
  const db = withDefaults(full);

  // Channels of a source that no longer exists are left out.
  const bySource = new Map<string, ChannelPoolEntry[]>(db.channelPoolSources.map(s => [s.id, []]));
  for (const entry of entries) bySource.get(entry.sourceId)?.push(entry);

  // Whatever was in data/pool/ belonged to the database being replaced.
  fs.rmSync(POOL_DIR, { recursive: true, force: true });
  channelPoolCache.clear();
  for (const [sourceId, list] of bySource.entries()) {
    channelPoolCache.set(sourceId, shareRepeatedText(list, sourceId));
    savePoolEntries(sourceId);
  }
  channelPoolChangeLogs = changeLogs;
  saveChangeLogs();
  writeDb(db);
  return db;
}

// db.json exists but isn't valid JSON, most likely because it was cut off by a power cut or
// a full disk while an older version of the app was saving it (saveJsonFile() above can't do
// that any more). Two simpler options were rejected:
// - Starting empty, as the app used to, means the next save overwrites the real data for good.
// - Refusing to start leaves a restart loop under systemd/Docker and a page that won't load,
//   which a non-developer can't diagnose either.
// So the damaged file is moved aside untouched, to db.json.corrupt-<date and time>, where it
// can be repaired, and the app carries on with an empty database. Moving it (rather than
// copying it) means this happens once, not again at every start. If the move itself fails,
// the error stops the read and nothing gets written.
function setAsideDamagedDb(): Database {
  const backupFile = `${DB_FILE}.corrupt-${fileStamp()}`;
  fs.renameSync(DB_FILE, backupFile);
  console.error(
    `${DB_FILE} is damaged (not valid JSON) and couldn't be loaded. ` +
    `It was moved, unchanged, to ${backupFile}, and the app is continuing with an empty database. ` +
    `To get your data back, stop the app, repair that file (or use a backup copy of db.json), ` +
    `put it back as ${DB_FILE} and start the app again.`
  );
  return emptyDb();
}

// Saves db.json (see saveJsonFile for how) and makes `data` the database in memory. Routes
// pass back the object readDb() gave them; a restore passes a new one.
function writeDb(data: Database) {
  memoryDb = data;
  saveJsonFile(DB_FILE, data, true);
}

// Initial DB
if (!fs.existsSync(DB_FILE)) {
  writeDb(emptyDb());
}

// ── EPG Cache and Parser ─────────────────────────────────────────────────
interface ParsedEpgChannel {
  id: string;
  displayName: string;
  icon: string | null;
}

interface ParsedEpgProgramme {
  channel: string;
  title: string;
  desc: string | null;
  start: string;
  stop: string;
  category: string | null;
  date: string | null;
  episodeNum: string | null;
  icon: string | null;
  rating: string | null;
}

// ── Where TV guides are kept ──
// A guide can be huge (hundreds of MB, millions of programmes), so only its channel list is
// kept in memory. The programmes are on disk, in data/epg/:
// - <source id>.<date and time>.programmes  one programme per line, in the order the guide
//                                           listed them
// - <source id>.json                        the channel list, the name of that programmes file,
//                                           and where each channel's programmes are in it
// Guides used to live in memory only, programmes included: a big guide took gigabytes, and
// every restart started with all guides empty until they had downloaded again.
const EPG_DIR = path.join(DATA_DIR, "epg");

interface EpgGuide {
  channels: ParsedEpgChannel[];
  // The programmes file's name inside data/epg/. Every download writes a new file, and the
  // old one is only removed once the new guide is saved, so the two never mix.
  file: string;
  // Where each channel's programmes are in that file, as pairs of numbers: start, length,
  // start, length… (in bytes). Guides nearly always list a channel's programmes together, so
  // most channels have a single pair.
  runs: Map<string, number[]>;
}

// Every downloaded guide, by source id.
const epgGuides = new Map<string, EpgGuide>();

function epgSummaryFile(sourceId: string): string {
  return path.join(EPG_DIR, `${encodeURIComponent(sourceId)}.json`);
}

// Reads the programmes of some of a guide's channels from disk. A channel the guide doesn't
// have gets no entry. If the file has just been replaced by a newer download (possible while
// a long answer is being sent in pieces), the result is simply empty.
function readChannelProgrammes(guide: EpgGuide, channelIds: string[]): Map<string, ParsedEpgProgramme[]> {
  const result = new Map<string, ParsedEpgProgramme[]>();
  let handle: number;
  try {
    handle = fs.openSync(path.join(EPG_DIR, guide.file), "r");
  } catch {
    return result;
  }
  try {
    for (const channelId of channelIds) {
      const runs = guide.runs.get(channelId);
      if (!runs) continue;
      const programmes: ParsedEpgProgramme[] = [];
      for (let i = 0; i < runs.length; i += 2) {
        const buffer = Buffer.alloc(runs[i + 1]);
        fs.readSync(handle, buffer, 0, runs[i + 1], runs[i]);
        for (const line of buffer.toString("utf-8").split("\n")) {
          if (!line) continue;
          try { programmes.push(JSON.parse(line)); } catch { /* a damaged line is skipped */ }
        }
      }
      result.set(channelId, programmes);
    }
  } finally {
    fs.closeSync(handle);
  }
  return result;
}

// Loads the saved guides at start, so they're there straight away instead of after a new
// download, and tidies data/epg/: files that no saved guide points to (a download that was
// interrupted, a guide whose source is gone) are removed.
function loadSavedGuides() {
  epgGuides.clear();
  if (!fs.existsSync(EPG_DIR)) return;
  const keep = new Set<string>();
  for (const source of readDb().epgSources) {
    const summaryFile = epgSummaryFile(source.id);
    try {
      const saved = JSON.parse(fs.readFileSync(summaryFile, "utf-8"));
      if (!Array.isArray(saved.channels) || !Array.isArray(saved.runs) || typeof saved.file !== "string") continue;
      // path.basename: the name is only ever looked up inside data/epg/.
      const file = path.basename(saved.file);
      if (!fs.existsSync(path.join(EPG_DIR, file))) continue;
      epgGuides.set(source.id, { channels: saved.channels, file, runs: new Map(saved.runs) });
      keep.add(path.basename(summaryFile));
      keep.add(file);
    } catch {
      // No saved guide, or an unreadable one: it counts as not downloaded yet and is fetched
      // again (see epgSourcesDue).
    }
  }
  for (const name of fs.readdirSync(EPG_DIR)) {
    if (!keep.has(name)) fs.rmSync(path.join(EPG_DIR, name), { force: true });
  }
}

// Forgets one guide and removes its files.
function deleteSavedGuide(sourceId: string) {
  const guide = epgGuides.get(sourceId);
  epgGuides.delete(sourceId);
  if (guide) fs.rmSync(path.join(EPG_DIR, guide.file), { force: true });
  fs.rmSync(epgSummaryFile(sourceId), { force: true });
}

// Lowercases text and strips accents, for search matching: NFD splits Ș, Ț, Ă, Â, Î into the
// base letter plus a combining mark, which the regex drops, so "stiri" finds "Știri".
// Mirrors src/utils/foldText.ts (the frontend shares no code with this file).
// Text made only of plain English letters, digits and symbols has no accents to strip. That's
// almost every stream link and most names, and skipping the accent work for them makes a
// search across tens of thousands of channels several times faster. The result is the same.
const PLAIN_TEXT = /^[\x00-\x7f]*$/;
function foldText(text: string): string {
  if (PLAIN_TEXT.test(text)) return text.toLowerCase();
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['channel', 'programme', 'display-name', 'category', 'icon'].includes(name),
  // Keep tag text as-is (e.g. a channel display-name of "20" should stay the
  // string "20", not become the number 20 — downstream code assumes strings).
  parseTagValue: false,
});

// EPG sources are often large (multi-MB XMLTV documents) fetched over the
// open internet — without a timeout, a stalled connection would hang the
// refresh forever instead of failing and letting it be retried.
const EPG_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// A download that sends nothing for this long is given up on. (EPG_FETCH_TIMEOUT_MS above only
// covers the wait for the server's first answer.)
const EPG_STALL_TIMEOUT_MS = 60_000;
// The most text that may pile up without a complete <channel> or <programme> in it. Real ones
// are a few hundred bytes; this only stops a file that isn't a guide from filling the memory.
const EPG_MAX_ELEMENT_LENGTH = 16_000_000;

// Downloads a guide and saves its programmes to a new file in data/epg/. Returns the guide
// (channel list, file name, where each channel's programmes are); the caller makes it current.
//
// The download is read as it arrives, never as a whole. The app used to fetch the entire
// file, turn it into one piece of text and read it in one go, with every programme kept in
// memory afterwards. A 300 MB guide then froze the app for 7 to 10 seconds and took about
// 4 GB, and on a 1 GB server a 100 MB guide stopped the app altogether. Now each small part
// that arrives is read and written out straight away, and other requests get their turn in
// between, so a guide of any size needs little memory and never freezes the app.
async function downloadGuide(source: EpgSource): Promise<EpgGuide> {
  let fetchUrl = source.url;
  if (source.type === 'xtream' && source.xtreamCredentials) {
    const baseUrl = source.url.replace(/\/$/, '');
    fetchUrl = `${baseUrl}/xmltv.php?username=${encodeURIComponent(source.xtreamCredentials.username)}&password=${encodeURIComponent(source.xtreamCredentials.password)}`;
  }

  const res = await fetchWithTimeout(fetchUrl, EPG_FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.statusText}`);

  const getText = (val: any) => typeof val === 'object' && val !== null ? val['#text'] || '' : val;

  // Some providers put a programme's description in <sub-title> instead of <desc>. Fold the
  // sub-title into the description ("sub-title / desc") so it shows up in the EPG guide and the
  // /:shortId/epg export instead of being dropped. A sub-title that repeats the desc isn't doubled.
  const mergeSubTitleIntoDesc = (rawSubTitle: string | undefined, rawDesc: string | undefined): string | null => {
    // Trimmed here because the parser trims plain text but leaves CDATA content padded.
    const subTitle = (rawSubTitle || '').trim();
    const desc = (rawDesc || '').trim();
    if (subTitle && desc && subTitle !== desc) return `${subTitle} / ${desc}`;
    return desc || subTitle || null;
  };

  const channels: ParsedEpgChannel[] = [];
  const runs = new Map<string, number[]>();
  fs.mkdirSync(EPG_DIR, { recursive: true });
  const file = `${encodeURIComponent(source.id)}.${fileStamp()}.programmes`;
  const filePath = path.join(EPG_DIR, file);
  const handle = fs.openSync(filePath, 'w');
  let position = 0; // how many bytes have been written to the programmes file so far

  // Reads some complete <channel> and <programme> elements (with the same XML reader and the
  // same fields as always) and writes the programmes to the file, one per line.
  const readElements = (xml: string) => {
    const tv = xmlParser.parse(`<tv>${xml}</tv>`).tv || {};
    for (const c of tv.channel || []) {
      channels.push({
        id: c['@_id'] || '',
        displayName: (c['display-name'] && c['display-name'][0] ? getText(c['display-name'][0]) : '') || '',
        icon: (c.icon && c.icon[0] ? c.icon[0]['@_src'] : null) || null,
      });
    }
    let lines = '';
    for (const p of tv.programme || []) {
      const programme: ParsedEpgProgramme = {
        channel: p['@_channel'] || '',
        start: p['@_start'] || '',
        stop: p['@_stop'] || '',
        title: getText(p.title) || '',
        desc: mergeSubTitleIntoDesc(getText(p['sub-title']), getText(p.desc)),
        category: p.category && p.category.length > 0 ? getText(p.category[0]) : null,
        date: p.date ? String(p.date) : null,
        episodeNum: p['episode-num'] ? getText(p['episode-num']) : null,
        icon: (p.icon && p.icon[0] ? p.icon[0]['@_src'] : null) || null,
        rating: p.rating && p.rating.value ? String(p.rating.value) : null,
      };
      const line = JSON.stringify(programme) + '\n';
      const length = Buffer.byteLength(line);
      // Remember where this programme is. If it directly follows the channel's previous one,
      // that run just gets longer; otherwise a new run starts.
      const channelRuns = runs.get(programme.channel);
      if (!channelRuns) runs.set(programme.channel, [position, length]);
      else if (channelRuns[channelRuns.length - 2] + channelRuns[channelRuns.length - 1] === position) channelRuns[channelRuns.length - 1] += length;
      else channelRuns.push(position, length);
      position += length;
      lines += line;
    }
    if (lines) fs.writeSync(handle, lines);
  };

  try {
    if (!res.body) throw new Error('The server sent an empty answer.');
    const download = Readable.fromWeb(res.body as any);
    // Look at the first bytes to see whether the guide is gzip-compressed (many are), then put
    // them back. A compressed guide is unpacked as it arrives.
    const firstBytes: Buffer | null = await new Promise((resolve, reject) => {
      download.once('error', reject);
      download.once('readable', () => resolve(download.read()));
    });
    if (firstBytes) download.unshift(firstBytes);
    const isGzip = !!firstBytes && firstBytes.length > 2 && firstBytes[0] === 0x1F && firstBytes[1] === 0x8B;
    // pipeline() (rather than .pipe()) passes a failed download on to the unpacker, so the
    // loop below ends with that error instead of waiting forever.
    const input: Readable = isGzip ? pipeline(download, createGunzip(), () => {}) as unknown as Readable : download;

    let stallTimer = setTimeout(() => {}, 0);
    const restartStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => input.destroy(new Error(`The download stopped sending data for ${EPG_STALL_TIMEOUT_MS / 1000}s`)), EPG_STALL_TIMEOUT_MS);
    };

    // `rest` holds the text that has arrived but doesn't end on a complete element yet.
    // Whenever it contains complete <channel> or <programme> elements, everything up to the
    // end of the last one is cut off and read. (A description that itself contained the text
    // "</programme>" would be cut in the wrong place. No real guide does that.)
    const decoder = new TextDecoder('utf-8');
    let rest = '';
    let started = false; // true once the first <channel> or <programme> has been seen
    let chunkCount = 0;
    try {
      restartStallTimer();
      for await (const chunk of input) {
        restartStallTimer();
        rest += decoder.decode(chunk as Buffer, { stream: true });
        if (!started) {
          // Skip what comes before the first element (the <?xml…?> line and the <tv> tag).
          const firstChannel = rest.indexOf('<channel');
          const firstProgramme = rest.indexOf('<programme');
          const first = firstChannel === -1 ? firstProgramme : firstProgramme === -1 ? firstChannel : Math.min(firstChannel, firstProgramme);
          if (first === -1) {
            // Nothing yet. Keep only the last few characters, in case a tag was split between
            // two parts. A file that isn't a guide (a web page…) is thrown away as it arrives
            // this way, and ends up as an empty guide, as it always has.
            rest = rest.slice(-20);
            continue;
          }
          rest = rest.slice(first);
          started = true;
        }
        const lastChannelEnd = rest.lastIndexOf('</channel>');
        const lastProgrammeEnd = rest.lastIndexOf('</programme>');
        const end = Math.max(
          lastChannelEnd === -1 ? 0 : lastChannelEnd + '</channel>'.length,
          lastProgrammeEnd === -1 ? 0 : lastProgrammeEnd + '</programme>'.length,
        );
        if (end > 0) {
          readElements(rest.slice(0, end));
          rest = rest.slice(end);
        } else if (rest.length > EPG_MAX_ELEMENT_LENGTH) {
          throw new Error("This doesn't look like a TV guide (XMLTV) file. Check the guide's link.");
        }
        // Let other requests have their turn, so the app keeps answering during a long guide.
        if (++chunkCount % 4 === 0) await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      clearTimeout(stallTimer);
    }
    // A channel or programme that started but never finished means the download was cut off.
    // Keeping half a guide would replace a complete one, so it counts as failed.
    if (rest.includes('<programme') || rest.includes('<channel')) {
      throw new Error('The download was cut off before the end of the guide.');
    }
    fs.fsyncSync(handle);
  } catch (err) {
    fs.closeSync(handle);
    fs.rmSync(filePath, { force: true });
    throw err;
  }
  fs.closeSync(handle);
  return { channels, file, runs };
}

// Downloads one guide. If that guide is already being downloaded (the Refresh button pressed
// while the timer's refresh is running, say), no second download starts: the caller just
// waits for the running one.
const epgRefreshesRunning = new Map<string, Promise<void>>();
function refreshEpgSource(sourceId: string): Promise<void> {
  const running = epgRefreshesRunning.get(sourceId);
  if (running) return running;
  const refresh = downloadAndSaveGuide(sourceId).finally(() => epgRefreshesRunning.delete(sourceId));
  epgRefreshesRunning.set(sourceId, refresh);
  return refresh;
}

async function downloadAndSaveGuide(sourceId: string) {
  const db = readDb();
  const source = db.epgSources.find(s => s.id === sourceId);
  if (!source) return;
  try {
    const guide = await downloadGuide(source);

    const updatedDb = readDb();
    const idx = updatedDb.epgSources.findIndex(s => s.id === sourceId);
    // The source was deleted, or replaced by restoring a backup, during the fetch. Its guide
    // data mustn't be kept: the /:shortId/epg feed reads every saved guide.
    if (idx === -1) {
      fs.rmSync(path.join(EPG_DIR, guide.file), { force: true });
      return;
    }
    // Saving the summary is what makes the new guide the current one: it names the new
    // programmes file. Only then is the previous file removed. If the app stops in between,
    // the leftover file is tidied away at the next start (loadSavedGuides).
    const previous = epgGuides.get(sourceId);
    saveJsonFile(epgSummaryFile(sourceId), { channels: guide.channels, file: guide.file, runs: [...guide.runs] }, false);
    epgGuides.set(sourceId, guide);
    if (previous) fs.rmSync(path.join(EPG_DIR, previous.file), { force: true });
    updatedDb.epgSources[idx].lastFetched = Date.now();
    updatedDb.epgSources[idx].channelCount = guide.channels.length;
    updatedDb.epgSources[idx].lastFetchError = null;
    writeDb(updatedDb);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to refresh EPG source ${source.name}:`, err);
    const updatedDb = readDb();
    const idx = updatedDb.epgSources.findIndex(s => s.id === sourceId);
    if (idx !== -1) {
      updatedDb.epgSources[idx].lastFetchError = message;
      writeDb(updatedDb);
    }
  }
}

// The guides that should be downloaded now: never downloaded (or nothing saved on disk, as
// right after updating from a version that kept guides in memory), failed last time, or older
// than their refresh interval. A failed guide is therefore retried on every check until it
// works, instead of sitting empty until its interval comes round.
function epgSourcesDue(): string[] {
  const now = Date.now();
  return readDb().epgSources.filter(source => {
    const intervalMs = (source.refreshIntervalHours || 12) * 60 * 60 * 1000;
    return !source.lastFetched || !epgGuides.has(source.id) || source.lastFetchError || (now - source.lastFetched) > intervalMs;
  }).map(source => source.id);
}

// Refreshes EPG sources one at a time instead of all at once, so a batch of
// sources (e.g. every source refreshing together at server boot) doesn't
// pile concurrent large-file fetches onto the same moment — which is what
// can make an otherwise-healthy source fail its refresh right when the
// server starts.
async function refreshEpgSourcesSequentially(sourceIds: string[]) {
  for (const id of sourceIds) {
    await refreshEpgSource(id);
  }
}

// ── Channel Pool Functions ───────────────────────────────────────────────
// (The channels themselves live in channelPoolCache, declared with the storage code above.)

// Some providers run several servers behind one address. When one of those servers is down, the
// front server answers instantly with 502/503/504, while the very next identical request may work
// (TiviOne failed 7 of 12 back-to-back requests this way). Retrying a few times after a short pause
// turns most of those into a successful refresh instead of a "Refresh failed" badge.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const FETCH_ATTEMPTS = 5;

async function fetchWithRetry(url: string, userAgent?: string | null): Promise<Response> {
  // Without a custom user agent nothing is set, so Node sends its own ("node"), as it always has.
  const init: RequestInit = userAgent ? { headers: { 'User-Agent': userAgent } } : {};
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE_STATUSES.has(res.status) || attempt === FETCH_ATTEMPTS) return res;
    // The failed response's body isn't needed; cancel it so the connection is released.
    await res.body?.cancel().catch(() => {});
    // Waits 3s, 6s, 9s, then 12s between attempts.
    await new Promise(resolve => setTimeout(resolve, attempt * 3000));
  }
}

// The messages below end up in `lastFetchError`, which the Sources tab shows in full when you open
// a source whose download failed. They're for the user, not a developer, so each one says what went
// wrong in plain words and what to try next.
const USER_AGENT_HINT = "Some providers only allow certain IPTV apps, so try another user agent in the source's settings.";

function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `The provider refused the download (error ${status}). Check the login details and whether your subscription is still active. ${USER_AGENT_HINT}`;
  }
  if (status === 404) return `Nothing was found at this address (error 404). Check the link in the source's settings.`;
  if (status === 429) return `The provider says there were too many requests (error 429). m3u4me tries again every 5 minutes.`;
  // Some Xtream providers answer 451 once a subscription has expired (both of the maintainer's
  // did, whatever the user agent), so that's named first. It can also be an app block.
  if (status === 451) {
    return `The provider is refusing downloads (error 451). Some providers answer this way once a subscription has expired, so check that yours is still active. If it is, the provider may only allow certain IPTV apps, so try another user agent in the source's settings.`;
  }
  if (status >= 500) {
    return `The provider's server isn't working right now (error ${status}). This is usually temporary, and m3u4me tries again every 5 minutes.`;
  }
  return `The provider turned the download down (error ${status}). ${USER_AGENT_HINT}`;
}

// Turns whatever a failed download threw into a plain-language message. Errors this file threw on
// purpose (the HTTP and Xtream checks) already read well and pass through untouched. Network
// failures arrive from fetch as a bare "fetch failed" with the real reason in `cause.code`.
function describeSourceFetchError(err: unknown, url: string | null): string {
  let host = 'the server';
  try { if (url) host = `"${new URL(url).host}"`; } catch { /* keeps the generic wording */ }

  const cause = (err as { cause?: { code?: string; message?: string; errors?: { code?: string }[] } } | null)?.cause;
  // A host with several addresses that all refuse the connection reports an AggregateError,
  // whose individual errors carry the code.
  const code = cause?.code || cause?.errors?.[0]?.code || (err as { code?: string } | null)?.code || '';

  if (code === 'ERR_INVALID_URL') return `The source's address isn't a valid link. Check it in the source's settings.`;
  if (code === 'ENOTFOUND') return `Couldn't find the server ${host}. Check the address for typos.`;
  if (code === 'EAI_AGAIN') return `Couldn't look up the server ${host}. Check this computer's internet connection, then try again.`;
  if (code === 'ECONNREFUSED') return `The server ${host} refused the connection. Check the address and port, or try again later.`;
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return `The connection to ${host} was cut off during the download. Try again later. ${USER_AGENT_HINT}`;
  }
  if (code === 'ETIMEDOUT' || (code.startsWith('UND_ERR_') && code.endsWith('_TIMEOUT'))) {
    return `The server ${host} took too long to answer. Try again later.`;
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return `Couldn't reach the server ${host}. Check this computer's internet connection, then try again.`;
  }
  if (code.includes('CERT') || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')) {
    return `The server ${host} has a security certificate that isn't valid. Try the address with http:// instead of https://.`;
  }
  if (code) return `Couldn't connect to the server ${host} (${code}). Check the address, or try again later.`;
  // Some network failures carry no code at all, only a short reason (e.g. "bad port").
  if (err instanceof TypeError && err.message === 'fetch failed') {
    return `Couldn't connect to the server ${host}${cause?.message ? ` (${cause.message})` : ''}. Check the address, or try again later.`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Reads an Xtream API answer, which should be a JSON array. Panels answer HTTP 200 even for a bad
// or expired login, with an error object instead of the array. Treating that as "zero channels"
// would make a login hiccup look like a real, empty refresh and wipe out every cached channel, so
// it's a failure instead (refreshChannelPoolSource leaves the cached entries untouched on error).
async function readXtreamList(res: Response): Promise<any[]> {
  if (!res.ok) throw new Error(httpErrorMessage(res.status));
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (Array.isArray(data)) return data;
  const userInfo = data?.user_info;
  if (userInfo && (userInfo.auth === 0 || userInfo.auth === '0')) {
    throw new Error("The provider rejected the username or password. Check them in the source's settings, or ask your provider whether the subscription is still active.");
  }
  if (userInfo?.status && String(userInfo.status).toLowerCase() !== 'active') {
    throw new Error(`The provider says this account is "${userInfo.status}". Ask your provider about your subscription.`);
  }
  throw new Error(`The server didn't answer like an Xtream Codes server. Check the server URL: it should be just the address and port, like http://example.com:8080. ${USER_AGENT_HINT}`);
}

async function fetchXtreamChannels(source: ChannelPoolSource): Promise<ChannelPoolEntry[]> {
  if (!source.url || !source.xtreamCredentials) return [];
  const baseUrl = source.url.replace(/\/$/, '');
  const { username, password } = source.xtreamCredentials;

  const catData = await readXtreamList(await fetchWithRetry(`${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`, source.userAgent));
  const catMap = new Map<string, string>();
  for (const c of catData) {
    catMap.set(String(c.category_id), c.category_name || 'General');
  }

  const streamsData = await readXtreamList(await fetchWithRetry(`${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`, source.userAgent));

  // The stream link is put together with join() on purpose. Gluing the pieces with `${…}`
  // makes Node keep every piece separately in memory until the text is first read, which for
  // a big provider costs more than the rest of the channel put together (about 220 bytes a
  // channel, measured: 220 MB for a million channels). join() makes one plain piece of text.
  const streamUrlStart = `${baseUrl}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/`;
  const entries: ChannelPoolEntry[] = [];
  for (const s of streamsData) {
    entries.push({
      id: uuidv4(),
      sourceId: source.id,
      name: s.name || 'Unknown',
      url: [streamUrlStart, s.stream_id, '.ts'].join(''),
      logo: s.stream_icon || null,
      category: catMap.get(String(s.category_id)) || 'General',
      tvgId: s.epg_channel_id || null,
    });
  }
  return entries;
}

// Splits an #EXTINF line into its attributes and the channel name. The name starts after the
// first comma that isn't inside a quoted attribute value: values like a browser user-agent
// ("…(KHTML, like Gecko)…") contain commas of their own, and cutting at the very first comma
// turned the rest of that value into the channel name.
function splitExtinf(line: string): { attrs: string; name: string } {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) return { attrs: line.slice(0, i), name: line.slice(i + 1).trim() };
  }
  return { attrs: line, name: '' };
}

function parseM3uToChannelPoolEntries(content: string, sourceId: string): ChannelPoolEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: ChannelPoolEntry[] = [];
  let currentEntry: Partial<ChannelPoolEntry> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      // Attributes are read only from the part before the name, so a name that happens to
      // contain text like tvg-logo="…" isn't mistaken for one.
      const { attrs, name } = splitExtinf(line);
      const attr = (key: string) => attrs.match(new RegExp(`(?:^|\\s)${key}="([^"]+)"`, 'i'))?.[1] || null;

      currentEntry = {
        tvgId: attr('tvg-id'),
        logo: attr('tvg-logo'),
        category: attr('group-title') || 'General',
        name: name || 'Unknown',
        httpReferrer: attr('http-referrer'),
        httpUserAgent: attr('http-user-agent'),
      };
    } else if (line.startsWith('#EXTVLCOPT:') && currentEntry.name) {
      // VLC's way of writing the same headers, on lines between #EXTINF and the stream link.
      const opt = line.slice('#EXTVLCOPT:'.length);
      const eq = opt.indexOf('=');
      const key = eq === -1 ? '' : opt.slice(0, eq).trim().toLowerCase();
      const value = eq === -1 ? '' : opt.slice(eq + 1).trim();
      if (value && key === 'http-referrer') currentEntry.httpReferrer = value;
      if (value && key === 'http-user-agent') currentEntry.httpUserAgent = value;
    } else if (line && !line.startsWith('#')) {
      if (currentEntry.name) {
        entries.push({
          id: uuidv4(),
          sourceId,
          name: currentEntry.name || 'Unknown',
          url: line,
          logo: currentEntry.logo || null,
          category: currentEntry.category || 'General',
          tvgId: currentEntry.tvgId || null,
          ...pickStreamHeaders(currentEntry),
        });
        currentEntry = {};
      }
    }
  }
  return entries;
}

function parseXspfToChannelPoolEntries(content: string, sourceId: string): ChannelPoolEntry[] {
  const parsed = xmlParser.parse(content);
  const trackList = parsed?.playlist?.trackList?.track || [];
  const tracks = Array.isArray(trackList) ? trackList : [trackList];
  
  return tracks.map((t: any) => {
    let cat = 'General';
    if (t.extension && t.extension.application) cat = t.extension.application;
    if (t.annotation) cat = t.annotation;
    
    return {
      id: uuidv4(),
      sourceId,
      name: t.title || 'Unknown',
      url: t.location || '',
      logo: t.image || null,
      category: cat,
      tvgId: null,
    };
  }).filter((e: any) => e.url);
}

async function fetchPlaylistChannels(source: ChannelPoolSource): Promise<ChannelPoolEntry[]> {
  if (!source.url) return [];
  const res = await fetchWithRetry(source.url, source.userAgent);
  if (!res.ok) throw new Error(httpErrorMessage(res.status));
  const content = await res.text();
  const entries = content.trim().startsWith('<?xml') && content.includes('<playlist')
    ? parseXspfToChannelPoolEntries(content, source.id)
    : parseM3uToChannelPoolEntries(content, source.id);
  // A link that downloads fine but holds no channels is almost always the wrong thing: a login
  // page, a "blocked" notice, an empty answer. Saving it would empty the source and log every
  // channel as removed, so it counts as a failed download and the old channels stay.
  if (entries.length === 0) {
    const text = content.trim();
    if (!text) throw new Error(`The link answered, but sent nothing back. Check the link, or try again later. ${USER_AGENT_HINT}`);
    if (/^<(!doctype|html|head|body)/i.test(text)) {
      throw new Error(`The link sent back a web page instead of a playlist. Check the link. ${USER_AGENT_HINT}`);
    }
    throw new Error(`The link downloaded, but it doesn't contain any channels. Check that it points to an M3U or XSPF playlist.`);
  }
  return entries;
}

// Inspects M3U/XSPF text and returns a warning message if it looks like something
// other than a channel playlist (e.g. a raw HLS livestream / VOD segment feed), or
// null if it looks like a genuine playlist. Shared by the channel-pool URL validator
// and the "import playlist from M3U" flow so both surfaces agree on what's valid.
function detectPlaylistWarning(text: string): string | null {
  if (text.trim().startsWith('<?xml') && text.includes('<playlist')) {
    // XSPF playlist — trust the format's own structure.
    return null;
  }

  // Channel playlists (IPTV M3U) always have channel-specific EXTINF attributes.
  // Check for these first — if present the file is definitely a channel playlist regardless
  // of any HLS tags that might appear in it (e.g. some providers serve m3u8 master playlists).
  const hasChannelMarkers = (
    text.includes('#EXTM3U') &&
    (text.includes('tvg-id=') || text.includes('tvg-logo=') || text.includes('group-title='))
  );
  if (hasChannelMarkers) return null;

  // HLS media-segment / master playlists describe a single stream's variants or chunks,
  // not a list of channels — these are what "m3u8 livestream" links usually are.
  const isHlsStream = (
    text.includes('#EXT-X-TARGETDURATION') ||
    text.includes('#EXT-X-MEDIA-SEQUENCE') ||
    text.includes('#EXT-X-STREAM-INF')
  );
  if (isHlsStream) return "This is a channel stream link (M3U8 livestream), not a playlist";

  // At minimum a valid M3U playlist starts with #EXTM3U or contains #EXTINF entries.
  const isM3uRelated = text.includes('#EXTM3U') || text.includes('#EXTINF');
  if (!isM3uRelated) return "Not a valid M3U/XSPF playlist";

  return null;
}

/**
 * Keys entries by URL plus their occurrence index among entries sharing that URL
 * (e.g. "http://x#1", "http://x#2"), so duplicate-URL entries (mirrors/aliases,
 * common in real IPTV playlists) each get a distinct map key instead of clobbering
 * each other. The Nth entry at a given URL lines up against the Nth entry at that
 * URL on the other side of the diff.
 */
function keyEntriesByUrlOccurrence(entries: ChannelPoolEntry[]): Map<string, ChannelPoolEntry> {
  const seenCounts = new Map<string, number>();
  const byKey = new Map<string, ChannelPoolEntry>();
  for (const e of entries) {
    const occurrence = (seenCounts.get(e.url) || 0) + 1;
    seenCounts.set(e.url, occurrence);
    byKey.set(`${e.url}#${occurrence}`, e);
  }
  return byKey;
}

// ── Channel sync: recognising the same pool channel between refreshes ────

// Xtream stream URLs end in "/<stream_id>.ts". The stream_id is the provider's own permanent id
// for a channel and, unlike the rest of the URL, it survives a username/password change. That
// makes it the most reliable way to recognise an Xtream channel again. It's read back out of the
// URL instead of being stored separately, so db.json doesn't grow.
function xtreamStreamId(url: string): string | null {
  const match = url.match(/\/([^/?#]+)\.ts$/);
  return match ? match[1] : null;
}

// Joined with a NUL character, which never appears in a name or category. It's written as the
// \u0000 escape (not the raw character) so server.ts stays plain text for editors and search tools.
function nameCategoryKey(e: { name: string; category: string }): string {
  return `${e.name}\u0000${e.category}`;
}

// Maps each key to the one item that has it. A key shared by two or more items maps to null:
// when two channels share a name + category (or a URL), guessing between them could link a
// playlist channel to the wrong one, so an ambiguous key deliberately matches nothing.
function indexUnique<T>(items: T[], keyOf: (item: T) => string | null): Map<string, T | null> {
  const map = new Map<string, T | null>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    map.set(key, map.has(key) ? null : item);
  }
  return map;
}

/**
 * Gives each freshly fetched entry the id it had after the previous refresh, when it's
 * recognisably the same channel, so links from playlist channels keep pointing at it.
 * Matches in order of reliability:
 *   1. same Xtream stream_id (Xtream sources only)
 *   2. same stream URL (duplicate URLs line up by occurrence, like the changelog)
 *   3. same name + category, only when that pair is unique on both sides. This is what
 *      catches "the provider changed the stream link but kept the name".
 * An entry whose name and URL both changed gets a new id: it's treated as a new channel.
 * Returns how many old entries found no match, for the mass-disappearance safeguard.
 */
function carryOverPoolEntryIds(oldEntries: ChannelPoolEntry[], newEntries: ChannelPoolEntry[], isXtream: boolean): number {
  const claimedOldIds = new Set<string>();
  const matchedNew = new Set<ChannelPoolEntry>();
  const give = (ne: ChannelPoolEntry, oe: ChannelPoolEntry) => {
    ne.id = oe.id;
    claimedOldIds.add(oe.id);
    matchedNew.add(ne);
  };

  if (isXtream) {
    const oldByStreamId = indexUnique(oldEntries, e => xtreamStreamId(e.url));
    for (const ne of newEntries) {
      const streamId = xtreamStreamId(ne.url);
      const oe = streamId ? oldByStreamId.get(streamId) : null;
      if (oe && !claimedOldIds.has(oe.id)) give(ne, oe);
    }
  }

  const oldByUrl = keyEntriesByUrlOccurrence(oldEntries);
  for (const [key, ne] of keyEntriesByUrlOccurrence(newEntries).entries()) {
    if (matchedNew.has(ne)) continue;
    const oe = oldByUrl.get(key);
    if (oe && !claimedOldIds.has(oe.id)) give(ne, oe);
  }

  const oldByNameCategory = indexUnique<ChannelPoolEntry>(oldEntries, nameCategoryKey);
  const newByNameCategory = indexUnique<ChannelPoolEntry>(newEntries, nameCategoryKey);
  for (const ne of newEntries) {
    if (matchedNew.has(ne)) continue;
    const key = nameCategoryKey(ne);
    const oe = oldByNameCategory.get(key);
    if (oe && newByNameCategory.get(key) === ne && !claimedOldIds.has(oe.id)) give(ne, oe);
  }

  return oldEntries.length - claimedOldIds.size;
}

// ── Channel sync: applying pool changes to linked playlist channels ──────

const SYNC_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// A playlist with tens of thousands of linked channels could log a change for every one of them
// on a single refresh (e.g. a provider moving all its logos). Only the newest entries per
// playlist are kept, so db.json can't balloon.
const SYNC_LOG_MAX_PER_PLAYLIST = 5000;
// Safeguard: when one refresh loses more than this share of a source's channels (and more than
// the minimum count), it's more likely a provider glitch than real removals. Linked channels are
// then not hidden; the next refresh decides.
const HOLD_BACK_MIN_SHARE = 0.3;
const HOLD_BACK_MIN_COUNT = 10;
// How many refreshes in a row a linked channel must be missing from before it counts as lost.
const LOST_AFTER_MISSING_REFRESHES = 2;

// Empty strings and null both mean "no value" (e.g. no logo), so they compare as equal.
function syncValue(obj: Record<SyncField, string | null>, field: SyncField): string | null {
  return obj[field] || null;
}

// name and url are never null on a channel, so "no value" is stored as an empty string there.
function setChannelField(channel: Channel, field: SyncField, value: string | null) {
  if (field === 'name' || field === 'url') channel[field] = value ?? '';
  else channel[field] = value;
}

function snapshotPoolEntry(entry: ChannelPoolEntry): PoolSnapshot {
  return { name: entry.name, url: entry.url, logo: entry.logo || null, tvgId: entry.tvgId || null, category: entry.category, ...pickStreamHeaders(entry) };
}

// Reads a fields object from a request, falling back per field for anything missing.
function normalizeSyncToggles(input: any, fallback: SyncFieldToggles): SyncFieldToggles {
  const toggles = { ...fallback };
  for (const field of SYNC_FIELDS) {
    if (typeof input?.[field] === 'boolean') toggles[field] = input[field];
  }
  return toggles;
}

function addSyncLog(db: Database, entry: Omit<SyncLogEntry, 'id' | 'timestamp'>, timestamp = Date.now()) {
  db.syncLogs.push({ id: uuidv4(), timestamp, ...entry });
}

function pruneSyncLogs(db: Database) {
  const cutoff = Date.now() - SYNC_LOG_RETENTION_MS;
  const keptPerPlaylist = new Map<string, number>();
  db.syncLogs = db.syncLogs
    .filter(l => l.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter(l => {
      const kept = keptPerPlaylist.get(l.playlistId) || 0;
      keptPerPlaylist.set(l.playlistId, kept + 1);
      return kept < SYNC_LOG_MAX_PER_PLAYLIST;
    })
    .reverse();
}

/**
 * Brings every playlist channel linked to `source` up to date with the freshly fetched entries
 * (whose ids carryOverPoolEntryIds has already lined up). Mutates `db`; the caller writes it.
 *
 * For each synced field the provider changed:
 *   - the channel still has the old provider value → the new value is applied automatically
 *   - the channel has a value of the user's own    → it becomes a pending suggestion
 * A linked channel whose pool channel can't be found is marked lost and hidden, unless
 * `holdBackLosses` is set (see the safeguard in detectChannelPoolChanges).
 */
function syncLinkedChannels(db: Database, source: ChannelPoolSource, newEntries: ChannelPoolEntry[], holdBackLosses: boolean) {
  const linkedChannels = db.channels.filter(c => c.link && c.link.sourceId === source.id);
  if (!linkedChannels.length) return;

  const now = Date.now();
  const byId = new Map(newEntries.map(e => [e.id, e]));
  // Fallback lookups for links whose entry id didn't carry over, e.g. a channel that was lost
  // and has now come back under a new id. Same matching rules as carryOverPoolEntryIds.
  const byStreamId = source.type === 'xtream' ? indexUnique(newEntries, e => xtreamStreamId(e.url)) : null;
  const byUrl = indexUnique(newEntries, e => e.url);
  const byNameCategory = indexUnique<ChannelPoolEntry>(newEntries, nameCategoryKey);
  const findEntry = (link: ChannelLink): ChannelPoolEntry | null => {
    const byIdMatch = byId.get(link.poolEntryId);
    if (byIdMatch) return byIdMatch;
    const streamId = byStreamId ? xtreamStreamId(link.lastPool.url) : null;
    return (streamId && byStreamId!.get(streamId))
      || byUrl.get(link.lastPool.url)
      || byNameCategory.get(nameCategoryKey(link.lastPool))
      || null;
  };

  const heldBackPerPlaylist = new Map<string, number>();

  for (const channel of linkedChannels) {
    const link = channel.link!;
    const entry = findEntry(link);
    const logBase = { playlistId: channel.playlistId, channelId: channel.id, channelName: channel.name, sourceName: source.name };

    if (!entry) {
      if (link.lost) continue;
      if (holdBackLosses) {
        heldBackPerPlaylist.set(channel.playlistId, (heldBackPerPlaylist.get(channel.playlistId) || 0) + 1);
        continue;
      }
      // Missing from one refresh isn't enough. Some providers' servers don't all return the same
      // list (TiviOne returned 24,843 and then 24,444 channels on back-to-back requests), so one
      // short list shouldn't hide channels that would come straight back on the next refresh.
      link.missingRefreshes = (link.missingRefreshes || 0) + 1;
      if (link.missingRefreshes < LOST_AFTER_MISSING_REFRESHES) continue;
      link.lost = true;
      // Only hide it if it's currently visible, and remember that sync did it, so a channel the
      // user had already hidden stays hidden when it comes back.
      if (!channel.isHidden) {
        channel.isHidden = true;
        channel.hiddenBySync = true;
      }
      channel.updatedAt = now;
      addSyncLog(db, { ...logBase, type: 'lost' }, now);
      continue;
    }

    link.poolEntryId = entry.id;
    delete link.missingRefreshes;
    let channelChanged = false;

    if (link.lost) {
      link.lost = false;
      if (channel.hiddenBySync) {
        channel.isHidden = false;
        delete channel.hiddenBySync;
      }
      channelChanged = true;
      addSyncLog(db, { ...logBase, type: 'returned' }, now);
    }

    for (const field of SYNC_FIELDS) {
      const poolOld = syncValue(link.lastPool, field);
      const poolNew = syncValue(entry, field);
      const current = syncValue(channel, field);

      // A suggestion the channel already matches (e.g. the user typed it in) is settled.
      if (field in link.pending && syncValue(link.pending as Record<SyncField, string | null>, field) === current) {
        delete link.pending[field];
      }
      if (poolOld === poolNew || !link.fields[field]) continue;

      if (current === poolNew) {
        delete link.pending[field];
      } else if (current === poolOld) {
        setChannelField(channel, field, poolNew);
        delete link.pending[field];
        channelChanged = true;
        addSyncLog(db, { ...logBase, type: 'updated', field, oldValue: current, newValue: poolNew }, now);
      } else {
        link.pending[field] = poolNew;
        addSyncLog(db, { ...logBase, type: 'suggested', field, oldValue: current, newValue: poolNew }, now);
      }
    }

    // The stream headers follow the stream link's sync setting. They change silently (no log
    // entry or suggestion): they're technical details of the link, and if the user set their
    // own, those stay.
    if (link.fields.url && !sameStreamHeaders(link.lastPool, entry) && sameStreamHeaders(channel, link.lastPool)) {
      copyStreamHeaders(channel, entry);
      channelChanged = true;
    }

    // Tracked even for fields that aren't synced, so the snapshot is always current if the user
    // turns syncing on for them later.
    link.lastPool = snapshotPoolEntry(entry);
    if (channelChanged) channel.updatedAt = now;
  }

  for (const [playlistId, count] of heldBackPerPlaylist.entries()) {
    addSyncLog(db, { playlistId, channelId: null, channelName: '', sourceName: source.name, type: 'held', count }, now);
  }

  pruneSyncLogs(db);
}

// Removes a channel's link, keeping its sync log history. A channel that sync had hidden stays
// hidden (so nothing suddenly reappears in players), but it's no longer sync's to unhide.
function unlinkChannel(db: Database, channel: Channel, sourceName: string, reason?: 'source-deleted') {
  if (!channel.link) return;
  delete channel.link;
  delete channel.hiddenBySync;
  channel.updatedAt = Date.now();
  addSyncLog(db, {
    playlistId: channel.playlistId,
    channelId: channel.id,
    channelName: channel.name,
    sourceName,
    type: 'unlinked',
    ...(reason ? { reason } : {}),
  });
}

// Called after the user edits channels by hand (single edit, bulk update, find/replace).
// Hiding or unhiding a channel themselves takes that decision away from sync. An edit that lands
// exactly on a pending suggestion's value settles that suggestion.
function afterManualChannelEdit(channel: Channel, changes: Record<string, unknown>) {
  if ('isHidden' in changes) delete channel.hiddenBySync;
  const pending = channel.link?.pending;
  if (!pending) return;
  for (const field of SYNC_FIELDS) {
    if (field in pending && syncValue(pending as Record<SyncField, string | null>, field) === syncValue(channel, field)) {
      delete pending[field];
    }
  }
}

// Link state is managed only by the sync routes, never by a generic channel edit.
function withoutSyncState(body: any): Record<string, unknown> {
  const { link: _link, hiddenBySync: _hiddenBySync, ...rest } = body || {};
  return rest;
}

/** Diffs old vs. new entries and logs the changes. Returns whether anything actually changed. */
function detectChannelPoolChanges(sourceId: string, newEntries: ChannelPoolEntry[]): boolean {
  const db = readDb();
  const oldEntries = channelPoolCache.get(sourceId) || [];
  const source = db.channelPoolSources.find(s => s.id === sourceId);
  // The source was deleted, or replaced by restoring a backup, while its channels were being
  // fetched. Saving them now would leave channels that belong to no source.
  if (!source) return false;

  // Done before anything else so the stored entries (and linked channels) keep stable ids.
  const missingCount = oldEntries.length
    ? carryOverPoolEntryIds(oldEntries, newEntries, source.type === 'xtream')
    : 0;
  const holdBackLosses = missingCount > HOLD_BACK_MIN_COUNT && missingCount / oldEntries.length > HOLD_BACK_MIN_SHARE;

  let hasChanges: boolean;
  if (!oldEntries.length) {
    hasChanges = newEntries.length > 0;
  } else {
    const oldByUrl = keyEntriesByUrlOccurrence(oldEntries);
    const newByUrl = keyEntriesByUrlOccurrence(newEntries);

    const added: { name: string; category: string }[] = [];
    const removed: { name: string; category: string }[] = [];
    const renamed: { oldName: string; newName: string; category: string }[] = [];

    for (const [key, ne] of newByUrl.entries()) {
      const oe = oldByUrl.get(key);
      if (!oe) {
        added.push({ name: ne.name, category: ne.category });
      } else if (oe.name !== ne.name) {
        renamed.push({ oldName: oe.name, newName: ne.name, category: ne.category });
      }
    }

    for (const [key, oe] of oldByUrl.entries()) {
      if (!newByUrl.has(key)) {
        removed.push({ name: oe.name, category: oe.category });
      }
    }

    hasChanges = added.length > 0 || removed.length > 0 || renamed.length > 0;
    if (hasChanges) {
      const log: ChannelPoolChangeLog = {
        id: uuidv4(),
        sourceId,
        sourceName: source.name,
        timestamp: Date.now(),
        added,
        removed,
        renamed,
      };
      channelPoolChangeLogs.push(log);

      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      channelPoolChangeLogs = channelPoolChangeLogs.filter(l => l.timestamp > ninetyDaysAgo);
      saveChangeLogs();
    }
  }

  // Only this source's own file is saved, plus the small db.json for any linked channels that
  // sync changed. The other sources' channels aren't touched.
  channelPoolCache.set(sourceId, newEntries);
  savePoolEntries(sourceId);
  syncLinkedChannels(db, source, newEntries, holdBackLosses);
  writeDb(db);
  return hasChanges;
}

/** Refreshes a Channel Pool source's entries. Returns whether the entries actually changed. */
async function refreshChannelPoolSource(sourceId: string): Promise<boolean> {
  const db = readDb();
  const source = db.channelPoolSources.find(s => s.id === sourceId);
  if (!source || source.type === 'playlist-file') return false;

  try {
    let newEntries: ChannelPoolEntry[] = [];
    if (source.type === 'xtream') {
      newEntries = await fetchXtreamChannels(source);
    } else if (source.type === 'playlist-url') {
      newEntries = await fetchPlaylistChannels(source);
    }

    const changed = detectChannelPoolChanges(sourceId, newEntries);

    const updatedDb = readDb();
    const idx = updatedDb.channelPoolSources.findIndex(s => s.id === sourceId);
    // Gone during the fetch (deleted, or replaced by a restored backup), same as in
    // detectChannelPoolChanges: keep nothing for it.
    if (idx === -1) return false;
    updatedDb.channelPoolSources[idx].lastFetched = Date.now();
    updatedDb.channelPoolSources[idx].channelCount = newEntries.length;
    updatedDb.channelPoolSources[idx].lastFetchError = null;
    updatedDb.channelPoolSources[idx].lastFetchErrorAt = null;
    writeDb(updatedDb);
    return changed;
  } catch (err) {
    const message = describeSourceFetchError(err, source.url);
    console.error(`Failed to refresh Channel Pool source ${source.name}:`, err);
    const updatedDb = readDb();
    const idx = updatedDb.channelPoolSources.findIndex(s => s.id === sourceId);
    if (idx !== -1) {
      updatedDb.channelPoolSources[idx].lastFetchError = message;
      updatedDb.channelPoolSources[idx].lastFetchErrorAt = Date.now();
      writeDb(updatedDb);
    }
    return false;
  }
}

// Refreshes Channel Pool sources one at a time instead of all at once, so a
// batch of sources (e.g. every source refreshing together at server boot)
// doesn't pile concurrent fetches onto the same moment — which is what can
// make an otherwise-healthy source time out right when the server starts.
// Mirrors refreshEpgSourcesSequentially above for the same reason.
async function refreshChannelPoolSourcesSequentially(sourceIds: string[]) {
  for (const id of sourceIds) {
    await refreshChannelPoolSource(id);
  }
}

// Loads the saved guides and downloads the ones that are due, and downloads every source again
// (uploaded-file sources never refresh; their saved channels are already in memory, like every
// other source's). Run at boot and after a backup is restored. The fetches go one source at a time (see the two functions above)
// and aren't awaited, so neither the server's start nor the restore request waits for them.
function loadAndRefreshAllSources() {
  const db = readDb();
  // Guides are kept on disk, so only the ones that are due get downloaded (after a restore,
  // which empties data/epg/, that's all of them).
  loadSavedGuides();
  refreshEpgSourcesSequentially(epgSourcesDue());
  const channelPoolSourceIdsToRefresh: string[] = [];
  for (const source of db.channelPoolSources) {
    if (source.type !== 'playlist-file') channelPoolSourceIdsToRefresh.push(source.id);
  }
  refreshChannelPoolSourcesSequentially(channelPoolSourceIdsToRefresh);
}

// ── Auth helpers ─────────────────────────────────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
// writeAuth() saves into this file first, like writeDb() does with db.json.tmp.
const AUTH_TMP_FILE = path.join(DATA_DIR, 'auth.json.tmp');
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

interface AuthData {
  passwordHash: string;  // hex
  passwordSalt: string;  // hex
  recoveryKeyHash: string;  // hex
  recoveryKeySalt: string;  // hex
}

const activeSessions = new Set<string>();

// ── Slowing down password guessing ──
// Without this, a program on the network could try dozens of passwords a second until one
// fits. Each device (by network address) gets 5 tries at the password or recovery key. After
// that it has to wait before each further try: 30 seconds, then 1 minute, 2, 4… up to 15
// minutes. Getting it right clears the count. Kept in memory only, so a restart clears it too.
// It's per device rather than for everyone at once, so someone guessing from one device can't
// keep the owner locked out on another. (Behind a reverse proxy every visitor shares the
// proxy's address, so there they share one count.)
const MIN_PASSWORD_LENGTH = 8;
const FREE_LOGIN_ATTEMPTS = 5;
const FIRST_LOGIN_WAIT_MS = 30_000;
const LONGEST_LOGIN_WAIT_MS = 15 * 60_000;
const loginAttempts = new Map<string, { count: number; lastTryAt: number; blockedUntil: number }>();

// Call before checking a password or recovery key. Returns true when the request may go
// ahead. Otherwise it has already answered with "wait…" and the caller must stop.
// The try is counted here, before the password is checked, so sending many guesses at the
// same moment can't slip them all past the limit.
function allowLoginAttempt(req: express.Request, res: express.Response): boolean {
  const now = Date.now();
  // Forget a device an hour after its last try (or after its wait ended, if that's later), so
  // a few typos spread over weeks never add up, and the list can't grow forever.
  for (const [address, entry] of loginAttempts) {
    if (now - Math.max(entry.lastTryAt, entry.blockedUntil) > 60 * 60_000) loginAttempts.delete(address);
  }
  const address = req.ip || 'unknown';
  const entry = loginAttempts.get(address) || { count: 0, lastTryAt: now, blockedUntil: 0 };
  if (now < entry.blockedUntil) {
    const seconds = Math.ceil((entry.blockedUntil - now) / 1000);
    const wait = seconds > 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
    res.status(429).json({ error: `Too many wrong attempts. Wait ${wait}, then try again.` });
    return false;
  }
  entry.count++;
  entry.lastTryAt = now;
  if (entry.count >= FREE_LOGIN_ATTEMPTS) {
    const wait = FIRST_LOGIN_WAIT_MS * 2 ** (entry.count - FREE_LOGIN_ATTEMPTS);
    entry.blockedUntil = now + Math.min(wait, LONGEST_LOGIN_WAIT_MS);
  }
  loginAttempts.set(address, entry);
  return true;
}

// Call once the password or recovery key turned out right.
function clearLoginAttempts(req: express.Request) {
  loginAttempts.delete(req.ip || 'unknown');
}

// Shown on the lock screen while auth.json is 'damaged' (see readAuth).
const AUTH_DAMAGED_MESSAGE = "m3u4me can't read its password file, so it stays locked. To get back in, delete auth.json from m3u4me's data folder on the server (this removes the password), then set a new password in Settings.";

// Returns null when no password is set. Returns 'damaged' when auth.json exists but can't be
// read or isn't a complete password record, e.g. because a power cut interrupted an older
// version of the app while it was saving it.
// Why a damaged file isn't treated as "no password", as it used to be: that silently switched
// password protection off for anyone on the network. And it isn't moved aside like a damaged
// db.json (see setAsideDamagedDb), because that would switch protection off too. Instead the
// app stays locked: protected requests are refused, and login/recovery explain the way out.
// That way out is deleting auth.json by hand, which needs access to the server itself.
function readAuth(): AuthData | null | 'damaged' {
  let text: string;
  try {
    text = fs.readFileSync(AUTH_FILE, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return 'damaged';
  }
  try {
    const parsed = JSON.parse(text);
    // All four hashes/salts must be there, or no password could ever be checked against it.
    const complete = ['passwordHash', 'passwordSalt', 'recoveryKeyHash', 'recoveryKeySalt']
      .every(key => typeof parsed?.[key] === 'string');
    return complete ? parsed : 'damaged';
  } catch {
    return 'damaged';
  }
}

// Answers login/recovery (and the routes behind the auth check) while auth.json is damaged.
// Logged too, so it shows up in `m3u4me logs` / `docker logs`.
function refuseDamagedAuth(res: express.Response) {
  console.error(`${AUTH_FILE} can't be read or is damaged, so passwords can't be checked and m3u4me stays locked. Deleting that file removes the password.`);
  res.status(500).json({ error: AUTH_DAMAGED_MESSAGE });
}

// Same two-step save as writeDb(), for the same reasons. Here a half-written auth.json would
// lock everyone out (see readAuth).
function writeAuth(data: AuthData) {
  fs.writeFileSync(AUTH_TMP_FILE, JSON.stringify(data, null, 2), { flush: true });
  fs.renameSync(AUTH_TMP_FILE, AUTH_FILE);
}

function deleteAuth() {
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  activeSessions.clear();
}

function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  return new Promise((resolve, reject) => {
    const s = salt || crypto.randomBytes(32).toString('hex');
    crypto.pbkdf2(password, s, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve({ hash: key.toString('hex'), salt: s });
    });
  });
}

function generateToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function generateRecoveryKey(): string {
  // 24-char alphanumeric, grouped as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX for readability
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  let key = '';
  const bytes = crypto.randomBytes(24);
  for (let i = 0; i < 24; i++) key += chars[bytes[i] % chars.length];
  return key;
}

function formatRecoveryKey(key: string): string {
  return key.match(/.{1,4}/g)!.join('-');
}

// Assign shortIds to any playlists that pre-date this feature
function migrateShortIds() {
  const db = readDb();
  let max = Math.max(0, ...db.playlists.map(p => p.shortId || 0));
  let changed = false;
  for (const pl of db.playlists) {
    if (!pl.shortId) { pl.shortId = ++max; changed = true; }
  }
  if (changed) writeDb(db);
}
migrateShortIds();

// Sends one piece of a long answer (a backup, a guide for a TV app). When the other side
// can't keep up, it waits before sending more, so the unsent part doesn't pile up in memory.
// Answers false once the other side has gone away, so the caller can stop.
async function sendPiece(res: express.Response, piece: string): Promise<boolean> {
  if (res.destroyed) return false;
  if (piece && !res.write(piece)) {
    await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
  }
  return !res.destroyed;
}

// M3U/EXTINF has no formal attribute-escaping spec, so quotes inside a value would
// otherwise prematurely close the attribute and corrupt the line for any parser.
function escapeM3uAttr(value: string): string {
  return value.replace(/"/g, "'");
}

// #EXTINF is meant to be a single logical line per channel, immediately followed by
// its stream URL on the next line — nothing in the app validates that channel fields
// (name, url, or any attribute) can't contain a literal newline (e.g. a paste, an API
// call, or a find/replace). An embedded \r or \n would split that one line into extra
// lines and shift the name/URL pairing for every channel that follows it in the file.
function stripM3uNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

// Minimal XML escaping for attribute values (icon src, channel/programme ids, timestamps).
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// CDATA sections are safe from &/</> but a literal "]]>" inside the source text would
// still prematurely close the section, so split it across two adjacent CDATA blocks.
function escapeCData(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

function serveM3U(playlist: Playlist, db: Database, res: any) {
  // `playlist` is the same object reference held in db.playlists (both callers get it via
  // .find()), so mutating it here mutates the array entry too — writeDb() below persists it.
  playlist.lastDownloadedAt = Date.now();
  writeDb(db);

  const catIndex = new Map(playlist.categories.map((cat, i) => [cat, i]));
  const channels = db.channels
    .filter(c => c.playlistId === playlist.id && !c.isHidden)
    .sort((a, b) => {
      const catA = catIndex.has(a.category) ? catIndex.get(a.category)! : playlist.categories.length;
      const catB = catIndex.has(b.category) ? catIndex.get(b.category)! : playlist.categories.length;
      if (catA !== catB) return catA - catB;
      return a.order - b.order;
    });
  res.setHeader("Content-Type", "audio/x-mpegurl");
  res.setHeader("Content-Disposition", `inline; filename="${playlist.shortId}.m3u"`);
  let m3u = "#EXTM3U\n";
  channels.forEach(ch => {
    let extinf = `#EXTINF:-1`;
    if (ch.tvgId) extinf += ` tvg-id="${escapeM3uAttr(stripM3uNewlines(ch.tvgId))}"`;
    if (ch.logo)  extinf += ` tvg-logo="${escapeM3uAttr(stripM3uNewlines(ch.logo))}"`;
    if (ch.category) extinf += ` group-title="${escapeM3uAttr(stripM3uNewlines(ch.category))}"`;
    // Stream headers are written both ways players read them: as #EXTINF attributes (TiviMate
    // and most apps) and as #EXTVLCOPT lines (VLC, Kodi), like iptv-org's own playlists.
    const referrer = ch.httpReferrer ? stripM3uNewlines(ch.httpReferrer) : '';
    const userAgent = ch.httpUserAgent ? stripM3uNewlines(ch.httpUserAgent) : '';
    if (referrer) extinf += ` http-referrer="${escapeM3uAttr(referrer)}"`;
    if (userAgent) extinf += ` http-user-agent="${escapeM3uAttr(userAgent)}"`;
    extinf += `,${stripM3uNewlines(ch.name || 'Unnamed')}\n`;
    if (referrer) extinf += `#EXTVLCOPT:http-referrer=${referrer}\n`;
    if (userAgent) extinf += `#EXTVLCOPT:http-user-agent=${userAgent}\n`;
    extinf += `${stripM3uNewlines(ch.url)}\n`;
    m3u += extinf;
  });
  res.send(m3u);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Safety net, part 1. Many routes below are `async`, and this version of Express (4) doesn't
  // notice when one of those fails: Node then stops the whole app, which logs everyone out.
  // So every route handler registered from here on is wrapped: if it fails, the error is
  // passed to the error handler at the very end of startServer(), and only that one request
  // gets an error answer.
  for (const method of ['get', 'post', 'put', 'delete'] as const) {
    const register = app[method].bind(app) as (...args: any[]) => any;
    (app as any)[method] = (route: any, ...handlers: any[]) => register(route, ...handlers.map(handler =>
      typeof handler !== 'function' ? handler : (req: any, res: any, next: any) => {
        Promise.resolve().then(() => handler(req, res, next)).catch(next);
      }
    ));
  }

  app.use(express.json({ limit: '50mb' }));

  loadAndRefreshAllSources();

  setInterval(() => {
    const currentDb = readDb();
    const now = Date.now();
    refreshEpgSourcesSequentially(epgSourcesDue());
    // A source whose last attempt failed is retried on every tick (same as EPG sources
    // above), instead of silently sitting on stale/empty data until the interval next
    // comes due — which for the default 24h channel-pool interval could otherwise mean
    // a whole day before an invalid-login error is retried after being fixed.
    const dueChannelPoolSourceIds = currentDb.channelPoolSources.filter(source => {
      if (source.type === 'playlist-file') return false;
      const intervalMs = (source.refreshIntervalHours || 24) * 60 * 60 * 1000;
      return !source.lastFetched || source.lastFetchError || (now - source.lastFetched) > intervalMs;
    }).map(source => source.id);
    refreshChannelPoolSourcesSequentially(dueChannelPoolSourceIds);
  }, 5 * 60 * 1000);

  // ── Auth middleware ──────────────────────────────────────────────────
  const publicPaths = ['/auth/status', '/auth/login', '/auth/recover'];
  app.use('/api', (req, res, next) => {
    // Skip auth for public auth endpoints
    if (publicPaths.includes(req.path)) return next();
    // Skip auth for M3U serving endpoints handled outside /api
    const auth = readAuth();
    if (!auth) return next(); // No password set — allow all
    // Damaged password file: stay locked, even for sessions that logged in earlier (see readAuth).
    // The 401 makes the frontend show the lock screen, where login explains what to do.
    if (auth === 'damaged') return res.status(401).json({ error: AUTH_DAMAGED_MESSAGE });
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = header.slice(7);
    if (!activeSessions.has(token)) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    next();
  });

  // ── Auth routes ────────────────────────────────────────────────────
  app.get('/api/auth/status', (_req, res) => {
    const auth = readAuth();
    // A damaged password file counts as enabled, so the lock screen shows (see readAuth).
    res.json({ enabled: !!auth });
  });

  app.post('/api/auth/login', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.json({ token: null, message: 'No password set' });
    if (auth === 'damaged') return refuseDamagedAuth(res);
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (!allowLoginAttempt(req, res)) return;
    try {
      const { hash } = await hashPassword(password, auth.passwordSalt);
      if (hash !== auth.passwordHash) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      clearLoginAttempts(req);
      const token = generateToken();
      activeSessions.add(token);
      res.json({ token });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Couldn't check the password. Try again, and restart m3u4me if it keeps happening." });
    }
  });

  app.post('/api/auth/set-password', async (req, res) => {
    const auth = readAuth();
    // Not normally reachable, because the auth check above already refuses it. It's here so
    // the checks below only ever see a real password record.
    if (auth === 'damaged') return refuseDamagedAuth(res);
    const { password, currentPassword } = req.body;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    // If a password is already set, verify the current one
    if (auth) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      const { hash } = await hashPassword(currentPassword, auth.passwordSalt);
      if (hash !== auth.passwordHash) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    try {
      const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);
      const recoveryKey = generateRecoveryKey();
      const { hash: recoveryKeyHash, salt: recoveryKeySalt } = await hashPassword(recoveryKey);
      writeAuth({ passwordHash, passwordSalt, recoveryKeyHash, recoveryKeySalt });
      // Changing the password signs every other device out, like /auth/recover does. Otherwise
      // a device that should no longer have access would stay signed in until the next restart.
      activeSessions.clear();
      // Signs this browser in, like /auth/recover does. Without a session, the very next request
      // after turning a password on would bounce to the lock screen, in the middle of Settings
      // or of the first-run setup.
      const token = generateToken();
      activeSessions.add(token);
      res.json({ recoveryKey: formatRecoveryKey(recoveryKey), token });
    } catch (e) {
      // This message is shown to the user as-is, so keep it plain. The usual cause is data/ not
      // being writable.
      console.error(e);
      res.status(500).json({ error: "Couldn't save the password. Check that m3u4me can write to its data folder, then try again." });
    }
  });

  app.post('/api/auth/recover', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.status(400).json({ error: 'No password set' });
    if (auth === 'damaged') return refuseDamagedAuth(res);
    const { recoveryKey, newPassword } = req.body;
    if (!recoveryKey || !newPassword) {
      return res.status(400).json({ error: 'Recovery key and new password required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (!allowLoginAttempt(req, res)) return;
    try {
      // Strip formatting dashes from recovery key
      const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
      const { hash } = await hashPassword(cleanKey, auth.recoveryKeySalt);
      if (hash !== auth.recoveryKeyHash) {
        return res.status(401).json({ error: 'Invalid recovery key' });
      }
      clearLoginAttempts(req);
      const { hash: passwordHash, salt: passwordSalt } = await hashPassword(newPassword);
      const newRecoveryKey = generateRecoveryKey();
      const { hash: recoveryKeyHash, salt: recoveryKeySalt } = await hashPassword(newRecoveryKey);
      writeAuth({ passwordHash, passwordSalt, recoveryKeyHash, recoveryKeySalt });
      // Clear all existing sessions
      activeSessions.clear();
      // Create a new session for the user
      const token = generateToken();
      activeSessions.add(token);
      res.json({ token, recoveryKey: formatRecoveryKey(newRecoveryKey) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Couldn't reset the password. Check that m3u4me can write to its data folder, then try again." });
    }
  });

  app.post('/api/auth/remove-password', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.json({ success: true });
    if (auth === 'damaged') return refuseDamagedAuth(res); // also unreachable, as in set-password
    const { currentPassword } = req.body;
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    try {
      const { hash } = await hashPassword(currentPassword, auth.passwordSalt);
      if (hash !== auth.passwordHash) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      deleteAuth();
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Couldn't remove the password. Check that m3u4me can write to its data folder, then try again." });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    const header = _req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      activeSessions.delete(header.slice(7));
    }
    res.json({ success: true });
  });

  // --- API Routes ---

  // ── EPG Routes ───────────────────────────────────────────────────────
  app.get("/api/epg-sources", (req, res) => {
    res.json(readDb().epgSources);
  });

  app.post("/api/epg-sources", async (req, res) => {
    const db = readDb();
    const newSource: EpgSource = {
      id: uuidv4(),
      ...req.body,
      refreshIntervalHours: req.body.refreshIntervalHours ?? 12,
      lastFetched: null,
      lastFetchError: null,
      channelCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.epgSources.push(newSource);
    writeDb(db);
    await refreshEpgSource(newSource.id);
    res.json(newSource);
  });

  app.put("/api/epg-sources/:id", (req, res) => {
    const db = readDb();
    const idx = db.epgSources.findIndex(s => s.id === req.params.id);
    if (idx !== -1) {
      db.epgSources[idx] = { ...db.epgSources[idx], ...req.body, updatedAt: Date.now() };
      writeDb(db);
      res.json(db.epgSources[idx]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.delete("/api/epg-sources/:id", (req, res) => {
    const db = readDb();
    db.epgSources = db.epgSources.filter(s => s.id !== req.params.id);
    writeDb(db);
    deleteSavedGuide(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/epg-sources/:id/refresh", async (req, res) => {
    await refreshEpgSource(req.params.id);
    const guide = epgGuides.get(req.params.id);
    res.json({ success: true, channelCount: guide?.channels.length || 0 });
  });

  app.get("/api/epg-sources/:id/channels", (req, res) => {
    const source = readDb().epgSources.find(s => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "Not found" });
    const guide = epgGuides.get(req.params.id);
    if (!guide) return res.json([]);
    const channels = guide.channels.map(c => ({ ...c, sourceId: source.id, sourceName: source.name }));
    channels.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json(channels);
  });

  app.get("/api/epg-sources/:id/programs/:channelId", (req, res) => {
    const guide = epgGuides.get(req.params.id);
    if (!guide) return res.json([]);
    res.json(readChannelProgrammes(guide, [req.params.channelId]).get(req.params.channelId) || []);
  });

  // What's on around now (3 hours back to 6 hours ahead) for the channels the guide view has
  // on screen: body { channelIds }, at most 200 per request. The view asks again as it's
  // scrolled. It used to get every channel's programmes at once, which for a big guide was
  // over 100 MB. A POST only because a list of ids doesn't fit in an address.
  app.post("/api/epg-sources/:id/now", (req, res) => {
    const guide = epgGuides.get(req.params.id);
    const channelIds: string[] = Array.isArray(req.body?.channelIds)
      ? req.body.channelIds.filter((id: unknown) => typeof id === 'string').slice(0, 200)
      : [];
    if (!guide) return res.json({ programmes: {} });
    
    const now = new Date();
    const startWindow = new Date(now.getTime() - 3 * 3600 * 1000);
    const endWindow = new Date(now.getTime() + 6 * 3600 * 1000);

    function parseXmltvDate(dtStr: string): Date {
      const yr = dtStr.substring(0, 4);
      const mo = dtStr.substring(4, 6);
      const da = dtStr.substring(6, 8);
      const hr = dtStr.substring(8, 10);
      const mi = dtStr.substring(10, 12);
      const se = dtStr.substring(12, 14) || "00";
      const tz = dtStr.substring(15) || "+0000";
      const tzFmt = tz ? `${tz.substring(0,3)}:${tz.substring(3)}` : "+00:00";
      return new Date(`${yr}-${mo}-${da}T${hr}:${mi}:${se}${tzFmt}`);
    }

    const progsMap: Record<string, ParsedEpgProgramme[]> = {};
    for (const p of [...readChannelProgrammes(guide, channelIds).values()].flat()) {
      if (!p.start || !p.stop) continue;
      try {
        const pStart = parseXmltvDate(p.start);
        const pStop = parseXmltvDate(p.stop);
        if (pStop >= startWindow && pStart <= endWindow) {
          if (!progsMap[p.channel]) progsMap[p.channel] = [];
          progsMap[p.channel].push(p);
        }
      } catch (e) {}
    }
    
    res.json({ programmes: progsMap });
  });

  app.get("/api/epg/tvg-ids", (req, res) => {
    // Accent-insensitive, so "T"/"S" also find "Ț"/"Ș".
    const q = foldText(String(req.query.q || '').trim());
    if (!q) return res.json([]);

    const results = [];
    const dbSources = readDb().epgSources;

    for (const [sourceId, cache] of epgGuides.entries()) {
      const source = dbSources.find(s => s.id === sourceId);
      if (!source) continue;

      for (const ch of cache.channels) {
        if (foldText(ch.id).includes(q) || foldText(ch.displayName).includes(q)) {
          results.push({ ...ch, sourceId: source.id, sourceName: source.name });
          if (results.length >= 50) return res.json(results);
        }
      }
    }
    res.json(results);
  });

  // Resolve tvg-ids in bulk: given a list of ids, return display names + source names
  app.post("/api/epg/resolve-tvg-ids", (req, res) => {
    const { ids } = req.body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) return res.json({});
    
    const dbSources = readDb().epgSources;
    const result: Record<string, { displayName: string; sourceName: string }> = {};
    
    // Build a lookup set for fast matching
    const idsSet = new Set(ids.filter(Boolean));
    
    for (const [sourceId, cache] of epgGuides.entries()) {
      const source = dbSources.find(s => s.id === sourceId);
      if (!source) continue;
      
      for (const ch of cache.channels) {
        if (idsSet.has(ch.id) && !result[ch.id]) {
          result[ch.id] = { displayName: ch.displayName, sourceName: source.name };
        }
      }
    }
    res.json(result);
  });

  // ── Channel Pool Routes ───────────────────────────────────────────────────────
  // `linkedChannelCount` is response-only: how many playlist channels are linked to each source,
  // so the delete dialog can say how many links would be lost.
  app.get("/api/channel-pool/sources", (req, res) => {
    const db = readDb();
    const linkedCounts = new Map<string, number>();
    for (const c of db.channels) {
      if (c.link) linkedCounts.set(c.link.sourceId, (linkedCounts.get(c.link.sourceId) || 0) + 1);
    }
    res.json(db.channelPoolSources.map(s => ({ ...s, linkedChannelCount: linkedCounts.get(s.id) || 0 })));
  });

  app.post("/api/channel-pool/validate-url", async (req, res) => {
    // userAgent is the one picked in the dialog, so the check sees what the real download will.
    const { url, userAgent } = req.body;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': userAgent || 'VLC/3.0.16 LibVLC/3.0.16',
            'Accept': '*/*'
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        return res.json({ warning: "Not a valid playlist link" });
      }

      // Content-Type is not a reliable signal here — real playlist servers commonly
      // label M3U playlists as audio/x-mpegurl (this app's own export does too, see
      // serveM3U), so a Content-Type-based short-circuit produces false positives on
      // genuine multi-channel playlists. Inspect the actual body instead via
      // detectPlaylistWarning(), which distinguishes playlists from single-stream
      // HLS/binary content far more accurately.
      const reader = response.body?.getReader();
      let text = '';
      if (reader) {
        let bytesRead = 0;
        const decoder = new TextDecoder('utf-8');
        try {
          while (bytesRead < 8192) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytesRead += value.length;
              text += decoder.decode(value, { stream: true });
            }
          }
        } catch (e) {
          // ignore read errors
        } finally {
          reader.cancel().catch(() => {});
        }
      }
      clearTimeout(timeout);

      return res.json({ warning: detectPlaylistWarning(text) });
    } catch (err) {
      return res.json({ warning: "Not a valid playlist link" });
    }
  });

  app.post("/api/channel-pool/sources", async (req, res) => {
    const db = readDb();
    const newSource: ChannelPoolSource = {
      id: uuidv4(),
      ...req.body,
      refreshIntervalHours: req.body.refreshIntervalHours ?? 24,
      lastFetched: null,
      lastFetchError: null,
      channelCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.channelPoolSources.push(newSource);
    writeDb(db);
    
    if (newSource.type !== 'playlist-file') {
      await refreshChannelPoolSource(newSource.id);
    }
    const updatedDb = readDb();
    res.json(updatedDb.channelPoolSources.find(s => s.id === newSource.id) || newSource);
  });

  app.put("/api/channel-pool/sources/:id", (req, res) => {
    const db = readDb();
    const idx = db.channelPoolSources.findIndex(s => s.id === req.params.id);
    if (idx !== -1) {
      // linkedChannelCount comes from GET /api/channel-pool/sources and isn't stored.
      const { linkedChannelCount: _linked, ...updates } = req.body;
      db.channelPoolSources[idx] = { ...db.channelPoolSources[idx], ...updates, updatedAt: Date.now() };
      writeDb(db);
      res.json(db.channelPoolSources[idx]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.delete("/api/channel-pool/sources/:id", (req, res) => {
    const db = readDb();
    // Linked channels stay in their playlists, just unlinked. Re-adding the source later
    // doesn't relink them; the user relinks by hand.
    const source = db.channelPoolSources.find(s => s.id === req.params.id);
    let unlinkedCount = 0;
    for (const channel of db.channels) {
      if (channel.link?.sourceId === req.params.id) {
        unlinkChannel(db, channel, source?.name || 'Unknown Source', 'source-deleted');
        unlinkedCount++;
      }
    }
    db.channelPoolSources = db.channelPoolSources.filter(s => s.id !== req.params.id);
    writeDb(db);
    deletePoolEntries(req.params.id);
    if (channelPoolChangeLogs.some(l => l.sourceId === req.params.id)) {
      channelPoolChangeLogs = channelPoolChangeLogs.filter(l => l.sourceId !== req.params.id);
      saveChangeLogs();
    }
    res.json({ success: true, unlinkedCount });
  });

  app.post("/api/channel-pool/sources/:id/refresh", async (req, res) => {
    const changed = await refreshChannelPoolSource(req.params.id);
    const db = readDb();
    const source = db.channelPoolSources.find(s => s.id === req.params.id);
    // A failed download answers with an error, so the Refresh button shows why it failed
    // instead of "no changes found".
    if (source?.lastFetchError) return res.status(502).json({ error: source.lastFetchError });
    res.json({ success: true, channelCount: source?.channelCount || 0, changed });
  });

  app.get("/api/channel-pool/sources/:id/channels", (req, res) => {
    const db = readDb();
    const source = db.channelPoolSources.find(s => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "Not found" });
    
    let entries = channelPoolCache.get(req.params.id) || [];
    
    // Accent-insensitive, so "T"/"S" also find "Ț"/"Ș".
    const q = foldText(String(req.query.q || '').trim());
    const cat = String(req.query.category || '').trim();
    const sort = String(req.query.sort || 'name');

    if (cat) {
      entries = entries.filter(e => e.category === cat);
    }
    if (q) {
      entries = entries.filter(e => foldText(e.name).includes(q) || foldText(e.url).includes(q));
    }

    // 'original' preserves the order entries were parsed from the source (M3U/Xtream
    // order); anything else falls back to the previous alphabetical-by-name behavior.
    const sorted = sort === 'original' ? entries : [...entries].sort((a, b) => a.name.localeCompare(b.name));

    // `linkedPlaylistIds` is response-only and only added to entries that some playlist channel
    // is linked to, so the Sources list can show a link icon on them.
    const linkedPlaylists = new Map<string, Set<string>>();
    for (const c of db.channels) {
      if (c.link?.sourceId !== source.id) continue;
      if (!linkedPlaylists.has(c.link.poolEntryId)) linkedPlaylists.set(c.link.poolEntryId, new Set());
      linkedPlaylists.get(c.link.poolEntryId)!.add(c.playlistId);
    }
    if (!linkedPlaylists.size) return res.json(sorted);
    res.json(sorted.map(e => linkedPlaylists.has(e.id) ? { ...e, linkedPlaylistIds: [...linkedPlaylists.get(e.id)!] } : e));
  });

  app.get("/api/channel-pool/sources/:id/categories", (req, res) => {
    const entries = channelPoolCache.get(req.params.id) || [];
    
    const categories = new Set(entries.map(e => e.category));
    const sorted = Array.from(categories).sort((a, b) => a.localeCompare(b));
    res.json(sorted);
  });

  app.get("/api/channel-pool/changelog", (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const perPage = 20;
    
    // A copy is sorted: the stored list is shared by every request, so it's left in its own order.
    const logs = [...channelPoolChangeLogs].sort((a, b) => b.timestamp - a.timestamp);
    const total = logs.length;
    const paginatedLogs = logs.slice((page - 1) * perPage, page * perPage);
    
    res.json({
      logs: paginatedLogs,
      hasMore: page * perPage < total
    });
  });

  app.post("/api/channel-pool/sources/upload", (req, res) => {
    const db = readDb();
    const { name, content, filename } = req.body;
    
    if (!name || !content || !filename) {
      return res.status(400).json({ error: "Missing name, content, or filename" });
    }
    
    const newSource: ChannelPoolSource = {
      id: uuidv4(),
      name,
      type: 'playlist-file',
      url: null,
      refreshIntervalHours: 0,
      lastFetched: Date.now(),
      lastFetchError: null,
      channelCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    let entries: ChannelPoolEntry[] = [];
    if (content.trim().startsWith('<?xml') && content.includes('<playlist')) {
      entries = parseXspfToChannelPoolEntries(content, newSource.id);
    } else {
      entries = parseM3uToChannelPoolEntries(content, newSource.id);
    }
    
    newSource.channelCount = entries.length;
    // Added only now, after the file was read without trouble (see "Where the data lives").
    db.channelPoolSources.push(newSource);
    channelPoolCache.set(newSource.id, entries);
    savePoolEntries(newSource.id);
    writeDb(db);
    
    res.json(newSource);
  });

  app.get("/api/version", (_req, res) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      res.json({ version: pkg.version });
    } catch {
      res.json({ version: "0.0.0" });
    }
  });

  // Homescreen stats. Channel counts prefer the in-memory cache (this session's freshest
  // data) and fall back to each source's persisted `channelCount` for one not yet (re)loaded
  // this session — e.g. right after boot, before its startup refresh has completed.
  app.get("/api/stats", (_req, res) => {
    const db = readDb();

    const epgChannelCount = db.epgSources.reduce((sum, source) => {
      const cached = epgGuides.get(source.id);
      return sum + (cached ? cached.channels.length : source.channelCount || 0);
    }, 0);

    const lastPlaylistDownload = db.playlists.reduce<number | null>((latest, p) => {
      if (!p.lastDownloadedAt) return latest;
      return latest === null || p.lastDownloadedAt > latest ? p.lastDownloadedAt : latest;
    }, null);

    const latestChannelPoolAdditions = channelPoolChangeLogs
      .filter(log => log.added.length > 0)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;

    // Channels with at least one sync suggestion waiting, per playlist, for the Home tile.
    const pendingByPlaylist = new Map<string, number>();
    for (const c of db.channels) {
      if (c.link && Object.keys(c.link.pending).length > 0) {
        pendingByPlaylist.set(c.playlistId, (pendingByPlaylist.get(c.playlistId) || 0) + 1);
      }
    }
    const pendingSyncPlaylists = db.playlists
      .filter(p => pendingByPlaylist.has(p.id))
      .map(p => ({ id: p.id, name: p.name, count: pendingByPlaylist.get(p.id)! }));

    res.json({
      pendingSyncCount: pendingSyncPlaylists.reduce((sum, p) => sum + p.count, 0),
      pendingSyncPlaylists,
      playlistCount: db.playlists.length,
      playlistChannelCount: db.channels.length,
      channelPoolSourceCount: db.channelPoolSources.length,
      channelPoolChannelCount: Array.from(channelPoolCache.values()).reduce((sum, entries) => sum + entries.length, 0),
      epgSourceCount: db.epgSources.length,
      epgChannelCount,
      lastPlaylistDownload,
      latestChannelPoolAdditions,
    });
  });

  // `channelCount` (all channels, hidden included), `pendingSyncCount` (channels with a sync
  // suggestion waiting) and `unreadSyncLogCount` are response-only, for the counts and badges in
  // the sidebar and top nav.
  app.get("/api/playlists", (req, res) => {
    const db = readDb();
    const total = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const c of db.channels) {
      total.set(c.playlistId, (total.get(c.playlistId) || 0) + 1);
      if (c.link && Object.keys(c.link.pending).length > 0) {
        pending.set(c.playlistId, (pending.get(c.playlistId) || 0) + 1);
      }
    }
    const readAt = new Map(db.playlists.map(p => [p.id, p.syncLogReadAt || 0]));
    // Only what sync did on its own counts as unread. Entries for the user's own actions
    // (applying or dismissing a suggestion, linking, unlinking) would otherwise put a badge on
    // something they just did. Mirrored in SyncLogPanel.tsx.
    const unreadTypes = new Set<SyncLogEntry['type']>(['updated', 'suggested', 'lost', 'returned', 'held']);
    const unread = new Map<string, number>();
    for (const l of db.syncLogs) {
      if (unreadTypes.has(l.type) && l.timestamp > (readAt.get(l.playlistId) ?? Infinity)) {
        unread.set(l.playlistId, (unread.get(l.playlistId) || 0) + 1);
      }
    }
    res.json(db.playlists.map(p => ({
      ...p,
      channelCount: total.get(p.id) || 0,
      pendingSyncCount: pending.get(p.id) || 0,
      unreadSyncLogCount: unread.get(p.id) || 0,
    })));
  });

  app.post("/api/playlists", (req, res) => {
    const db = readDb();
    const { name } = req.body;
    const nextShortId = Math.max(0, ...db.playlists.map(p => p.shortId || 0)) + 1;
    const newPlaylist: Playlist = {
      id: uuidv4(),
      name: name || "Unnamed Playlist",
      userId: "local-user",
      categories: ["General"],
      exportId: uuidv4(),
      shortId: nextShortId,
      lastDownloadedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.playlists.push(newPlaylist);
    // Naming the first playlist is the last required step of the first-run setup, so making any
    // playlist finishes it. Saved in this same write so a failed second request can't leave
    // someone stuck in the setup with a playlist already made.
    db.settings.onboardingDone = true;
    writeDb(db);
    res.json(newPlaylist);
  });

  // Creates a playlist pre-populated from an existing M3U/XSPF playlist, given either a URL
  // to fetch or raw file content. Rejects (with a warning the caller can confirm past, mirroring
  // the channel-pool "Add Source" flow) anything that looks like a raw stream link rather than
  // an actual channel playlist — e.g. an M3U8 livestream/VOD segment feed.
  app.post("/api/playlists/import", async (req, res) => {
    const { name, url, content: rawContent, confirmWarning } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Missing playlist name" });
    }
    if (!url && !rawContent) {
      return res.status(400).json({ error: "Provide a URL or a file to import from" });
    }

    let content: string;
    if (url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16', 'Accept': '*/*' },
          });
        } catch {
          clearTimeout(timeout);
          return res.status(400).json({ error: "Could not fetch that URL" });
        }

        // Content-Type is not a reliable signal here — real playlist servers commonly
        // label M3U playlists as audio/x-mpegurl (this app's own export does too, see
        // serveM3U), so a Content-Type-based short-circuit produces false positives on
        // genuine multi-channel playlists. Inspect the actual body instead via
        // detectPlaylistWarning() below, which distinguishes playlists from single-stream
        // HLS/binary content far more accurately.
        content = await response.text();
        clearTimeout(timeout);
      } catch {
        return res.status(400).json({ error: "Could not fetch that URL" });
      }
    } else {
      content = String(rawContent);
    }

    const warning = detectPlaylistWarning(content);
    if (warning && !confirmWarning) {
      return res.json({ warning });
    }

    const isXspf = content.trim().startsWith('<?xml') && content.includes('<playlist');
    const entries = isXspf
      ? parseXspfToChannelPoolEntries(content, 'import')
      : parseM3uToChannelPoolEntries(content, 'import');

    if (entries.length === 0) {
      return res.status(400).json({ error: "No channels found in that playlist" });
    }

    const db = readDb();
    const nextShortId = Math.max(0, ...db.playlists.map(p => p.shortId || 0)) + 1;
    const categories = Array.from(new Set(entries.map(e => e.category || "General")));
    const newPlaylist: Playlist = {
      id: uuidv4(),
      name: String(name).trim(),
      userId: "local-user",
      categories: categories.length > 0 ? categories : ["General"],
      exportId: uuidv4(),
      shortId: nextShortId,
      lastDownloadedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const newChannels: Channel[] = entries.map((e, i) => ({
      id: uuidv4(),
      playlistId: newPlaylist.id,
      name: e.name || "Unknown",
      url: e.url || "",
      logo: e.logo || null,
      tvgId: e.tvgId || null,
      category: e.category || "General",
      ...pickStreamHeaders(e),
      order: i + 1,
      isHidden: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    db.playlists.push(newPlaylist);
    db.channels = [...db.channels, ...newChannels];
    db.settings.onboardingDone = true; // same reason as in POST /api/playlists
    writeDb(db);

    res.json(newPlaylist);
  });

  // Changes the order playlists are listed in, everywhere in the app. `ids` is every playlist
  // id in the new order. Nothing else about a playlist changes: its short link number
  // (shortId) stays the same. Registered before the "/:playlistId" routes below.
  app.post("/api/playlists/reorder", (req, res) => {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "Send the playlist ids in their new order." });
    }
    const db = readDb();
    const position = new Map(ids.map((id, index) => [id, index]));
    // A playlist that isn't in the list (made on another device meanwhile) keeps its place at the end.
    const placeOf = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    db.playlists = db.playlists
      .map((playlist, index) => ({ playlist, index }))
      .sort((a, b) => placeOf(a.playlist.id) - placeOf(b.playlist.id) || a.index - b.index)
      .map(entry => entry.playlist);
    writeDb(db);
    res.json({ ok: true });
  });

  app.put("/api/playlists/:playlistId", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const idx = db.playlists.findIndex(p => p.id === playlistId);
    if (idx === -1) {
      return res.status(404).json({ error: "Not found" });
    }
    if (Array.isArray(req.body.categories)) {
      const trimmed = req.body.categories.map((c: string) => typeof c === "string" ? c.trim() : c);
      const seen = new Set<string>();
      for (const c of trimmed) {
        if (seen.has(c)) {
          return res.status(400).json({ error: `A category named "${c}" already exists in this playlist.` });
        }
        seen.add(c);
      }
      req.body.categories = trimmed;
    }
    // Counts added by GET /api/playlists aren't stored; drop them if a caller echoes them back.
    const { channelCount: _total, pendingSyncCount: _pending, unreadSyncLogCount: _unread, ...updates } = req.body;
    db.playlists[idx] = { ...db.playlists[idx], ...updates, updatedAt: Date.now() };
    writeDb(db);
    res.json(db.playlists[idx]);
  });

  app.delete("/api/playlists/:playlistId", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    db.playlists = db.playlists.filter(p => p.id !== playlistId);
    db.channels = db.channels.filter(c => c.playlistId !== playlistId);
    db.syncLogs = db.syncLogs.filter(l => l.playlistId !== playlistId);
    writeDb(db);
    res.json({ success: true });
  });

  app.get("/api/playlists/:playlistId/channels", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const channels = db.channels.filter(c => c.playlistId === playlistId).sort((a, b) => a.order - b.order);
    res.json(channels);
  });

  app.post("/api/playlists/:playlistId/channels/bulk", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { channels } = req.body;
    
    // Auto increment order
    const existing = db.channels.filter(c => c.playlistId === playlistId);
    let maxOrder = existing.length > 0 ? Math.max(...existing.map(c => c.order)) : 0;

    // Channels can arrive with a link in two shapes:
    // - { poolEntryId, fields } from "Keep in sync with source" when adding from Sources
    // - a complete link (with lastPool) when undo restores a deleted linked channel
    // A link to a pool channel or source that no longer exists (or to an uploaded file, which
    // never refreshes) is dropped and the channel is added unlinked.
    const poolEntriesById = new Map<string, ChannelPoolEntry>();
    if (channels.some((c: any) => c.link)) {
      for (const e of allPoolEntries()) poolEntriesById.set(e.id, e);
    }
    const resolveLink = (input: any): ChannelLink | undefined => {
      if (!input) return undefined;
      const source = db.channelPoolSources.find(s => s.id === input.sourceId);
      if (!source || source.type === 'playlist-file') return undefined;
      if (input.lastPool) return input as ChannelLink;
      const entry = poolEntriesById.get(input.poolEntryId);
      if (!entry || entry.sourceId !== source.id) return undefined;
      return {
        sourceId: source.id,
        poolEntryId: entry.id,
        fields: normalizeSyncToggles(input.fields, db.settings.defaultSyncFields),
        lastPool: snapshotPoolEntry(entry),
        pending: {},
        lost: false,
      };
    };

    const newChannels: Channel[] = channels.map((c: any, i: number) => {
      // Find category and add it to playlist if missing
      const cat = c.category || "General";
      const link = resolveLink(c.link);
      return {
        id: uuidv4(),
        playlistId,
        name: c.name || "Unknown",
        url: c.url || "",
        logo: c.logo || null,
        tvgId: c.tvgId || null,
        category: cat,
        ...pickStreamHeaders(c),
        order: maxOrder + i + 1,
        // Only undo restores send isHidden, so a hidden channel comes back hidden. A channel sync
        // had hidden also keeps hiddenBySync, so sync can still unhide it if its source returns.
        isHidden: !!c.isHidden,
        ...(link && c.isHidden && c.hiddenBySync ? { hiddenBySync: true } : {}),
        ...(link ? { link } : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    db.channels = [...db.channels, ...newChannels];

    for (const c of newChannels) {
      if (!c.link) continue;
      const sourceName = db.channelPoolSources.find(s => s.id === c.link!.sourceId)?.name || 'Unknown Source';
      addSyncLog(db, { playlistId, channelId: c.id, channelName: c.name, sourceName, type: 'linked' });
    }

    // Update categories — preserve existing order, append new ones at the end
    const playlist = db.playlists.find(p => p.id === playlistId);
    if (playlist) {
      const existingSet = new Set(playlist.categories);
      newChannels.forEach(c => {
        if (!existingSet.has(c.category)) {
          playlist.categories.push(c.category);
          existingSet.add(c.category);
        }
      });
    }

    writeDb(db);
    res.json({ success: true, added: newChannels.length, ids: newChannels.map((c: Channel) => c.id) });
  });

  app.put("/api/playlists/:playlistId/channels/:channelId", (req, res) => {
    const db = readDb();
    const { channelId } = req.params;
    const idx = db.channels.findIndex(c => c.id === channelId);
    if (idx !== -1) {
      const changes = withoutSyncState(req.body);
      db.channels[idx] = { ...db.channels[idx], ...changes, updatedAt: Date.now() };
      afterManualChannelEdit(db.channels[idx], changes);
      writeDb(db);
      res.json(db.channels[idx]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.delete("/api/playlists/:playlistId/channels/:channelId", (req, res) => {
    const db = readDb();
    const { channelId } = req.params;
    db.channels = db.channels.filter(c => c.id !== channelId);
    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/playlists/:playlistId/channels/bulk-update", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { ids } = req.body;
    const updates: Record<string, any> = withoutSyncState(req.body.updates);
    db.channels = db.channels.map(c => {
      if (c.playlistId === playlistId && ids.includes(c.id)) {
        const updated = { ...c, ...updates, updatedAt: Date.now() };
        afterManualChannelEdit(updated, updates);
        return updated;
      }
      return c;
    });

    // Handle new category dynamic pushing
    if (updates.category) {
      const playlist = db.playlists.find(p => p.id === playlistId);
      if (playlist && !playlist.categories.includes(updates.category)) {
        playlist.categories.push(updates.category);
      }
    }

    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/playlists/:playlistId/channels/bulk-update-many", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { updates } = req.body; // updates: Array<{ id: string, changes: any }>

    const updateMap = new Map<string, any>(updates.map((u: any) => [u.id, withoutSyncState(u.changes)]));

    db.channels = db.channels.map(c => {
      if (c.playlistId === playlistId && updateMap.has(c.id)) {
        const changes = updateMap.get(c.id);

        // Handle new category dynamic pushing
        if (changes.category) {
          const playlist = db.playlists.find(p => p.id === playlistId);
          if (playlist && !playlist.categories.includes(changes.category)) {
            playlist.categories.push(changes.category);
          }
        }
        const updated = { ...c, ...changes, updatedAt: Date.now() };
        afterManualChannelEdit(updated, changes);
        return updated;
      }
      return c;
    });

    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/playlists/:playlistId/channels/bulk-replace", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { search, replace, field, ids } = req.body;
    if (!search || typeof search !== "string") {
      return res.status(400).json({ error: "Missing search string" });
    }
    const targetField = field || "url";
    let modified = 0;
    db.channels = db.channels.map(c => {
      if (c.playlistId !== playlistId) return c;
      if (ids && Array.isArray(ids) && !ids.includes(c.id)) return c;
      const current = (c as any)[targetField];
      if (typeof current !== "string" || !current.includes(search)) return c;
      const updated = current.replaceAll(search, replace ?? "");
      if (updated === current) return c;
      modified++;
      const changed = { ...c, [targetField]: updated, updatedAt: Date.now() };
      afterManualChannelEdit(changed, { [targetField]: updated });
      return changed;
    });
    if (modified > 0) writeDb(db);
    res.json({ success: true, modified });
  });

  app.post("/api/playlists/:playlistId/channels/bulk-delete", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { ids } = req.body;
    db.channels = db.channels.filter(c => !(c.playlistId === playlistId && ids.includes(c.id)));
    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/playlists/:playlistId/channels/reorder", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    const { orders } = req.body; // { id: newOrder }
    db.channels = db.channels.map(c => {
      if (c.playlistId === playlistId && orders[c.id] !== undefined) {
        return { ...c, order: orders[c.id], updatedAt: Date.now() };
      }
      return c;
    });
    writeDb(db);
    res.json({ success: true });
  });

  // ── Channel sync routes ──────────────────────────────────────────────
  const findPlaylistChannel = (db: Database, playlistId: string, channelId: string) =>
    db.channels.find(c => c.id === channelId && c.playlistId === playlistId);
  const sourceNameOf = (db: Database, sourceId: string) =>
    db.channelPoolSources.find(s => s.id === sourceId)?.name || 'Unknown Source';
  const isSyncField = (value: unknown): value is SyncField => SYNC_FIELDS.includes(value as SyncField);
  // A suggestion for a field that's no longer synced would never make sense to apply.
  const dropUnsyncedSuggestions = (link: ChannelLink) => {
    for (const field of SYNC_FIELDS) {
      if (!link.fields[field]) delete link.pending[field];
    }
  };

  app.get("/api/settings", (_req, res) => {
    res.json(readDb().settings);
  });

  app.put("/api/settings", (req, res) => {
    const db = readDb();
    db.settings = {
      ...db.settings,
      defaultSyncFields: normalizeSyncToggles(req.body.defaultSyncFields, db.settings.defaultSyncFields),
    };
    writeDb(db);
    res.json(db.settings);
  });

  // ── Backup & restore ─────────────────────────────────────────────────
  // A backup is the whole database (playlists, channels, sources with their saved channels, logs
  // and settings) in one JSON file: db.json, the data/pool/ files and the update log together,
  // in the shape db.json had when it was the only file (see fullDatabase). The password
  // (auth.json) is never part of it. Both routes sit behind the password like the rest of /api.
  app.get("/api/backup", async (_req, res) => {
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="m3u4me-backup-${date}.json"`);
    // Sent piece by piece (see fullDatabasePieces and sendPiece).
    for (const piece of fullDatabasePieces()) {
      if (!await sendPiece(res, piece)) return;
    }
    res.end();
  });

  // Replaces the whole database with a backup, or with a db.json copied from another m3u4me.
  // The file arrives as raw bytes (application/octet-stream) rather than JSON, because the
  // app-wide JSON parser above stops at 50 MB and a database with a few big sources is larger.
  app.post("/api/backup/restore", express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req, res) => {
    const notABackup = "This file isn't an m3u4me backup. Pick a backup downloaded from m3u4me's Settings, or the db.json file from its data folder.";
    let backup;
    try {
      backup = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : '');
    } catch {
      return res.status(400).json({ error: notABackup });
    }
    // Every m3u4me database ever made has playlists and channels. The other lists arrived in
    // later versions, so an older backup may not have them (readDb() fills them in), but any
    // that are there must be lists.
    const optionalLists = ['epgSources', 'channelPoolSources', 'channelPoolEntries', 'channelPoolChangeLogs', 'syncLogs'];
    const looksRight = backup && typeof backup === 'object' && !Array.isArray(backup)
      && Array.isArray(backup.playlists) && Array.isArray(backup.channels)
      && optionalLists.every(key => backup[key] === undefined || Array.isArray(backup[key]));
    if (!looksRight) return res.status(400).json({ error: notABackup });

    const current = readDb();
    try {
      // Keep the data being replaced, in case the wrong file was picked: a complete backup of
      // it (the same as a downloaded one), next to db.json in the data folder.
      saveFullDatabaseCopy(`${DB_FILE}.before-restore-${fileStamp()}`);
      // A restore never sends anyone back to the setup screens. During setup, a backup without
      // any playlist leaves setup unfinished, so it carries on to "name your first playlist".
      const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {};
      backup.settings = { ...settings, onboardingDone: backup.playlists.length > 0 || current.settings.onboardingDone };
      storeFullDatabase(backup);
      // Backups from before short playlist links existed need their numbers filled in.
      migrateShortIds();
    } catch (e) {
      console.error(e);
      // Whatever got as far as the disk is what counts now, so forget the half-replaced copy in
      // memory; the next request loads the files again.
      memoryDb = null;
      return res.status(500).json({ error: "Couldn't restore the backup. Check that m3u4me can write to its data folder, then try again." });
    }

    // The saved guides belong to the replaced database (guides aren't part of a backup), so
    // they're removed and download again. (The sources' channels were replaced together with
    // the database.)
    fs.rmSync(EPG_DIR, { recursive: true, force: true });
    loadAndRefreshAllSources();

    const restored = readDb();
    res.json({
      playlists: restored.playlists.length,
      channels: restored.channels.length,
      channelPoolSources: restored.channelPoolSources.length,
      epgSources: restored.epgSources.length,
      onboardingDone: restored.settings.onboardingDone,
    });
  });

  // Pool channels to offer in the "Link to source" dialog, from every source except uploaded
  // files. Without ?q=, suggestions: channels with the exact same stream link first, then ones
  // with a similar name. With ?q=, a plain name/link search.
  app.get("/api/playlists/:playlistId/channels/:channelId/link/candidates", (req, res) => {
    const db = readDb();
    const channel = findPlaylistChannel(db, req.params.playlistId, req.params.channelId);
    if (!channel) return res.status(404).json({ error: "That channel no longer exists. Reload the page and try again." });

    const LIMIT = 50;
    const sources = new Map(db.channelPoolSources.filter(s => s.type !== 'playlist-file').map(s => [s.id, s]));
    const eligible = allPoolEntries().filter(e => sources.has(e.sourceId));
    const withSource = (e: ChannelPoolEntry, match: 'url' | 'name' | 'search') => ({ ...e, sourceName: sources.get(e.sourceId)!.name, match });

    // Accent-insensitive, like the Sources search.
    const q = foldText(String(req.query.q || '').trim());
    if (q) {
      const results = eligible.filter(e => foldText(e.name).includes(q) || foldText(e.url).includes(q));
      return res.json(results.slice(0, LIMIT).map(e => withSource(e, 'search')));
    }

    // Letters and digits only, lowercased, so "Channel X HD" and "channelx-hd" count as alike.
    const simplify = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const target = simplify(channel.name);
    const sameUrl = eligible.filter(e => e.url === channel.url);
    const sameUrlIds = new Set(sameUrl.map(e => e.id));
    // Words of 3+ letters/digits, so "My Epsilon (backup)" still finds "Epsilon HD" through "epsilon".
    const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3));
    const targetWords = wordsOf(channel.name);
    const wordCounts = new Map<string, number>(); // how many pool channels contain each of the target's words
    const exactName: ChannelPoolEntry[] = [];
    const similarName: ChannelPoolEntry[] = [];
    const sharedWords: { entry: ChannelPoolEntry; words: string[] }[] = [];
    for (const e of eligible) {
      const shared = targetWords.size ? [...wordsOf(e.name)].filter(w => targetWords.has(w)) : [];
      for (const w of shared) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      if (sameUrlIds.has(e.id)) continue;
      const name = simplify(e.name);
      if (target.length >= 2 && name === target) exactName.push(e);
      // Very short names (e.g. "tv") would "contain" half the pool, so they only match exactly.
      else if (target.length >= 2 && name.length >= 3 && (name.includes(target) || target.includes(name))) similarName.push(e);
      else if (shared.length) sharedWords.push({ entry: e, words: shared });
    }
    // A word lots of channels have (e.g. "not" from "[NOT 24/7]", or "sport") says little about
    // which channel is meant, so rarer shared words count for more: each one scores
    // 1 / (how many channels contain it). Highest score first.
    const score = (words: string[]) => words.reduce((sum, w) => sum + 1 / (wordCounts.get(w) || 1), 0);
    const rankedSharedWords = sharedWords
      .map(s => ({ entry: s.entry, score: score(s.words) }))
      .sort((a, b) => b.score - a.score);
    const results = [
      ...sameUrl.map(e => withSource(e, 'url')),
      ...exactName.map(e => withSource(e, 'name')),
      ...similarName.map(e => withSource(e, 'name')),
      ...rankedSharedWords.map(s => withSource(s.entry, 'name')),
    ];
    res.json(results.slice(0, LIMIT));
  });

  // Links an existing playlist channel to a pool channel. `useSourceValues` lists the fields the
  // user chose to overwrite with the pool channel's values right now; every other field keeps the
  // channel's own value (so later provider changes to it arrive as suggestions).
  app.post("/api/playlists/:playlistId/channels/:channelId/link", (req, res) => {
    const db = readDb();
    const channel = findPlaylistChannel(db, req.params.playlistId, req.params.channelId);
    if (!channel) return res.status(404).json({ error: "That channel no longer exists. Reload the page and try again." });
    const entry = allPoolEntries().find(e => e.id === req.body.poolEntryId);
    if (!entry) return res.status(404).json({ error: "That source channel can't be found anymore, probably because its source just refreshed. Search for it again." });
    const source = db.channelPoolSources.find(s => s.id === entry.sourceId);
    if (!source || source.type === 'playlist-file') {
      return res.status(400).json({ error: "Channels from uploaded files can't be kept in sync, because the file never changes. Pick a channel from an Xtream or playlist link source." });
    }

    // Relinking an already linked channel replaces its old link.
    if (channel.link) unlinkChannel(db, channel, sourceNameOf(db, channel.link.sourceId));

    const now = Date.now();
    const logBase = { playlistId: channel.playlistId, channelId: channel.id, channelName: channel.name, sourceName: source.name };
    addSyncLog(db, { ...logBase, type: 'linked' }, now);

    const useSourceValues: SyncField[] = Array.isArray(req.body.useSourceValues) ? req.body.useSourceValues.filter(isSyncField) : [];
    for (const field of useSourceValues) {
      const oldValue = syncValue(channel, field);
      const newValue = syncValue(entry, field);
      if (oldValue === newValue) continue;
      setChannelField(channel, field, newValue);
      // 'applied', not 'updated': the user chose this in the Link dialog, so it's logged as their
      // own action and doesn't show up as unread.
      addSyncLog(db, { ...logBase, type: 'applied', field, oldValue, newValue }, now);
    }
    // Taking the source's stream link means taking the headers it needs to play, too.
    if (useSourceValues.includes('url')) copyStreamHeaders(channel, entry);

    channel.link = {
      sourceId: source.id,
      poolEntryId: entry.id,
      fields: normalizeSyncToggles(req.body.fields, db.settings.defaultSyncFields),
      lastPool: snapshotPoolEntry(entry),
      pending: {},
      lost: false,
    };
    channel.updatedAt = now;
    writeDb(db);
    res.json(channel);
  });

  app.put("/api/playlists/:playlistId/channels/:channelId/link", (req, res) => {
    const db = readDb();
    const channel = findPlaylistChannel(db, req.params.playlistId, req.params.channelId);
    if (!channel?.link) return res.status(404).json({ error: "This channel isn't linked to a source anymore. Reload the page to see the latest state." });
    channel.link.fields = normalizeSyncToggles(req.body.fields, channel.link.fields);
    dropUnsyncedSuggestions(channel.link);
    channel.updatedAt = Date.now();
    writeDb(db);
    res.json(channel);
  });

  app.delete("/api/playlists/:playlistId/channels/:channelId/link", (req, res) => {
    const db = readDb();
    const channel = findPlaylistChannel(db, req.params.playlistId, req.params.channelId);
    if (!channel?.link) return res.json({ success: true });
    unlinkChannel(db, channel, sourceNameOf(db, channel.link.sourceId));
    writeDb(db);
    res.json({ success: true });
  });

  // Apply or Dismiss one pending suggestion (body: { field }).
  const handleSuggestion = (action: 'apply' | 'dismiss') => (req: express.Request, res: express.Response) => {
    const db = readDb();
    const channel = findPlaylistChannel(db, req.params.playlistId, req.params.channelId);
    const field = req.body.field;
    if (!channel?.link || !isSyncField(field) || !(field in channel.link.pending)) {
      return res.status(404).json({ error: "This update isn't waiting anymore. Reload the page to see the latest state." });
    }
    const newValue = channel.link.pending[field] ?? null;
    const oldValue = syncValue(channel, field);
    delete channel.link.pending[field];
    if (action === 'apply') setChannelField(channel, field, newValue);
    // The source's stream link comes with the headers it needs (as of the last refresh).
    if (action === 'apply' && field === 'url') copyStreamHeaders(channel, channel.link.lastPool);
    channel.updatedAt = Date.now();
    addSyncLog(db, {
      playlistId: channel.playlistId,
      channelId: channel.id,
      channelName: channel.name,
      sourceName: sourceNameOf(db, channel.link.sourceId),
      type: action === 'apply' ? 'applied' : 'dismissed',
      field,
      oldValue,
      newValue,
    });
    writeDb(db);
    res.json(channel);
  };
  app.post("/api/playlists/:playlistId/channels/:channelId/link/apply", handleSuggestion('apply'));
  app.post("/api/playlists/:playlistId/channels/:channelId/link/dismiss", handleSuggestion('dismiss'));

  // Same sync settings for many linked channels (body: { ids, fields }). Unlinked ids are skipped.
  app.post("/api/playlists/:playlistId/channels/bulk-link-settings", (req, res) => {
    const db = readDb();
    const ids = new Set<string>(req.body.ids || []);
    let updated = 0;
    for (const channel of db.channels) {
      if (channel.playlistId !== req.params.playlistId || !ids.has(channel.id) || !channel.link) continue;
      channel.link.fields = normalizeSyncToggles(req.body.fields, channel.link.fields);
      dropUnsyncedSuggestions(channel.link);
      channel.updatedAt = Date.now();
      updated++;
    }
    writeDb(db);
    res.json({ success: true, updated });
  });

  app.post("/api/playlists/:playlistId/channels/bulk-unlink", (req, res) => {
    const db = readDb();
    const ids = new Set<string>(req.body.ids || []);
    let unlinked = 0;
    for (const channel of db.channels) {
      if (channel.playlistId !== req.params.playlistId || !ids.has(channel.id) || !channel.link) continue;
      unlinkChannel(db, channel, sourceNameOf(db, channel.link.sourceId));
      unlinked++;
    }
    writeDb(db);
    res.json({ success: true, unlinked });
  });

  app.get("/api/playlists/:playlistId/sync-log", (req, res) => {
    const db = readDb();
    const playlist = db.playlists.find(p => p.id === req.params.playlistId);
    if (!playlist) return res.status(404).json({ error: "That playlist no longer exists. Reload the page and try again." });
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const perPage = 50;
    const entries = db.syncLogs
      .filter(l => l.playlistId === playlist.id)
      .sort((a, b) => b.timestamp - a.timestamp);
    res.json({
      entries: entries.slice((page - 1) * perPage, page * perPage),
      hasMore: page * perPage < entries.length,
      readAt: playlist.syncLogReadAt || null,
    });
  });

  app.post("/api/playlists/:playlistId/sync-log/read", (req, res) => {
    const db = readDb();
    const playlist = db.playlists.find(p => p.id === req.params.playlistId);
    if (!playlist) return res.status(404).json({ error: "That playlist no longer exists. Reload the page and try again." });
    playlist.syncLogReadAt = Date.now();
    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/health-check", async (req, res) => {
    const { channels } = req.body as { channels: { id: string; url: string; referrer?: string; userAgent?: string }[] };
    if (!Array.isArray(channels)) return res.status(400).json({ error: 'Invalid input' });
    const TIMEOUT_MS = 8000;
    const results = await Promise.all(
      channels.map(async (channel) => {
        const { id, url, referrer, userAgent } = channel || {};
        if (!url || typeof url !== 'string') return { id, ok: false, code: null, skipped: true };
        if (!/^https?:\/\//i.test(url)) return { id, ok: false, code: null, skipped: true };
        // Sent like a player would, so channels whose provider needs them don't show as offline.
        const headers: Record<string, string> = {};
        if (referrer) headers['Referer'] = referrer;
        if (userAgent) headers['User-Agent'] = userAgent;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const r = await fetch(url, { method: 'HEAD', headers, signal: controller.signal });
          clearTimeout(timer);
          return { id, ok: r.status < 400, code: r.status };
        } catch (e: any) {
          clearTimeout(timer);
          if (e.name === 'AbortError') return { id, ok: false, code: null, timeout: true };
          // Some servers reject HEAD — try a GET that we abort immediately after headers
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), TIMEOUT_MS);
          try {
            const r2 = await fetch(url, { method: 'GET', headers, signal: c2.signal });
            clearTimeout(t2);
            c2.abort();
            return { id, ok: r2.status < 400, code: r2.status };
          } catch (e2: any) {
            clearTimeout(t2);
            if (e2.name === 'AbortError') return { id, ok: false, code: null, timeout: true };
            return { id, ok: false, code: null };
          }
        }
      })
    );
    res.json({ results });
  });

  // Searches across all three feature surfaces (playlists, channel pool sources, EPG
  // sources) so Spotlight can index the whole app, not just the active playlist. Each
  // result carries a `kind` discriminator plus a generic container/category shape — the
  // frontend groups by kind, then container, then category (EPG results get `category:
  // null` since EPG channels aren't categorized). Results are capped at 50 per kind,
  // matching the cap the single-surface search and /api/epg/tvg-ids already used.
  app.get("/api/search", (req, res) => {
    // Accent-insensitive, so "T"/"S" also find "Ț"/"Ș".
    const q = foldText(String(req.query.q || '').trim());
    if (!q) return res.json([]);
    const db = readDb();
    const matches = (...fields: (string | null | undefined)[]) => fields.some(f => f != null && foldText(f).includes(q));

    const playlistResults = db.channels
      .filter(c => matches(c.name, c.url, c.tvgId))
      .slice(0, 50)
      .map(c => ({
        kind: "playlist",
        id: c.id,
        containerId: c.playlistId,
        containerName: db.playlists.find(p => p.id === c.playlistId)?.name ?? '',
        category: c.category,
        name: c.name,
        url: c.url,
        tvgId: c.tvgId,
        logo: c.logo,
        isHidden: c.isHidden,
      }));

    const channelPoolResults = allPoolEntries()
      .filter(e => matches(e.name, e.url, e.tvgId))
      .slice(0, 50)
      .map(e => ({
        kind: "channelPool",
        id: e.id,
        containerId: e.sourceId,
        containerName: db.channelPoolSources.find(s => s.id === e.sourceId)?.name ?? '',
        category: e.category,
        name: e.name,
        url: e.url,
        tvgId: e.tvgId,
        logo: e.logo,
      }));

    // Walks every guide's channel list the same way /api/epg/tvg-ids does — including its trick of returning
    // as soon as the cap is hit instead of scanning every remaining source.
    const epgResults: any[] = [];
    for (const [sourceId, cache] of epgGuides.entries()) {
      const source = db.epgSources.find(s => s.id === sourceId);
      if (!source) continue;
      for (const ch of cache.channels) {
        if (!matches(ch.id, ch.displayName)) continue;
        epgResults.push({
          kind: "epg",
          id: ch.id,
          containerId: source.id,
          containerName: source.name,
          category: null,
          name: ch.displayName,
          url: null,
          tvgId: ch.id,
          logo: ch.icon,
        });
        if (epgResults.length >= 50) return res.json([...playlistResults, ...channelPoolResults, ...epgResults]);
      }
    }

    res.json([...playlistResults, ...channelPoolResults, ...epgResults]);
  });

  // Legacy long-form URL (kept for backwards compatibility)
  app.get("/api/playlists/:exportId.m3u", (req, res) => {
    const db = readDb();
    const playlist = db.playlists.find(p => p.exportId === req.params.exportId);
    if (!playlist) return res.status(404).send("Playlist not found");
    serveM3U(playlist, db, res);
  });

  // EPG XMLTV Server
  app.get(/^\/(\d+)\/epg$/, async (req, res) => {
    const shortId = parseInt(req.params[0], 10);
    const db = readDb();
    const playlist = db.playlists.find(p => p.shortId === shortId);
    if (!playlist) return res.status(404).send("Playlist not found");

    const channels = db.channels.filter(c => c.playlistId === playlist.id && !c.isHidden && c.tvgId);
    const tvgIds = new Set(channels.map(c => c.tvgId as string));

    res.setHeader("Content-Type", "application/xml");
    // Sent in pieces (see sendPiece), a few channels' programmes at a time read from disk, so
    // even a playlist with thousands of channels and a week of programmes never has to be
    // built up in memory first.
    if (!await sendPiece(res, `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="m3u4me">\n`)) return;

    // A copy of the list, because a guide can be replaced by a fresh download while this
    // answer is still being sent.
    for (const guide of [...epgGuides.values()]) {
      let xml = '';
      for (const c of guide.channels) {
        if (tvgIds.has(c.id)) {
          xml += `  <channel id="${escapeXmlAttr(c.id)}">\n`;
          xml += `    <display-name><![CDATA[${escapeCData(c.displayName)}]]></display-name>\n`;
          if (c.icon) xml += `    <icon src="${escapeXmlAttr(c.icon)}"/>\n`;
          xml += `  </channel>\n`;
        }
      }
      if (!await sendPiece(res, xml)) return;

      const wanted = [...tvgIds].filter(id => guide.runs.has(id));
      for (let i = 0; i < wanted.length; i += 25) {
        xml = '';
        for (const programmes of readChannelProgrammes(guide, wanted.slice(i, i + 25)).values()) {
          for (const p of programmes) {
            xml += `  <programme start="${escapeXmlAttr(p.start)}" stop="${escapeXmlAttr(p.stop)}" channel="${escapeXmlAttr(p.channel)}">\n`;
            xml += `    <title><![CDATA[${escapeCData(p.title)}]]></title>\n`;
            if (p.desc) xml += `    <desc><![CDATA[${escapeCData(p.desc)}]]></desc>\n`;
            if (p.category) xml += `    <category><![CDATA[${escapeCData(p.category)}]]></category>\n`;
            if (p.icon) xml += `    <icon src="${escapeXmlAttr(p.icon)}"/>\n`;
            xml += `  </programme>\n`;
          }
        }
        if (!await sendPiece(res, xml)) return;
      }
    }
    res.end(`</tv>`);
  });

  // Short numeric URL: /1  /2  /3 …
  app.get(/^\/(\d+)$/, (req, res) => {
    const shortId = parseInt(req.params[0], 10);
    const db = readDb();
    const playlist = db.playlists.find(p => p.shortId === shortId);
    if (!playlist) return res.status(404).send("Playlist not found");
    serveM3U(playlist, db, res);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Safety net, part 2: where failed requests end up (see part 1 near the top of startServer).
  // Express recognises an error handler by its four parameters, so `_next` has to stay.
  // The answer is JSON with a plain message, which the app shows as a toast.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Problems with the request itself (not valid JSON, too large) carry their own 4xx status.
    const status = err?.status >= 400 && err?.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return;
    const message = status === 413 ? "That's too large for m3u4me to accept."
      : status !== 500 ? "m3u4me couldn't understand that request. Reload the page and try again."
      : err?.message?.startsWith("Can't read ") ? err.message // readDb()'s own explanation
      : "Something went wrong on the server. Try again, and check m3u4me's logs if it keeps happening.";
    res.status(status).json({ error: message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
