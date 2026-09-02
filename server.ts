import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { gunzipSync } from "zlib";
import { XMLParser } from "fast-xml-parser";
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
// A known Node.js/undici bug (github.com/nodejs/undici#5360) can throw an
// uncatchable AssertionError from an internal socket handler when a fetch()
// response body isn't fully drained before the remote server closes the
// connection — common with flaky IPTV/EPG sources. It can't be caught with a
// normal try/catch, so we catch it at the process level to stop one bad
// upstream response from taking down the whole app.
process.on('uncaughtException', (err) => {
  if (err?.name === 'AssertionError' && err?.message?.includes('assert(!this.paused)')) {
    console.error('Caught Node.js/undici bug #5360 (continuing):', err);
    return;
  }
  console.error('Uncaught exception (continuing):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (continuing):', reason);
});

const DB_FILE = path.join(DATA_DIR, "db.json");

// Define types matching frontend
interface Playlist {
  id: string;
  name: string;
  userId: string;
  categories: string[];
  exportId: string;
  shortId: number;
  createdAt: number;
  updatedAt: number;
}

interface Channel {
  id: string;
  playlistId: string;
  name: string;
  url: string;
  logo: string | null;
  tvgId: string | null;
  category: string;
  order: number;
  isHidden?: boolean;
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
  refreshIntervalHours: number;
  lastFetched: number | null;
  lastFetchError: string | null; // set when the most recent refresh attempt failed; cleared on success
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

interface Database {
  playlists: Playlist[];
  channels: Channel[];
  epgSources: EpgSource[];
  channelPoolSources: ChannelPoolSource[];
  channelPoolEntries: ChannelPoolEntry[];
  channelPoolChangeLogs: ChannelPoolChangeLog[];
}

// Initial DB
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ playlists: [], channels: [], epgSources: [], channelPoolSources: [], channelPoolEntries: [], channelPoolChangeLogs: [] }, null, 2));
}

// Simple DB sync functions (fine for local single-user apps)
function readDb(): Database {
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed.epgSources) parsed.epgSources = [];
    if (!parsed.channelPoolSources) parsed.channelPoolSources = [];
    if (!parsed.channelPoolEntries) parsed.channelPoolEntries = [];
    if (!parsed.channelPoolChangeLogs) parsed.channelPoolChangeLogs = [];
    return parsed;
  } catch (e) {
    return { playlists: [], channels: [], epgSources: [], channelPoolSources: [], channelPoolEntries: [], channelPoolChangeLogs: [] };
  }
}

function writeDb(data: Database) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
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
  subTitle: string | null;
  icon: string | null;
  rating: string | null;
}

const epgCache = new Map<string, { channels: ParsedEpgChannel[]; programmes: ParsedEpgProgramme[]; fetchedAt: number }>();

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

