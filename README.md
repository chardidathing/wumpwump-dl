<p align="center">
  <img src="src/icons/icon.png" alt="wumpwump-dl" width="128">
</p>

# wumpwump-dl
Liberate your chats (Channels &amp; DMs) from a specific chat app, all within a lil' browser extension. :)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/daijniihikacdgbdodllhdnggemgdamm?style=flat&logo=googlechrome&label=Chrome%20Web%20Store&color=f5c2e7)](https://chromewebstore.google.com/detail/daijniihikacdgbdodllhdnggemgdamm)
[![Firefox Add-on](https://img.shields.io/amo/v/wumpwump-dl?style=flat&logo=firefox&label=Firefox%20Add-on&color=f5c2e7)](https://addons.mozilla.org/en-US/firefox/addon/wumpwump-dl/)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/chardidathing?style=flat&logo=githubsponsors&label=GitHub%20Sponsors&color=f5c2e7)](https://github.com/sponsors/chardidathing)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-f5c2e7?style=flat&logo=ko-fi)](https://ko-fi.com/supportchardidathing)

> **Disclaimer:** Use at your own risk. I am not responsible if your account gets restricted or banned. This tool is designed to be invisible to Discord, it makes zero API calls and generates no extra network traffic, however mass scrolling behaviour could still be flagged as bot-like activity. Consider using Manual scroll mode and scrolling at a natural pace if you want to be extra cautious. If you're using auto scrolling, make sure you're only exporting 1 chat at a time!

### Usage

#### Install

> The official downloads from the Chrome Web Store and Firefox Add-on marketplace are currently pending review. Manual install is the only supported method for now.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/daijniihikacdgbdodllhdnggemgdamm?style=flat&logo=googlechrome&label=Chrome%20Web%20Store&color=f5c2e7)](https://chromewebstore.google.com/detail/daijniihikacdgbdodllhdnggemgdamm)
[![Firefox Add-on](https://img.shields.io/amo/v/wumpwump-dl?style=flat&logo=firefox&label=Firefox%20Add-on&color=f5c2e7)](https://addons.mozilla.org/en-US/firefox/addon/wumpwump-dl/)

<details>
<summary>Manual install (from source / releases)</summary>

> These are unsigned and won't work on your browser unless you modify settings which **ARE NOT RECCOMENDED**.

**Chrome / Chromium browsers:**
1. Download the latest `wumpwump-dl-chrome-v*.zip` from [Releases](../../releases).
2. Unzip the file.
3. Go to `chrome://extensions`, enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.

**Firefox:**
1. Download the latest `wumpwump-dl-firefox-v*.xpi` from [Releases](../../releases).
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click `Load Temporary Add-on...` and select the XPI you downloaded earlier.
> Loading it temporally won't be required once the add-on is approved by Mozilla.

</details>

#### Scraping

1. Navigate to any Discord channel or DM.
2. Click the wumpwump-dl extension icon in your toolbar.
3. Hit **Scrape Current Channel** to start collecting messages.
4. In **Auto** scroll mode, the extension scrolls up through history automatically at a "natural" pace. In **Manual** mode, you scroll yourself and the extension captures messages as they appear.
5. Click **Stop Scraping** when you've collected enough.

Scroll speed, distance, and pause timing are all configurable under **Settings**. By default they're very conservative. You can tune this to your network/device speed, however longer scrolls/less delay could trigger rate-limiting or cause it to miss messages due to lag.

#### Exporting

Each scraped channel appears in the extension popup with a message count and three buttons:

- **JSON** — Downloads the raw message data as a `.json` file.
- **HTML** — Downloads a self-contained `.html` viewer styled like Discord, with full message rendering, avatars, embeds, reactions, and media.
- **Delete** — Removes the stored data for that channel.

If **Embed media** is enabled in Settings, the export will download all attached images, videos, and embed media from Discord's CDN and bundle everything into a `.zip` file. This is useful for archival since Discord CDN links can expire after messages are deleted.

### Support this project

Thankyou! If you'd like to support this project feel free to star the repo! If you'd like to throw a dollar or two towards more dumb stuff I'm building, check out my [Ko-Fi!](https://ko-fi.com/supportchardidathing) or [GitHub Sponsors](https://github.com/sponsors/chardidathing)!

### Thanks

Thankyou to [SVGRepo](https://svgrepo.com) for the icons, and thank **you** for checking out the project. :)