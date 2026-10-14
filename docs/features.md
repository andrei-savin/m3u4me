🏠 [Home](../README.md) › [Help](README.md) › Features

# Features

This page is a tour of everything m3u4me can do.

**On this page:** [Guided setup](#guided-setup) · [Playlists and channels](#playlists-and-channels) · [Sources](#sources) · [Channel sync](#channel-sync) · [TV guide (EPG)](#tv-guide-epg) · [Printable channel list](#printable-channel-list) · [Backup & restore](#backup--restore) · [Search and shortcuts](#search-and-shortcuts) · [Look and feel](#look-and-feel)

## Guided setup

The first time you open m3u4me, a short setup walks you through adding your provider and TV guide, an optional password, and your first playlist. Moving from another m3u4me? Restore your backup right from the welcome screen. See [First steps](first-steps.md).

## Playlists and channels

**Multiple playlists.** Add as many playlists as you like. Start empty, or import an [M3U](glossary.md#m3u) or [XSPF](glossary.md#xspf) playlist from a URL or an uploaded file.

**Simple playlist links.** No more typing huge links on your TV. Playlists get a number, so your links look like `http://IP:port/1` for your first playlist, `http://IP:port/2` for the second one, and so on. Each playlist also gets its own TV guide link at `http://IP:port/1/epg`. See [Use it in your TV app](tv-app.md).

**Edit anything in place.** Click a channel's name, stream link, logo or [TVG ID](glossary.md#tvg-id) to change it. Drag channels and categories to reorder them, and use **Move to…** to put channels in another category.

**Logo editing.** Add, edit or remove your channels' logos.

**Bulk actions.** Select several channels to move, delete or hide them all at once, or to find & replace text across them. Hide a whole category from your playlist with one click on its eye button. Hidden channels stay in m3u4me but are left out of the playlist your TV app loads.

**Auto-saving.** You don't need to remember to save your changes or push your playlist. Everything happens instantly, automatically.

**Undo delete.** Deleted a channel by mistake? Hit the **Undo** button that appears at the bottom of your screen (or press `Cmd+Z` / `Ctrl+Z`) and bring it back without a hassle.

**Stream checker (not recommended).**

> [!WARNING]
> m3u4me has a basic stream checker (**Check**, in the playlist's toolbar), but some IPTV providers don't react nicely to any sort of bulk checking. Use it at your own risk!

## Sources

A [channel source](glossary.md#channel-source) is where your channels come from, usually your IPTV provider. Connect your [Xtream Codes](glossary.md#xtream-codes) account, a playlist URL, or an M3U/XSPF file; then browse, search and add channels into any playlist.

**Their own refresh schedule.** Each source refreshes on its own schedule (every 24 hours unless you change it) and keeps a changelog of what got added, removed or renamed. Uploaded files never refresh.

**Choose which app it downloads as.** If a provider only works with certain apps, choose which app the source downloads as: TiviMate, VLC, Kodi, a browser, or your own [user agent](glossary.md#user-agent). It's under **User agent (optional)** in the source's settings.

**Errors in plain words.** When a download fails, the source tells you why in plain words and what to try, and keeps showing it until a download works. A failed source is retried every 5 minutes. See [Troubleshooting](troubleshooting.md#a-source-says-the-download-failed).

## Channel sync

When you add channels from an Xtream Codes or playlist URL source, you can keep them in sync with that source. Your provider changes a stream link or a logo, and your playlist follows along.

- **Choose what updates automatically:** stream link, name, logo and TVG ID. The category is never changed, so your own organisation stays. Choose per selection or per channel, and set your defaults in **Settings → Channel Sync**.
- **Your edits are respected.** If you changed something yourself, the provider's update waits for you to accept or skip it. A small dot marks channels with updates waiting.
- **Lost channels.** Channels that disappear from their source are hidden and marked **Source lost**. If they come back, they're shown again.
- **Sync log.** Every playlist has a **Sync log** that lists what changed and when.
- **Existing channels too.** Channels already in a playlist can be linked with **Link to source**.

Uploaded-file sources can't be synced, because they never refresh.

## TV guide (EPG)

Add [EPG](glossary.md#epg-tv-guide) sources from an XMLTV URL or an Xtream Codes account, each on its own refresh interval (every 12 hours unless you change it).

- **Browse a live programme timeline** in the **EPG** tab, and click a programme for its details.
- **Assign TVG IDs** to your channels so your TV app shows what's on:
  - by hand, with suggestions as you type
  - in bulk, with **Bulk EPG Assignment**, which matches channel names automatically
  - from the guide, by picking a guide channel and assigning it to channels in any playlist
- **Every playlist gets its own guide link,** containing only that playlist's channels.

## Printable channel list

Turn any playlist into a neat A4 channel list PDF, with numbers, logos, names and whether each channel has a TV guide. Press **PDF** in the playlist's toolbar, check the preview, then **Save PDF** and choose **Save as PDF** in the print window.

## Backup & restore

Download everything (playlists, sources, TV guides and settings) as one file from **Settings**, then restore it on the same server or a new one. See [Backup & moving to a new server](backup.md).

## Search and shortcuts

**Global search.** Press `Cmd+K` / `Ctrl+K` to search across every playlist, channel source, and EPG source at once. All searches ignore accents, so typing "stiri" also finds "Știri".

**Keyboard shortcuts.** The full list is inside the app, under the keyboard button in the top bar.

| Shortcut | What it does |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Open search |
| `Cmd+A` / `Ctrl+A` | Select all channels in the category |
| `Esc` | Clear the selection |
| `Del` | Delete the selected channels |
| `Space` | Hide or show the selected channels |
| `Cmd+Z` / `Ctrl+Z` | Undo the last delete or bulk change |

## Look and feel

- **Light mode, Dark mode & AMOLED Dark mode.**
- **Custom accent colours.** Even the browser tab's icon matches your chosen colour.
- **Channel logo background colour presets.** Choose between light gray, white, black or transparency. *(Only for previewing. Does not affect the actual logos in the playlist.)*
- **Hide stream URLs.** Useful for sharing screenshots. It's the **Hide stream URLs** button in the top bar.
- **12-hour or 24-hour time.** Pick your preferred clock format for the TV guide.

All of these are in **Settings → Appearance**, except Hide stream URLs.

---

[← Use it in your TV app](tv-app.md) | 🏠 [Help center](README.md) | [Next: Updating →](updating.md)
