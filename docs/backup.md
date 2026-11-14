🏠 [Home](../README.md) › [Help](README.md) › Backup & moving to a new server

# Backup & moving to a new server

This page explains how to save everything m3u4me knows in one file, and how to bring it back on the same server or a new one.

## Making a backup

In m3u4me, open **Settings → Backup → Download backup**. That one file holds your playlists, sources, TV guides and settings.

> [!WARNING]
> The backup also holds your providers' logins, so keep it private. Don't share it or post it anywhere.

Your m3u4me password is not part of the backup.

## Restoring a backup

- **On a new server:** [install m3u4me](install.md), open it, and choose **Restore a backup** on the welcome screen.
- **On a server that's already set up:** open **Settings → Backup → Restore from backup**. This replaces everything m3u4me has now.

> [!NOTE]
> Just in case, restoring on a server that's already set up keeps a copy of the replaced data in m3u4me's data folder, named `db.json.before-restore-` followed by the date and time.

After a restore, your sources download their channels and TV guides again in the background, so they can take a few minutes to show up.

## Moving to a new server

1. On the old server, download a backup.
2. [Install m3u4me](install.md) on the new server.
3. Open it and choose **Restore a backup** on the welcome screen.
4. If the new server has a different address, update the playlist links in your TV apps. The playlist numbers stay the same. See [Use it in your TV app](tv-app.md).

## Coming from an older version?

Older versions of m3u4me don't have the **Download backup** button. Use the `db.json` file from the old server's data folder instead:

| How you installed | Data folder |
| --- | --- |
| One-line install | `/opt/m3u4me/data` |
| Docker or PM2 | the `data` folder inside the m3u4me folder |

> [!NOTE]
> This only applies to those older versions. Newer versions keep their data in several files, so `db.json` on its own is no longer everything. Use **Download backup** instead.

---

[← Updating](updating.md) | 🏠 [Help center](README.md) | [Next: Password & recovery key →](password.md)
