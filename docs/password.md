🏠 [Home](../README.md) › [Help](README.md) › Password & recovery key

# Password & recovery key

This page explains how to lock m3u4me with a password, and how to get back in if you forget it.

## Do I need a password?

Without a password, anyone on your home network can open m3u4me in a browser and change your playlists. A password keeps them out. It's optional: if you're the only one at home, you might not need one.

**Your TV apps don't need the password.** The playlist and TV guide links keep working for every device on your home network, because TV apps can't type in a password. The password protects the m3u4me pages where you edit things.

## Turning the password on

- During the first-time setup, at **Lock m3u4me with a password?**, or
- Later, in **Settings → Security → Enable Password**.

Passwords need at least 8 characters. A password you already have keeps working, however short.

## Your recovery key

When you set a password, m3u4me shows you a **recovery key**, a code like `XXXX-XXXX-…`.

> [!IMPORTANT]
> Save the recovery key somewhere safe, like a password manager. If you forget your password, it's the only way back in, and **it's only shown once**.

Changing your password gives you a new recovery key, and the old one stops working. Save the new one.

## Forgot your password?

1. On the lock screen, press **Forgot password?**
2. Type your recovery key and a new password.
3. You're back in, and m3u4me shows you a **new recovery key**. Save it, because the old one no longer works.

Lost the recovery key too? There's still a way back in, from the server itself: see [the last section of this page](#if-the-password-file-is-damaged-or-you-lost-everything).

## Changing or removing the password

Open **Settings → Security**:

- **Change Password** asks for your current password, then the new one.
- **Remove Password** asks for your current password, then turns protection off.

Changing the password signs out every other device that was signed in. Sign in on them again with the new password.

## Too many wrong attempts

After 5 wrong passwords (or recovery keys) in a row, m3u4me makes that device wait before the next try: 30 seconds at first, then longer each time, up to 15 minutes. This stops someone on your network from guessing the password by trying thousands of them. Wait for the time shown, then type the right password. Restarting m3u4me also clears the wait.

## Being signed out

Restarting m3u4me (or the server it runs on, or an update) signs everyone out. Just sign in again. Your playlists aren't affected, and TV apps keep working.

## If the password file is damaged, or you lost everything

The password lives in a file called `auth.json` in m3u4me's data folder. If that file gets damaged (for example by a power cut), m3u4me stays locked and says it can't read its password file. That's on purpose: it never unlocks itself.

To get back in, delete `auth.json` from the data folder on the server. This removes the password, and nothing else. Then set a new password in **Settings → Security**.

| How you installed | Command |
| --- | --- |
| One-line install | `sudo rm /opt/m3u4me/data/auth.json` |
| Docker | delete `data/auth.json` next to `docker-compose.yml` |
| PM2 | delete `data/auth.json` inside the m3u4me folder |

This is also the way back in if you forgot your password *and* lost the recovery key.

---

[← Backup & moving to a new server](backup.md) | 🏠 [Help center](README.md) | [Next: Troubleshooting →](troubleshooting.md)