async function fetchAndParseEpg(source: EpgSource): Promise<{ channels: ParsedEpgChannel[]; programmes: ParsedEpgProgramme[] }> {
  let fetchUrl = source.url;
  if (source.type === 'xtream' && source.xtreamCredentials) {
    const baseUrl = source.url.replace(/\/$/, '');
    fetchUrl = `${baseUrl}/xmltv.php?username=${encodeURIComponent(source.xtreamCredentials.username)}&password=${encodeURIComponent(source.xtreamCredentials.password)}`;
  }

  const res = await fetchWithTimeout(fetchUrl, EPG_FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.statusText}`);
  const buf = await res.arrayBuffer();
  let xmlData = Buffer.from(buf);
  
  if (xmlData.length > 2 && xmlData[0] === 0x1F && xmlData[1] === 0x8B) {
    xmlData = gunzipSync(xmlData);
  }
  
  const parsed = xmlParser.parse(xmlData.toString('utf-8'));
  const tv = parsed.tv || {};
  
  const getText = (val: any) => typeof val === 'object' && val !== null ? val['#text'] || '' : val;
  
  const channels: ParsedEpgChannel[] = (tv.channel || []).map((c: any) => ({
    id: c['@_id'] || '',
    displayName: (c['display-name'] && c['display-name'][0] ? getText(c['display-name'][0]) : '') || '',
    icon: (c.icon && c.icon[0] ? c.icon[0]['@_src'] : null) || null,
  }));
  
  const programmes: ParsedEpgProgramme[] = (tv.programme || []).map((p: any) => ({
    channel: p['@_channel'] || '',
    start: p['@_start'] || '',
    stop: p['@_stop'] || '',
    title: getText(p.title) || '',
    desc: getText(p.desc) || null,
    category: p.category && p.category.length > 0 ? getText(p.category[0]) : null,
    date: p.date ? String(p.date) : null,
    episodeNum: p['episode-num'] ? getText(p['episode-num']) : null,
    subTitle: p['sub-title'] ? getText(p['sub-title']) : null,
    icon: (p.icon && p.icon[0] ? p.icon[0]['@_src'] : null) || null,
    rating: p.rating && p.rating.value ? String(p.rating.value) : null,
  }));
  
  return { channels, programmes };
}

async function refreshEpgSource(sourceId: string) {
  const db = readDb();
  const source = db.epgSources.find(s => s.id === sourceId);
  if (!source) return;
  try {
    const data = await fetchAndParseEpg(source);
    epgCache.set(sourceId, { ...data, fetchedAt: Date.now() });

    const updatedDb = readDb();
    const idx = updatedDb.epgSources.findIndex(s => s.id === sourceId);
    if (idx !== -1) {
      updatedDb.epgSources[idx].lastFetched = Date.now();
      updatedDb.epgSources[idx].channelCount = data.channels.length;
      updatedDb.epgSources[idx].lastFetchError = null;
      writeDb(updatedDb);
    }
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

// ── Channel Pool Cache and Functions ─────────────────────────────────────
const channelPoolCache = new Map<string, ChannelPoolEntry[]>();

async function fetchXtreamChannels(source: ChannelPoolSource): Promise<ChannelPoolEntry[]> {
  if (!source.url || !source.xtreamCredentials) return [];
  const baseUrl = source.url.replace(/\/$/, '');
  const { username, password } = source.xtreamCredentials;
  
  const catRes = await fetch(`${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`);
  if (!catRes.ok) throw new Error(`Failed to fetch categories: ${catRes.statusText}`);
  const catData = await catRes.json();
  // Xtream panels respond with HTTP 200 even for an invalid/expired login — the body is
  // an error object (e.g. {"user_info":{"auth":0}}) instead of the expected array. Treating
  // that as "zero categories/channels" would make a transient auth hiccup look like a real,
  // empty refresh and wipe out every previously cached channel for this source, so it's
  // treated as a hard failure instead (caught by refreshChannelPoolSource, which leaves the
  // existing cached entries untouched on error).
  if (!Array.isArray(catData)) {
    throw new Error('Xtream server returned an unexpected response for categories (check the URL/username/password — the login may be invalid or expired).');
  }
  const catMap = new Map<string, string>();
  for (const c of catData) {
    catMap.set(String(c.category_id), c.category_name || 'General');
  }

  const streamsRes = await fetch(`${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`);
  if (!streamsRes.ok) throw new Error(`Failed to fetch streams: ${streamsRes.statusText}`);
  const streamsData = await streamsRes.json();
  if (!Array.isArray(streamsData)) {
    throw new Error('Xtream server returned an unexpected response for live streams (check the URL/username/password — the login may be invalid or expired).');
  }

  const entries: ChannelPoolEntry[] = [];
  for (const s of streamsData) {
    entries.push({
      id: uuidv4(),
      sourceId: source.id,
      name: s.name || 'Unknown',
      url: `${baseUrl}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${s.stream_id}.ts`,
      logo: s.stream_icon || null,
      category: catMap.get(String(s.category_id)) || 'General',
      tvgId: s.epg_channel_id || null,
    });
  }
  return entries;
}

function parseM3uToChannelPoolEntries(content: string, sourceId: string): ChannelPoolEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: ChannelPoolEntry[] = [];
  let currentEntry: Partial<ChannelPoolEntry> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const tvgIdMatch = line.match(/tvg-id="([^"]+)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const groupTitleMatch = line.match(/group-title="([^"]+)"/i);
      const nameMatch = line.match(/,(.+)$/);
      
      currentEntry = {
        tvgId: tvgIdMatch ? tvgIdMatch[1] : null,
        logo: tvgLogoMatch ? tvgLogoMatch[1] : null,
        category: groupTitleMatch ? groupTitleMatch[1] : 'General',
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
      };
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
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`Failed to fetch playlist: ${res.statusText}`);
  const content = await res.text();
  if (content.trim().startsWith('<?xml') && content.includes('<playlist')) {
    return parseXspfToChannelPoolEntries(content, source.id);
  }
  return parseM3uToChannelPoolEntries(content, source.id);
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

/** Diffs old vs. new entries and logs the changes. Returns whether anything actually changed. */
function detectChannelPoolChanges(sourceId: string, newEntries: ChannelPoolEntry[]): boolean {
  const db = readDb();
  const oldEntries = db.channelPoolEntries.filter(e => e.sourceId === sourceId);
  const source = db.channelPoolSources.find(s => s.id === sourceId);

  if (!oldEntries.length) {
    db.channelPoolEntries = db.channelPoolEntries.filter(e => e.sourceId !== sourceId).concat(newEntries);
    writeDb(db);
    return newEntries.length > 0;
  }

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
  
  const hasChanges = added.length > 0 || removed.length > 0 || renamed.length > 0;
  if (hasChanges) {
    const log: ChannelPoolChangeLog = {
      id: uuidv4(),
      sourceId,
      sourceName: source?.name || 'Unknown Source',
      timestamp: Date.now(),
      added,
      removed,
      renamed,
    };
    db.channelPoolChangeLogs.push(log);

    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    db.channelPoolChangeLogs = db.channelPoolChangeLogs.filter(l => l.timestamp > ninetyDaysAgo);
  }

  db.channelPoolEntries = db.channelPoolEntries.filter(e => e.sourceId !== sourceId).concat(newEntries);
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
    channelPoolCache.set(sourceId, newEntries);

    const updatedDb = readDb();
    const idx = updatedDb.channelPoolSources.findIndex(s => s.id === sourceId);
    if (idx !== -1) {
      updatedDb.channelPoolSources[idx].lastFetched = Date.now();
      updatedDb.channelPoolSources[idx].channelCount = newEntries.length;
      updatedDb.channelPoolSources[idx].lastFetchError = null;
      writeDb(updatedDb);
    }
    return changed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to refresh Channel Pool source ${source.name}:`, err);
    const updatedDb = readDb();
    const idx = updatedDb.channelPoolSources.findIndex(s => s.id === sourceId);
    if (idx !== -1) {
      updatedDb.channelPoolSources[idx].lastFetchError = message;
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

// ── Auth helpers ─────────────────────────────────────────────────────────
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
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

function readAuth(): AuthData | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch { return null; }
}

function writeAuth(data: AuthData) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
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
    extinf += `,${stripM3uNewlines(ch.name || 'Unnamed')}\n${stripM3uNewlines(ch.url)}\n`;
    m3u += extinf;
  });
  res.send(m3u);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  app.use(express.json({ limit: '50mb' }));

  // Initialize EPG Cache. Refreshed one source at a time (not all at once) —
  // see refreshEpgSourcesSequentially. This is fired without awaiting so it
  // doesn't delay the server from listening.
  const dbConfig = readDb();
  refreshEpgSourcesSequentially(dbConfig.epgSources.map(s => s.id));
  const channelPoolSourceIdsToRefresh: string[] = [];
  for (const source of dbConfig.channelPoolSources) {
    if (source.type !== 'playlist-file') {
      channelPoolSourceIdsToRefresh.push(source.id);
    } else {
      const entries = dbConfig.channelPoolEntries.filter(e => e.sourceId === source.id);
      channelPoolCache.set(source.id, entries);
    }
  }
  // Same reasoning as the EPG sources above — refreshed one at a time (see
  // refreshChannelPoolSourcesSequentially) instead of all firing their fetches
  // in the same instant, and fired without awaiting so it doesn't delay the
  // server from listening.
  refreshChannelPoolSourcesSequentially(channelPoolSourceIdsToRefresh);

  setInterval(() => {
    const currentDb = readDb();
    const now = Date.now();
    // A source whose last attempt failed is retried on every tick (regardless
    // of its refresh interval) until it succeeds, instead of silently sitting
    // empty until the interval next comes due.
    const dueEpgSourceIds = currentDb.epgSources.filter(source => {
      const intervalMs = (source.refreshIntervalHours || 12) * 60 * 60 * 1000;
      return !source.lastFetched || source.lastFetchError || (now - source.lastFetched) > intervalMs;
    }).map(source => source.id);
    refreshEpgSourcesSequentially(dueEpgSourceIds);
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
    res.json({ enabled: !!auth });
  });

  app.post('/api/auth/login', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.json({ token: null, message: 'No password set' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    try {
      const { hash } = await hashPassword(password, auth.passwordSalt);
      if (hash !== auth.passwordHash) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      const token = generateToken();
      activeSessions.add(token);
      res.json({ token });
    } catch {
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/set-password', async (req, res) => {
    const auth = readAuth();
    const { password, currentPassword } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
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
      res.json({ recoveryKey: formatRecoveryKey(recoveryKey) });
    } catch {
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/recover', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.status(400).json({ error: 'No password set' });
    const { recoveryKey, newPassword } = req.body;
    if (!recoveryKey || !newPassword) {
      return res.status(400).json({ error: 'Recovery key and new password required' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    try {
      // Strip formatting dashes from recovery key
      const cleanKey = recoveryKey.replace(/-/g, '').toUpperCase();
      const { hash } = await hashPassword(cleanKey, auth.recoveryKeySalt);
      if (hash !== auth.recoveryKeyHash) {
        return res.status(401).json({ error: 'Invalid recovery key' });
      }
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
    } catch {
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/remove-password', async (req, res) => {
    const auth = readAuth();
    if (!auth) return res.json({ success: true });
    const { currentPassword } = req.body;
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    try {
      const { hash } = await hashPassword(currentPassword, auth.passwordSalt);
      if (hash !== auth.passwordHash) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      deleteAuth();
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Internal error' });
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
    epgCache.delete(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/epg-sources/:id/refresh", async (req, res) => {
    await refreshEpgSource(req.params.id);
    const cache = epgCache.get(req.params.id);
    res.json({ success: true, channelCount: cache?.channels.length || 0 });
  });

  app.get("/api/epg-sources/:id/channels", (req, res) => {
    const source = readDb().epgSources.find(s => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "Not found" });
    const cache = epgCache.get(req.params.id);
    if (!cache) return res.json([]);
    const channels = cache.channels.map(c => ({ ...c, sourceId: source.id, sourceName: source.name }));
    channels.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json(channels);
  });

  app.get("/api/epg-sources/:id/programs/:channelId", (req, res) => {
    const cache = epgCache.get(req.params.id);
    if (!cache) return res.json([]);
    const progs = cache.programmes.filter(p => p.channel === req.params.channelId);
    res.json(progs);
  });

  app.get("/api/epg-sources/:id/now", (req, res) => {
    const cache = epgCache.get(req.params.id);
    if (!cache) return res.json({ channels: [], programmes: {} });
    
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
    for (const p of cache.programmes) {
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
    
    res.json({ channels: cache.channels, programmes: progsMap });
  });

  app.get("/api/epg/tvg-ids", (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json([]);
    
    const results = [];
    const dbSources = readDb().epgSources;
    
    for (const [sourceId, cache] of epgCache.entries()) {
      const source = dbSources.find(s => s.id === sourceId);
      if (!source) continue;
      
      for (const ch of cache.channels) {
        if (ch.id.toLowerCase().includes(q) || ch.displayName.toLowerCase().includes(q)) {
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
    
    for (const [sourceId, cache] of epgCache.entries()) {
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
  app.get("/api/channel-pool/sources", (req, res) => {
    res.json(readDb().channelPoolSources);
  });

  app.post("/api/channel-pool/validate-url", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16',
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
      db.channelPoolSources[idx] = { ...db.channelPoolSources[idx], ...req.body, updatedAt: Date.now() };
      writeDb(db);
      res.json(db.channelPoolSources[idx]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.delete("/api/channel-pool/sources/:id", (req, res) => {
    const db = readDb();
    db.channelPoolSources = db.channelPoolSources.filter(s => s.id !== req.params.id);
    db.channelPoolEntries = db.channelPoolEntries.filter(e => e.sourceId !== req.params.id);
    db.channelPoolChangeLogs = db.channelPoolChangeLogs.filter(l => l.sourceId !== req.params.id);
    writeDb(db);
    channelPoolCache.delete(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/channel-pool/sources/:id/refresh", async (req, res) => {
    const changed = await refreshChannelPoolSource(req.params.id);
    const db = readDb();
    const source = db.channelPoolSources.find(s => s.id === req.params.id);
    res.json({ success: true, channelCount: source?.channelCount || 0, changed });
  });

  app.get("/api/channel-pool/sources/:id/channels", (req, res) => {
    const db = readDb();
    const source = db.channelPoolSources.find(s => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "Not found" });
    
    let entries = channelPoolCache.get(req.params.id) || db.channelPoolEntries.filter(e => e.sourceId === req.params.id);
    
    const q = String(req.query.q || '').trim().toLowerCase();
    const cat = String(req.query.category || '').trim();
    const sort = String(req.query.sort || 'name');

    if (cat) {
      entries = entries.filter(e => e.category === cat);
    }
    if (q) {
      entries = entries.filter(e => e.name.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
    }

    // 'original' preserves the order entries were parsed from the source (M3U/Xtream
    // order); anything else falls back to the previous alphabetical-by-name behavior.
    const sorted = sort === 'original' ? entries : [...entries].sort((a, b) => a.name.localeCompare(b.name));
    res.json(sorted);
  });

  app.get("/api/channel-pool/sources/:id/categories", (req, res) => {
    const db = readDb();
    const entries = channelPoolCache.get(req.params.id) || db.channelPoolEntries.filter(e => e.sourceId === req.params.id);
    
    const categories = new Set(entries.map(e => e.category));
    const sorted = Array.from(categories).sort((a, b) => a.localeCompare(b));
    res.json(sorted);
  });

  app.get("/api/channel-pool/changelog", (req, res) => {
    const db = readDb();
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const perPage = 20;
    
    const logs = db.channelPoolChangeLogs.sort((a, b) => b.timestamp - a.timestamp);
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
    
    db.channelPoolSources.push(newSource);
    
    let entries: ChannelPoolEntry[] = [];
    if (content.trim().startsWith('<?xml') && content.includes('<playlist')) {
      entries = parseXspfToChannelPoolEntries(content, newSource.id);
    } else {
      entries = parseM3uToChannelPoolEntries(content, newSource.id);
    }
    
    newSource.channelCount = entries.length;
    db.channelPoolEntries.push(...entries);
    writeDb(db);
    
    channelPoolCache.set(newSource.id, entries);
    
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

  app.get("/api/playlists", (req, res) => {
    const db = readDb();
    res.json(db.playlists);
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.playlists.push(newPlaylist);
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
      order: i + 1,
      isHidden: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    db.playlists.push(newPlaylist);
    db.channels = [...db.channels, ...newChannels];
    writeDb(db);

    res.json(newPlaylist);
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
    db.playlists[idx] = { ...db.playlists[idx], ...req.body, updatedAt: Date.now() };
    writeDb(db);
    res.json(db.playlists[idx]);
  });

  app.delete("/api/playlists/:playlistId", (req, res) => {
    const db = readDb();
    const { playlistId } = req.params;
    db.playlists = db.playlists.filter(p => p.id !== playlistId);
    db.channels = db.channels.filter(c => c.playlistId !== playlistId);
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

    const newChannels: Channel[] = channels.map((c: any, i: number) => {
      // Find category and add it to playlist if missing
      const cat = c.category || "General";
      return {
        id: uuidv4(),
        playlistId,
        name: c.name || "Unknown",
        url: c.url || "",
        logo: c.logo || null,
        tvgId: c.tvgId || null,
        category: cat,
        order: maxOrder + i + 1,
        isHidden: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    db.channels = [...db.channels, ...newChannels];

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
      db.channels[idx] = { ...db.channels[idx], ...req.body, updatedAt: Date.now() };
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
    const { ids, updates } = req.body;
    db.channels = db.channels.map(c => {
      if (c.playlistId === playlistId && ids.includes(c.id)) {
        return { ...c, ...updates, updatedAt: Date.now() };
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

    const updateMap = new Map<string, any>(updates.map((u: any) => [u.id, u.changes]));

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
        return { ...c, ...changes, updatedAt: Date.now() };
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
      return { ...c, [targetField]: updated, updatedAt: Date.now() };
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

  app.post("/api/health-check", async (req, res) => {
    const { channels } = req.body as { channels: { id: string; url: string }[] };
    if (!Array.isArray(channels)) return res.status(400).json({ error: 'Invalid input' });
    const TIMEOUT_MS = 8000;
    const results = await Promise.all(
      channels.map(async ({ id, url }) => {
        if (!url) return { id, ok: false, code: null, skipped: true };
        if (!/^https?:\/\//i.test(url)) return { id, ok: false, code: null, skipped: true };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const r = await fetch(url, { method: 'HEAD', signal: controller.signal });
          clearTimeout(timer);
          return { id, ok: r.status < 400, code: r.status };
        } catch (e: any) {
          clearTimeout(timer);
          if (e.name === 'AbortError') return { id, ok: false, code: null, timeout: true };
          // Some servers reject HEAD — try a GET that we abort immediately after headers
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), TIMEOUT_MS);
          try {
            const r2 = await fetch(url, { method: 'GET', signal: c2.signal });
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
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json([]);
    const db = readDb();
    const matches = (...fields: (string | null | undefined)[]) => fields.some(f => f?.toLowerCase().includes(q));

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

    const channelPoolResults = db.channelPoolEntries
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

    // EPG channels only ever live in the in-memory cache (never persisted), so this
    // walks it the same way /api/epg/tvg-ids does — including its trick of returning
    // as soon as the cap is hit instead of scanning every remaining source.
    const epgResults: any[] = [];
    for (const [sourceId, cache] of epgCache.entries()) {
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

  // Proxy endpoint for downloading external M3U Links
  app.get("/api/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send("Missing URL");
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error("Failed to fetch");
      const text = await response.text();
      res.setHeader("Content-Type", "text/plain");
      res.send(text);
    } catch (e) {
      res.status(500).send("Error fetching URL");
    }
  });

  // EPG XMLTV Server
  app.get(/^\/(\d+)\/epg$/, (req, res) => {
    const shortId = parseInt(req.params[0], 10);
    const db = readDb();
    const playlist = db.playlists.find(p => p.shortId === shortId);
    if (!playlist) return res.status(404).send("Playlist not found");

    const channels = db.channels.filter(c => c.playlistId === playlist.id && !c.isHidden && c.tvgId);
    const tvgIds = new Set(channels.map(c => c.tvgId));

    res.setHeader("Content-Type", "application/xml");
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="m3u4me">\n`;
    
    for (const cache of epgCache.values()) {
      for (const c of cache.channels) {
        if (tvgIds.has(c.id)) {
          xml += `  <channel id="${escapeXmlAttr(c.id)}">\n`;
          xml += `    <display-name><![CDATA[${escapeCData(c.displayName)}]]></display-name>\n`;
          if (c.icon) xml += `    <icon src="${escapeXmlAttr(c.icon)}"/>\n`;
          xml += `  </channel>\n`;
        }
      }
      for (const p of cache.programmes) {
        if (tvgIds.has(p.channel)) {
          xml += `  <programme start="${escapeXmlAttr(p.start)}" stop="${escapeXmlAttr(p.stop)}" channel="${escapeXmlAttr(p.channel)}">\n`;
          xml += `    <title><![CDATA[${escapeCData(p.title)}]]></title>\n`;
          if (p.desc) xml += `    <desc><![CDATA[${escapeCData(p.desc)}]]></desc>\n`;
          if (p.category) xml += `    <category><![CDATA[${escapeCData(p.category)}]]></category>\n`;
          if (p.icon) xml += `    <icon src="${escapeXmlAttr(p.icon)}"/>\n`;
          xml += `  </programme>\n`;
        }
      }
    }
    xml += `</tv>`;
    res.send(xml);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
