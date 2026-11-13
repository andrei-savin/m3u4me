🏠 [Home](../README.md) › [Help](README.md) › Troubleshooting

# Troubleshooting

This page lists common problems and how to fix them. Find yours in the list below.

**On this page:**
- [I can't open m3u4me from my phone, TV or another computer](#i-cant-open-m3u4me-from-my-phone-tv-or-another-computer)
- [My TV app can't load the playlist](#my-tv-app-cant-load-the-playlist)
- [My TV app doesn't show my changes](#my-tv-app-doesnt-show-my-changes)
- [The TV guide is empty in my TV app](#the-tv-guide-is-empty-in-my-tv-app)
- [A source says the download failed](#a-source-says-the-download-failed)
- [A channel shows "Source lost"](#a-channel-shows-source-lost)
- [The TV guide is empty after a restart](#the-tv-guide-is-empty-after-a-restart)
- [I forgot my password](#i-forgot-my-password)
- [m3u4me says it can't read its password file](#m3u4me-says-it-cant-read-its-password-file)
- [I keep getting signed out](#i-keep-getting-signed-out)
- [The update failed](#the-update-failed)
- [Where are my files?](#where-are-my-files)
- [None of this helped](#none-of-this-helped)

## I can't open m3u4me from my phone, TV or another computer

- **Use the server's IP address, not `localhost`.** `localhost` always means "this device", so it only works on the server itself. Use an address like `http://192.168.1.50:8080`. See [What's in the address](tv-app.md#whats-in-the-address).
- **Check the port.** It's 8080 unless you chose another one when installing.
- **Be on the same network.** m3u4me only works inside your home network. A phone on mobile data won't reach it.
- **Check that it's running:**
  - One-line install: `m3u4me status`
  - Docker: `docker compose ps`, in the m3u4me folder
  - PM2: `pm2 status`
- **Check the server's firewall.** If your server has a firewall turned on, it needs to allow the port m3u4me uses.

## My TV app can't load the playlist

- Make sure the link has your server's IP address in it, not `localhost`. See [Where to find your links](tv-app.md#where-to-find-your-links).
- Open the playlist link in a browser on the same device or network. If it downloads a file or shows text starting with `#EXTM3U`, the link works, and the problem is in the player's settings.
- Check that the playlist isn't empty, and that its channels aren't all hidden.

## My TV app doesn't show my changes

m3u4me saves everything straight away, but your player keeps its own copy of the playlist. Reload the playlist in your player, or wait for it to reload on its own. See [When you change your playlist](tv-app.md#when-you-change-your-playlist).

## The TV guide is empty in my TV app

- Make sure you added the **TV guide** link (the one ending in `/epg`) to your player's EPG or XMLTV setting.
- Each channel needs a [TVG ID](glossary.md#tvg-id) that exists in one of your guides. Use **Bulk EPG Assignment** in the playlist to match them. See [Matching channels to the TV guide](first-steps.md#matching-channels-to-the-tv-guide).
- Reload the guide in your player.

## A source says the download failed

When a source can't download, m3u4me shows the reason on the source and tries again every 5 minutes. Here's what the common messages mean:

| The message says… | What to do |
| --- | --- |
| **The provider refused the download (error 401 or 403)** | Check the login details, and whether your subscription is still active. Some providers only allow certain IPTV apps: try another user agent (see the tip below). |
| **The provider rejected the username or password** | Check the username and password in the source's settings, or ask your provider whether the subscription is still active. |
| **Nothing was found at this address (error 404)** | Check the link in the source's settings. |
| **Too many requests (error 429)** | The provider wants you to slow down. m3u4me tries again by itself. |
| **The provider is refusing downloads (error 451)** | Some providers answer this way once a subscription has expired, so check that yours is still active. If it is, try another user agent. |
| **The provider's server isn't working right now (error 5xx)** | Usually temporary. m3u4me tries again by itself. |
| **Couldn't find the server** | Check the address for typos. |
| **Couldn't look up / couldn't reach the server** | Check the server's internet connection, then try again. |
| **The server refused the connection** | Check the address and port, or try again later. |
| **The connection was cut off** or **took too long to answer** | Try again later. If it keeps happening, try another user agent. |
| **The security certificate isn't valid** | Try the address with `http://` instead of `https://`. |
| **The link downloaded, but it doesn't contain any channels** | The link probably points to a web page, not a playlist. Check that it points to an M3U or XSPF playlist. |

> [!TIP]
> **Trying another user agent:** edit the source and open **User agent (optional)**. Pick an app like TiviMate or VLC, save, and the source downloads again straight away. Some providers only allow the apps they support.

Your channels stay as they were while a source can't download. Nothing is deleted because of a failed download.

## A channel shows "Source lost"

The channel is [synced](features.md#channel-sync) with a source, and that source no longer has it. m3u4me only marks a channel as lost after it's been missing from **two refreshes in a row**, because some providers return slightly different channel lists each time. Lost channels are hidden from your playlist, so your TV app doesn't show a channel that doesn't work.

- If the channel comes back in a later refresh, it's shown again by itself.
- If your provider renamed it *and* changed its link, it counts as a new channel. Click **Source lost** on the channel and press **Unlink**, then use **Link to source** to link it to the new one. Or just add the new channel from **Sources**.

> [!NOTE]
> If a refresh suddenly loses a large part of a source's channels, m3u4me doesn't mark anything as lost. It waits for the next refreshes to see whether the provider was just having a bad moment. You'll see this in the playlist's **Sync log**.

## The TV guide is empty after a restart

m3u4me downloads your TV guides again every time it starts. Big guides take a few minutes. Wait a little, or open the guide in the **EPG** tab and press the refresh button next to its name (on a phone, **Refresh guide** under **⋮**).

## I forgot my password

On the lock screen, press **Forgot password?** and use your recovery key. See [Forgot your password?](password.md#forgot-your-password). If you lost the recovery key too, see [the last resort](password.md#if-the-password-file-is-damaged-or-you-lost-everything).

## m3u4me says it can't read its password file

The password file got damaged, for example by a power cut, so m3u4me stays locked to keep you safe. Delete `auth.json` from the data folder on the server, then set a new password in **Settings → Security**. See [If the password file is damaged](password.md#if-the-password-file-is-damaged-or-you-lost-everything).

## I keep getting signed out

Every time m3u4me restarts (after an update, or when the server restarts), everyone is signed out. That's normal. Sign in again. Your TV apps aren't affected.

## The update failed

- **One-line install:** if the new version fails to build or doesn't start, `sudo m3u4me update` puts the previous version back by itself, so m3u4me keeps working. Run `sudo m3u4me logs` to see what happened.
- **PM2:** if `git pull` complains about `package-lock.json`, see [Updating with PM2](updating.md#if-you-installed-manually-with-pm2).

If it keeps failing, [open an issue](https://github.com/andrei-savin/m3u4me/issues) and include what the update printed.

## Where are my files?

Everything is in m3u4me's `data` folder. See [Where your data lives](install.md#where-your-data-lives). To keep a copy, use **Settings → Backup** instead. See [Backup & moving to a new server](backup.md).

## None of this helped

[Open an issue on GitHub](https://github.com/andrei-savin/m3u4me/issues). Describe what you did, what you expected, and what happened instead. A screenshot of the error helps a lot.

---

[← Password & recovery key](password.md) | 🏠 [Help center](README.md) | [Next: Glossary →](glossary.md)
