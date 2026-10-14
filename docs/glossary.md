🏠 [Home](../README.md) › [Help](README.md) › Glossary

# Glossary

This page explains, in plain words, the terms you'll meet in m3u4me and in IPTV apps.

**Jump to:** [Channel source](#channel-source) · [Channel sync](#channel-sync) · [EPG (TV guide)](#epg-tv-guide) · [IP address and port](#ip-address-and-port) · [IPTV player](#iptv-player) · [Local network](#local-network) · [M3U](#m3u) · [TVG ID](#tvg-id) · [User agent](#user-agent) · [XMLTV](#xmltv) · [XSPF](#xspf) · [Xtream Codes](#xtream-codes)

## Channel source

Where m3u4me gets channels from, usually your IPTV provider. It can be an [Xtream Codes](#xtream-codes) login, a link to a playlist, or a playlist file you upload. You pick channels from your sources to build your own playlists. In the app, sources live in the **Sources** tab.

## Channel sync

Keeping a channel in your playlist connected to the channel it came from in a source. When the provider changes its stream link, name, logo or TVG ID, your playlist follows along. See [Channel sync](features.md#channel-sync).

## EPG (TV guide)

Short for *Electronic Programme Guide*: the list of what's on each channel, and when. m3u4me reads guides from your providers and gives each playlist its own guide link for your TV app. In the app, guides live in the **EPG** tab.

## IP address and port

The address of a device on your network, like `192.168.1.50`, plus a number for the app on it, like `8080`. Together they make the address you open m3u4me with: `http://192.168.1.50:8080`. Your router's list of connected devices shows your server's IP address.

## IPTV player

The app you watch with, on your TV, phone or computer. TiviMate, IPTV Smarters and VLC are examples. It loads your playlist link from m3u4me. See [Use it in your TV app](tv-app.md).

## Local network

The devices connected to your home router, over Wi-Fi or cable. m3u4me and its links only work on your local network, which is what keeps your playlists private.

## M3U

The most common playlist format for IPTV: a text file listing channels, each with a name, a stream link, and often a logo, category and [TVG ID](#tvg-id). Files ending in `.m3u` or `.m3u8` are M3U playlists. Your m3u4me playlist links give your player an M3U playlist.

## TVG ID

A channel's ID in the TV guide. It's how your player knows which part of the [EPG](#epg-tv-guide) belongs to which channel. If a channel's TVG ID doesn't match one in the guide, that channel shows no programmes. See [Matching channels to the TV guide](first-steps.md#matching-channels-to-the-tv-guide).

## User agent

The name an app gives when it downloads something, like "TiviMate" or "VLC". Some providers only allow certain apps, so m3u4me lets each source choose which app it downloads as. Leave it on **App default** unless a source fails to download.

## XMLTV

The file format TV guides come in. An XMLTV link usually ends in `.xml` or `.xml.gz`. In m3u4me, you add one under **EPG → Add EPG source → EPG Link**.

## XSPF

Another playlist format, used by VLC among others. m3u4me can import it just like [M3U](#m3u).

## Xtream Codes

A login system many IPTV providers use: a **server URL**, a **username** and a **password**. With it, m3u4me can download both your provider's channels and its TV guide. Your provider gives you these details.

---

[← Troubleshooting](troubleshooting.md) | 🏠 [Help center](README.md) | [Next: About →](about.md)
