🏠 [Home](../README.md) › [Help](README.md) › Use it in your TV app

# Use it in your TV app

This page explains where to find your playlist's links and how to add them to the app you watch TV with.

m3u4me doesn't play anything itself. It makes the playlist, and an [IPTV player](glossary.md#iptv-player) (TiviMate, IPTV Smarters or VLC, for example) plays it. Each playlist has two links:

| Link | Looks like | What it's for |
| --- | --- | --- |
| **Playlist** | `http://192.168.1.50:8080/1` | Your channels. |
| **TV guide** | `http://192.168.1.50:8080/1/epg` | What's on each channel, for the players that show a guide. |

The number at the end is the playlist's number: `/1` for your first playlist, `/2` for the second one, and so on.

## Where to find your links

- **On Home:** the **Download Playlists** card lists every playlist, with a **Copy playlist link** button.
- **In the playlist itself:** open it in **My Playlists** and press **Link & download** above the channel list (on a phone, under **⋮**). You get both the **Playlist (M3U)** link and the **TV guide (XMLTV)** link, each with a copy button.

> [!IMPORTANT]
> The copied link uses the same address you opened m3u4me with. If you opened it as `http://localhost:8080`, the link says `localhost`, and that won't work on your TV. Open m3u4me with your server's IP address instead (for example `http://192.168.1.50:8080`), then copy the link again.

## What's in the address

`http://192.168.1.50:8080/1` has three parts:

- **`192.168.1.50`** is your server's [IP address](glossary.md#ip-address-and-port) on your home network. The one-line install prints it when it finishes. You can also find it in your router's list of connected devices.
- **`8080`** is the [port](glossary.md#ip-address-and-port). It's 8080 unless you chose another one when installing.
- **`1`** is the playlist's number.

## Adding it to your player

Every player is a little different, but the steps are nearly always the same:

1. In your player, add a new playlist and choose the option to add it **by URL** (sometimes called "M3U URL" or "M3U playlist").
2. Paste or type the **Playlist** link.
3. If your player has a setting for a TV guide (often called "EPG" or "XMLTV"), paste the **TV guide** link there.

> [!TIP]
> Typing on a TV remote is slow, which is why m3u4me keeps the links this short. No more typing huge links on your TV.

## When you change your playlist

Everything you do in m3u4me is saved straight away, and the link always gives the newest version of the playlist. Your player sees the changes the next time it reloads the playlist. Most players do that on their own from time to time, and have a button to reload it straight away.

- Channels you hide in m3u4me are left out of the playlist and the TV guide.
- The order of the channels follows your categories, and the order of channels inside each category.

## Good to know

- **The links only work on your home network,** because m3u4me runs on your own server. That's how your playlists stay private.
- **The links work even when m3u4me has a password.** TV apps can't type in a password, so the playlist and TV guide links stay open to your home network. The password protects the m3u4me pages where you edit things. See [Password & recovery key](password.md).
- The TV guide link only contains the channels in that playlist, so your player doesn't have to download your provider's whole guide.

---

[← First steps](first-steps.md) | 🏠 [Help center](README.md) | [Next: Features →](features.md)
