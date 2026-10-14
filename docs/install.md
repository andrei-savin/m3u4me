🏠 [Home](../README.md) › [Help](README.md) › Install

# Installing m3u4me

This page explains the three ways to install m3u4me. Once it's running, open it in your browser and a short setup walks you through the rest.

> [!NOTE]
> m3u4me has been tested on macOS (Apple Silicon) and Debian, running with as little as 512MB of RAM.

**On this page:** [Which one should I pick?](#which-one-should-i-pick) · [Option 1: One-line install](#option-1-one-line-install-recommended) · [Option 2: Docker](#option-2-docker) · [Option 3: Manual, with PM2](#option-3-manual-with-pm2) · [Where your data lives](#where-your-data-lives)

## Which one should I pick?

| Your situation | Pick |
| --- | --- |
| A Linux server or Proxmox container running Debian, Ubuntu or Fedora | **[Option 1: One-line install](#option-1-one-line-install-recommended)**. By far the easiest. |
| You already use Docker | **[Option 2: Docker](#option-2-docker)** |
| A Mac, or a computer where you'd rather set everything up yourself | **[Option 3: Manual, with PM2](#option-3-manual-with-pm2)** |

Not sure? Pick Option 1.

## Option 1: One-line install (recommended)

For Linux servers running systemd that install software with `apt` or `dnf`: Debian, Ubuntu, Fedora, and Proxmox containers based on them.

```bash
curl -fsSL https://raw.githubusercontent.com/andrei-savin/m3u4me/main/install.sh | sudo bash
```

This command installs Node.js if it is missing, downloads the latest release, builds the app, and sets it up to start automatically whenever your server boots. When it is done, it prints the address where you can open m3u4me.

Next: [First steps](first-steps.md).

### Using a different port

m3u4me uses port 8080 unless you choose another one. To use a different port (replace 9090 with your desired port):

```bash
curl -fsSL https://raw.githubusercontent.com/andrei-savin/m3u4me/main/install.sh | sudo PORT=9090 bash
```

This only works on the first install. To change the port later, edit `/etc/m3u4me.env` and run `sudo m3u4me restart`.

<details>
<summary><b>What exactly does the install script change on my system?</b></summary>
<br/>

Piping a script into `sudo bash` means trusting it. [install.sh](../install.sh) is deliberately commented so you can read the whole thing first. Here is everything it changes on your system:

- Installs git and curl if they are missing.
- Installs Node.js if it is missing or too old. It comes from [NodeSource](https://github.com/nodesource/distributions), whose package repository is added to your system so Node.js keeps getting updates.
- Puts m3u4me in `/opt/m3u4me` and runs it as a locked-down `m3u4me` user, through one systemd service.
- Saves the port in `/etc/m3u4me.env` and adds the `m3u4me` command to `/usr/local/bin`.

</details>

### The `m3u4me` command

Once it is installed, you get an `m3u4me` command to look after it:

| Command | What it does |
| --- | --- |
| `sudo m3u4me update` | Update to the newest release and restart ([more about updating](updating.md)) |
| `m3u4me status` | Check whether m3u4me is running |
| `sudo m3u4me logs` | Watch the live log (Ctrl+C to stop) |
| `sudo m3u4me restart` | Restart m3u4me |
| `sudo m3u4me stop` / `sudo m3u4me start` | Stop m3u4me, or start it again |
| `m3u4me version` | Show which version is installed |
| `sudo m3u4me uninstall` | Remove m3u4me. Your playlists are kept in `/opt/m3u4me/data`. |
| `sudo m3u4me uninstall --purge` | Remove m3u4me **and permanently delete your playlists** |

## Option 2: Docker

```bash
git clone https://github.com/andrei-savin/m3u4me.git
cd m3u4me
docker compose up -d
```

m3u4me will be running at http://localhost:8080. Your playlists are stored in the `data` folder next to `docker-compose.yml`.

To use a different port, change it in `docker-compose.yml` and run the last command again.

Next: [First steps](first-steps.md).

## Option 3: Manual, with PM2

The original way to run m3u4me. Use this if you would rather set everything up yourself.

**1. Install Node.js**

m3u4me needs **Node.js 22.18 or newer**. The official website is pretty straightforward about installing it: https://nodejs.org/en/download.

After installing, make sure it worked by running `node -v` in your terminal. It should print v22.18.0 or higher.

**2. Install PM2.** This keeps your app running 24/7 in the background.
```bash
npm install -g pm2
```

**3. Clone the source via git:**
```bash
git clone https://github.com/andrei-savin/m3u4me.git
```

**4. Navigate into the folder:**
```bash
cd m3u4me
```

**5. Install the dependencies:**
```bash
npm ci
```
m3u4me runs on port 8080 by default. You can change that in `ecosystem.config.cjs`.

**6. Build the app:**
```bash
npm run build
```

**7. Start up PM2:**
```bash
pm2 start ecosystem.config.cjs
```

All done! You can now use m3u4me at http://localhost:8080 (replace `localhost` with the IP of your server, and `8080` with whatever custom port you set up earlier).

**8. Make m3u4me auto-run at startup (optional):**
```bash
pm2 startup
```
```bash
pm2 save
```

Next: [First steps](first-steps.md).

## Where your data lives

Everything m3u4me knows (playlists, sources, TV guides, settings, and the password if you set one) is in one `data` folder:

| How you installed | Data folder |
| --- | --- |
| One-line install | `/opt/m3u4me/data` |
| Docker | the `data` folder next to `docker-compose.yml` |
| PM2 | the `data` folder inside the m3u4me folder |

> [!TIP]
> You don't need to touch this folder to back up. Use **Settings → Backup** instead. See [Backup & moving to a new server](backup.md).

---

[← Help center](README.md) | 🏠 [Home](../README.md) | [Next: First steps →](first-steps.md)
