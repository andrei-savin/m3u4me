🏠 [Home](../README.md) › [Help](README.md) › Updating

# Updating m3u4me

This page explains how to get the newest version. Your playlists, sources and settings are kept when you update.

> [!TIP]
> You don't need to keep checking GitHub. When a new version is out, m3u4me shows a banner saying **A new version of m3u4me is available**. **Settings → About** shows which version you have.

Follow the steps for the way you installed m3u4me:

- [One-line install](#if-you-used-the-one-line-install)
- [Docker](#if-you-use-docker)
- [Manual install with PM2](#if-you-installed-manually-with-pm2)

## If you used the one-line install

```bash
sudo m3u4me update
```

That is the entire update. It fetches the newest release, rebuilds the app, restarts it and checks that it is running. If the new version fails to build or does not start, it automatically puts the previous version back.

## If you use Docker

In the m3u4me folder, run:

```bash
git pull --ff-only
```
```bash
docker compose up -d --build
```

## If you installed manually with PM2

**1. Navigate into the app's folder.** The folder shown below is only an example. Use the folder you installed m3u4me in.
```bash
cd /opt/m3u4me
```

**2. Pull the latest code from this repo**
```bash
git pull --ff-only
```

<details>
<summary><b>Got an error about <code>package-lock.json</code>?</b></summary>
<br/>

During this step, you might run into the following error:

`Your local changes to the following files would be overwritten by merge. / package-lock.json / Please commit your changes or stash them before you merge.`

If so, just run this, then do step 2 again and continue with the following steps:
```bash
git restore package-lock.json
```

</details>

**3. Install any new dependencies**
```bash
npm ci
```

**4. Rebuild the app**
```bash
npm run build
```

**5. Restart the PM2 process**
```bash
pm2 restart ecosystem.config.cjs --update-env
```

> [!NOTE]
> Restarting m3u4me signs you out if you've set a password. Just sign in again.

## Updating from 3.0.0 or older

Version 3.1.0 and newer are much faster, because they keep their data in several smaller files instead of one big `db.json`. The first time one of them starts, it splits your data up by itself. Nothing is lost and there's nothing for you to do.

The old file is kept in the [data folder](install.md#where-your-data-lives) as `db.json.before-split-` followed by the date and time. Once you're happy with the new version, you can delete it.

TV guides are now saved on the server too, in the data folder's `epg` folder, so they no longer have to download again at every start. They download once more right after this update. A guide takes about as much disk space as the guide file itself.

> [!NOTE]
> Going back to 3.0.0 or older? Stop m3u4me, rename that `db.json.before-split-…` file back to `db.json`, then start the older version. Anything you changed after updating isn't in that file.

---

[← Features](features.md) | 🏠 [Help center](README.md) | [Next: Backup & moving to a new server →](backup.md)
