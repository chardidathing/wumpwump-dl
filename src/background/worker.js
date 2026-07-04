import { onMessage } from '../shared/utils.js';
import {
  storeMessages,
  storeChannel,
  getMessagesByChannel,
  getMessageCount,
  getChannel,
  getAllChannels,
  clearChannel,
} from './storage.js';
import { buildExportJson, buildExportHtml } from '../export/exporter.js';

/** Broadcast a progress message to the popup. Silently ignored if popup is closed. */
function broadcastProgress(text) {
  const msg = { type: 'EXPORT_PROGRESS', data: { text } };
  try {
    if (typeof browser !== 'undefined') {
      browser.runtime.sendMessage(msg).catch(() => {});
    } else {
      chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError; // suppress "receiving end does not exist"
      });
    }
  } catch {}
}

/** Trigger a file download from the background using the downloads API. */
async function triggerDownload(blob, filename) {
  const isFirefox = typeof browser !== 'undefined';
  const api = isFirefox ? browser.downloads : chrome.downloads;

  if (isFirefox) {
    // Firefox background scripts support createObjectURL; data: URLs are blocked
    const url = URL.createObjectURL(blob);
    api.download({ url, filename, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } else {
    // Chrome MV3 service workers lack createObjectURL; use data: URL
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const mime = blob.type || 'application/octet-stream';
    const url = `data:${mime};base64,${base64}`;
    api.download({ url, filename, saveAs: true });
  }
}

/** Build a list of { url, path } for all media in messages without downloading. */
function collectMediaUrls(messages) {
  const seen = new Map();
  let counter = 0;

  for (const msg of messages) {
    if (msg.authorAvatar && !seen.has(msg.authorAvatar)) {
      const ext = guessExt(msg.authorAvatar, 'png');
      seen.set(msg.authorAvatar, `media/avatars/${++counter}.${ext}`);
    }
    if (msg.attachments) {
      for (const a of msg.attachments) {
        if (a.url && !seen.has(a.url)) {
          seen.set(a.url, `media/attachments/${++counter}_${sanitizeFilename(a.filename || 'file')}`);
        }
      }
    }
    if (msg.embeds) {
      for (const e of msg.embeds) {
        if (e.thumbnail && !seen.has(e.thumbnail)) {
          const ext = guessExt(e.thumbnail, 'png');
          seen.set(e.thumbnail, `media/embeds/${++counter}.${ext}`);
        }
        if (e.video && !seen.has(e.video)) {
          const ext = guessExt(e.video, 'mp4');
          seen.set(e.video, `media/embeds/${++counter}.${ext}`);
        }
      }
    }
  }

  return [...seen.entries()].map(([url, path]) => ({ url, path }));
}


function rewriteMediaUrls(messages, mediaMap) {
  return messages.map((msg) => {
    const updated = { ...msg };
    if (msg.authorAvatar && mediaMap.has(msg.authorAvatar)) {
      updated.authorAvatar = mediaMap.get(msg.authorAvatar);
    }
    if (msg.attachments) {
      updated.attachments = msg.attachments.map((a) => ({
        ...a,
        url: mediaMap.get(a.url) || a.url,
      }));
    }
    if (msg.embeds) {
      updated.embeds = msg.embeds.map((e) => ({
        ...e,
        thumbnail: e.thumbnail ? (mediaMap.get(e.thumbnail) || e.thumbnail) : null,
        video: e.video ? (mediaMap.get(e.video) || e.video) : null,
      }));
    }
    return updated;
  });
}

function guessExt(url, fallback) {
  const path = url.split('?')[0];
  const match = path.match(/\.(\w{2,5})$/);
  return match ? match[1].toLowerCase() : fallback;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

// Track active scraping state so the popup can restore UI on reopen
let activeScrape = null;

onMessage(async (message, _sender) => {
  const { type, data } = message;

  switch (type) {
    case 'SCRAPE_PROGRESS': {
      activeScrape = {
        tabId: _sender?.tab?.id || null,
        channelName: data.channelName,
        count: data.count,
      };
      return;
    }

    case 'SCRAPE_DONE': {
      activeScrape = null;
      return;
    }

    case 'GET_SCRAPE_STATE': {
      return { active: !!activeScrape, scrape: activeScrape };
    }

    case 'STORE_MESSAGES': {
      await storeMessages(data.messages);
      if (data.channel) {
        await storeChannel(data.channel);
      }
      const count = await getMessageCount(data.channelId);
      return { success: true, count };
    }

    case 'GET_STATUS': {
      const channels = await getAllChannels();
      const counts = {};
      for (const ch of channels) {
        counts[ch.id] = await getMessageCount(ch.id);
      }
      return { channels, counts };
    }

    case 'EXPORT_CHANNEL': {
      const channel = await getChannel(data.channelId);
      const messages = await getMessagesByChannel(data.channelId);
      if (!channel || messages.length === 0) {
        return { success: false, error: 'No messages found for this channel.' };
      }

      const channelName = sanitizeFilename(channel.name || 'export');

      broadcastProgress('Building export...');
      const json = buildExportJson(channel, messages);

      if (data.format === 'json') {
        const blob = new Blob([json], { type: 'application/json' });
        await triggerDownload(blob, `${channelName}.json`);
      } else {
        const html = buildExportHtml(json);
        const blob = new Blob([html], { type: 'text/html' });
        await triggerDownload(blob, `${channelName}.html`);
      }

      return { success: true, downloadStarted: true };
    }

    case 'EXPORT_CHANNEL_PREPARE': {
      const channel = await getChannel(data.channelId);
      const messages = await getMessagesByChannel(data.channelId);
      if (!channel || messages.length === 0) {
        return { success: false, error: 'No messages found for this channel.' };
      }

      const mediaUrls = collectMediaUrls(messages);

      return { success: true, mediaUrls };
    }

    case 'EXPORT_CHANNEL_BUILD': {
      const channel = await getChannel(data.channelId);
      const messages = await getMessagesByChannel(data.channelId);
      if (!channel || messages.length === 0) {
        return { success: false, error: 'No messages found for this channel.' };
      }

      const mediaMap = new Map((data.downloadedMediaUrls || []).map((m) => [m.url, m.path]));
      const rewritten = rewriteMediaUrls(messages, mediaMap);
      const json = buildExportJson(channel, rewritten);
      const exportContent = data.format === 'json' ? json : buildExportHtml(json);

      return { success: true, exportContent };
    }

    case 'FETCH_URL': {
      try {
        const resp = await fetch(data.url);
        if (!resp.ok) return { ok: false, status: resp.status };
        const buffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Convert to base64 in chunks to avoid call stack limits
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return { ok: true, data: btoa(binary) };
      } catch (err) {
        return { ok: false, error: err.message || 'Network error' };
      }
    }

    case 'CLEAR_CHANNEL': {
      await clearChannel(data.channelId);
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${type}` };
  }
});
