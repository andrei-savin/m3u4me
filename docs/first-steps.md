🏠 [Home](../README.md) › [Help](README.md) › First steps

# First steps

This page walks you through the first-time setup, then shows how to add more sources and fill your playlists.

## The first-time setup

The first time you open m3u4me in your browser, a short setup starts. Leaving it half-way or reloading the page brings it back from the start. It's done once you've named your first playlist.

**Welcome: "Make it yours."** Pick an accent colour and light or dark mode. You can change both later in **Settings → Appearance**.

Then choose one of two paths:

### Start fresh

1. **Add your sources.** Sources are where your channels and TV guide come from, usually your IPTV provider.
   - Under **Channels**, add your [Xtream Codes](glossary.md#xtream-codes) login, a playlist link, or a playlist file.
   - Under **TV guide (EPG)**, add a guide. If you added an Xtream Codes source, one click on **Use the TV guide from …** adds its guide with the same login.

   You can skip this step and add sources later.
2. **Lock m3u4me with a password?** Anyone on your home network can open m3u4me in a browser, and a password keeps them out. Your TV apps keep loading your playlists without it. If you set one, **save the recovery key** it shows you. See [Password & recovery key](password.md).
3. **Name your first playlist.** A playlist is the list of channels your TV app loads. You can make more later, like one per room or per person.
4. **You're all set.** You get your playlist's link (and its TV guide link, if you added a guide). Press **Add channels** to start filling it.

### Restore a backup

Moving from another m3u4me? Choose **Restore a backup**, then drop in your backup file. Everything comes back: playlists, sources, TV guides and settings. Your password isn't part of the backup, so the next step offers to set one. See [Backup & moving to a new server](backup.md).

## Adding channels to a playlist

m3u4me has three tabs along the top: **My Playlists**, **Sources** and **EPG**.

1. Open **Sources** and pick a source on the left.
2. Search or filter by category, and tick the channels you want.
3. Press **Add to playlist**, choose the playlist, and optionally a category to put them in.
4. Leave **Keep in sync with source** on if you want these channels to follow your provider's changes. See [Channel sync](features.md#channel-sync).

> [!TIP]
> Your source's channels can take a few minutes to show up after you add it, while m3u4me downloads them in the background.

You can also add a channel by hand: open the playlist in **My Playlists** and press **Add channel**.

## Adding another source

- **Channels:** in **Sources**, press **+** (**Add channel source**). Choose **Playlist Link**, **Xtream Codes** or **Upload File**.
- **TV guide:** in **EPG**, press **+** (**Add EPG source**). Choose **EPG Link** (an XMLTV address) or **Xtream Codes API**.

Each source refreshes on its own. You can set how often, in hours, with **Refresh Interval**. Uploaded files never refresh.

## Matching channels to the TV guide

For your TV app to show what's on, each channel needs a [TVG ID](glossary.md#tvg-id) that exists in your guide. Channels from Xtream Codes sources often have one already. For the rest:

- **Many at once:** open the playlist and press **Assign EPG**. m3u4me matches your channel names to the guide's channel names, and you check the matches before applying them.
- **One at a time:** click a channel's TVG ID and start typing. Suggestions come from your guides.
- **From the guide:** in **EPG**, pick a guide channel and assign it to channels in any playlist.

## Next

Your playlist is ready. Now [put it in your TV app](tv-app.md).

---

[← Install](install.md) | 🏠 [Help center](README.md) | [Next: Use it in your TV app →](tv-app.md)
