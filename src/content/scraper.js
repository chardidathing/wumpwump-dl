/**
 * DOM scraper — reads messages from Discord's rendered page.
 * Generates zero network traffic; only reads what's already in the DOM.
 */

import { sendMessage, extractIds } from '../shared/utils.js';

// Selectors derived from live Discord DOM (as of 2025)
const SEL = {
  messageList: 'ol[data-list-id="chat-messages"]',
  messageItem: 'li[id^="chat-messages-"]',
  messageArticle: 'div[role="article"]',
  username: 'span[class*="username_"]',
  timestamp: 'time[id^="message-timestamp-"]',
  content: 'div[id^="message-content-"]',
  avatar: 'img[class*="avatar_"][class*="clickable_"]',
  accessories: 'div[id^="message-accessories-"]',
  attachmentLink: 'a[class*="originalLink"]',
  sticker: '[data-type="sticker"]',
  inlineEmbed: 'div[class*="inlineMediaEmbed"]',
  reaction: 'div[class*="reaction_"]',
  replyContext: 'div[class*="repliedMessage"]',
  channelName: 'h1',
};

const DEFAULT_CONFIG = {
  scrollMode: 'auto',
  scrollDistance: [300, 700],   // px range per scroll step
  scrollDuration: [400, 900],  // ms range for smooth scroll animation
  pauseBetween: [800, 2000],   // ms range to wait between scroll steps
};

let isScrapingActive = false;
let stopRequested = false;
let scrapeConfig = { ...DEFAULT_CONFIG };
let manualObserver = null;

/**
 * Extract the @username handle from a username element.
 * Discord hides the actual handle in a span linked via aria-describedby:
 *   <span aria-describedby="id">DisplayName</span>
 *   <span id="id" class="hiddenVisually_...">username</span>
 */
function extractHandle(usernameEl) {
  if (!usernameEl) return null;
  // Check for aria-describedby on the element itself, a child, or walk up the tree
  const describedEl = usernameEl.querySelector('[aria-describedby]')
    || (usernameEl.hasAttribute('aria-describedby') ? usernameEl : null);
  if (describedEl) {
    const refId = describedEl.getAttribute('aria-describedby');
    if (refId) {
      const hiddenEl = document.getElementById(refId);
      if (hiddenEl) return hiddenEl.textContent?.trim() || null;
    }
  }
  // Fallback: look for a hiddenVisually sibling or nearby element
  // Walk up to the message header and search there
  const header = usernameEl.closest('h3, h2, [class*="header"]') || usernameEl.parentElement;
  if (header) {
    for (const el of header.querySelectorAll('[class*="hiddenVisually"]')) {
      const text = el.textContent?.trim();
      if (text && text !== usernameEl.textContent?.trim()) return text;
    }
  }
  return null;
}

/**
 * Extract user ID from a Discord avatar URL.
 * Format: https://cdn.discordapp.com/avatars/{userId}/{hash}.webp
 */
function extractUserIdFromAvatar(url) {
  if (!url) return null;
  const match = url.match(/\/avatars\/(\d+)\//);
  return match ? match[1] : null;
}

// Track the last known author for continuation messages
let lastGroupAuthor = null;
let lastGroupAvatar = null;
let lastGroupHandle = null;
let lastGroupAuthorId = null;

if (typeof browser !== 'undefined') {
  browser.runtime.onMessage.addListener(handleMessage);
} else {
  chrome.runtime.onMessage.addListener(handleMessage);
}

function handleMessage(message, _sender, sendResponse) {
  if (message.type === 'START_SCRAPE') {
    if (message.data?.config) {
      scrapeConfig = { ...DEFAULT_CONFIG, ...message.data.config };
    }
    startScrape();
    if (sendResponse) sendResponse({ started: true });
  } else if (message.type === 'STOP_SCRAPE') {
    stopRequested = true;
    stopManualObserver();
    if (sendResponse) sendResponse({ stopped: true });
  }
}

async function startScrape() {
  if (isScrapingActive) return;
  isScrapingActive = true;
  stopRequested = false;

  const channelInfo = getCurrentChannel();
  const allMessages = [];
  const seen = new Set();

  collectVisible(allMessages, seen);

  if (allMessages.length > 0) {
    sendMessage('STORE_MESSAGES', {
      channelId: channelInfo.id,
      channel: channelInfo,
      messages: allMessages,
    });
    sendMessage('SCRAPE_PROGRESS', { count: allMessages.length, channelName: channelInfo.name });
  }

  if (scrapeConfig.scrollMode === 'manual') {
    await manualScrape(channelInfo, allMessages, seen);
  } else {
    const scrollContainer = findScrollContainer();
    if (scrollContainer) {
      await scrollAndCollect(scrollContainer, channelInfo, allMessages, seen);
    }
  }

  sendMessage('SCRAPE_DONE', { count: allMessages.length });
  isScrapingActive = false;
  stopRequested = false;
}

/**
 * Manual mode: observe DOM mutations and collect new messages as the user scrolls.
 * Resolves when stopRequested becomes true.
 */
function manualScrape(channelInfo, allMessages, seen) {
  return new Promise((resolve) => {
    const target = document.querySelector(SEL.messageList);
    if (!target) { resolve(); return; }

    manualObserver = new MutationObserver(() => {
      const prevLen = allMessages.length;
      collectVisible(allMessages, seen);

      if (allMessages.length > prevLen) {
        sendMessage('STORE_MESSAGES', {
          channelId: channelInfo.id,
          channel: channelInfo,
          messages: allMessages,
        });
      }
      sendMessage('SCRAPE_PROGRESS', { count: allMessages.length, channelName: channelInfo.name });
    });

    manualObserver.observe(target, { childList: true, subtree: true });

    // Poll for stop signal
    const check = setInterval(() => {
      if (stopRequested) {
        clearInterval(check);
        stopManualObserver();
        resolve();
      }
    }, 200);
  });
}

function stopManualObserver() {
  if (manualObserver) {
    manualObserver.disconnect();
    manualObserver = null;
  }
}

/**
 * Find the scrollable container that holds the message list.
 * The ol itself doesn't scroll — its parent div does.
 */
function findScrollContainer() {
  const ol = document.querySelector(SEL.messageList);
  if (!ol) return null;
  let el = ol.parentElement;
  while (el) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  // Fallback: use the ol's parent
  return ol.parentElement;
}

/**
 * Pick a random integer in [min, max] (inclusive).
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Smoothly scroll the element up by `distance` px over `duration` ms,
 * using requestAnimationFrame for natural easing.
 */
function smoothScrollUp(el, distance, duration) {
  return new Promise((resolve) => {
    const start = el.scrollTop;
    const target = Math.max(0, start - distance);
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-in-out cubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      el.scrollTop = start + (target - start) * ease;

      if (t < 1 && !stopRequested) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

async function scrollAndCollect(scroller, channelInfo, allMessages, seen) {
  while (!stopRequested) {
    const distance = randInt(scrapeConfig.scrollDistance[0], scrapeConfig.scrollDistance[1]);
    const duration = randInt(scrapeConfig.scrollDuration[0], scrapeConfig.scrollDuration[1]);
    const pause = randInt(scrapeConfig.pauseBetween[0], scrapeConfig.pauseBetween[1]);

    // Smoothly scroll up
    await smoothScrollUp(scroller, distance, duration);

    if (stopRequested) break;

    // Wait before collecting — lets Discord render new messages
    await sleep(pause);

    if (stopRequested) break;

    const prevLen = allMessages.length;
    collectVisible(allMessages, seen);

    if (allMessages.length > prevLen) {
      sendMessage('STORE_MESSAGES', {
        channelId: channelInfo.id,
        channel: channelInfo,
        messages: allMessages,
      });
    }
    sendMessage('SCRAPE_PROGRESS', { count: allMessages.length, channelName: channelInfo.name });
  }
}

function collectVisible(allMessages, seen) {
  const items = document.querySelectorAll(SEL.messageItem);

  for (const item of items) {
    const ids = extractIds(item.id);
    if (!ids) continue;
    if (seen.has(ids.messageId)) {
      updateGroupTracking(item);
      continue;
    }

    const msg = parseMessageElement(item, ids);
    if (msg) {
      seen.add(ids.messageId);
      allMessages.push(msg);
    }
  }
}

/**
 * Query within a message item, skipping any elements inside the reply context.
 * The reply context contains its own username, avatar, and content elements
 * that would otherwise be matched first by querySelector.
 */
function querySkipReply(item, selector) {
  const replyCtx = item.querySelector(SEL.replyContext);
  for (const el of item.querySelectorAll(selector)) {
    if (!replyCtx || !replyCtx.contains(el)) return el;
  }
  return null;
}

function updateGroupTracking(item) {
  const article = item.querySelector(SEL.messageArticle);
  if (!article) return;
  const isGroupStart = article.className.includes('groupStart');
  if (isGroupStart) {
    const usernameEl = querySkipReply(item, SEL.username);
    const avatarEl = querySkipReply(item, SEL.avatar);
    if (usernameEl) {
      lastGroupAuthor = usernameEl.getAttribute('data-text') || usernameEl.textContent?.trim() || null;
    }
    lastGroupAvatar = avatarEl?.src || null;
    lastGroupHandle = extractHandle(usernameEl);
    lastGroupAuthorId = extractUserIdFromAvatar(lastGroupAvatar);
  }
}

function parseMessageElement(item, ids) {
  const article = item.querySelector(SEL.messageArticle);
  if (!article) return null;

  const isGroupStart = article.className.includes('groupStart');

  if (isGroupStart) {
    const usernameEl = querySkipReply(item, SEL.username);
    const avatarEl = querySkipReply(item, SEL.avatar);
    lastGroupAuthor = usernameEl?.getAttribute('data-text') || usernameEl?.textContent?.trim() || 'Unknown';
    lastGroupAvatar = avatarEl?.src || null;
    lastGroupHandle = extractHandle(usernameEl);
    lastGroupAuthorId = extractUserIdFromAvatar(lastGroupAvatar);
  }

  const timeEl = querySkipReply(item, SEL.timestamp);
  const contentEl = querySkipReply(item, SEL.content);

  return {
    id: ids.messageId,
    channelId: ids.channelId,
    authorId: lastGroupAuthorId || null,
    authorName: lastGroupAuthor || 'Unknown',
    authorHandle: lastGroupHandle || null,
    authorAvatar: lastGroupAvatar || null,
    content: contentEl?.textContent?.trim() || '',
    timestamp: timeEl?.dateTime || new Date().toISOString(),
    editedTimestamp: null,
    attachments: parseAttachments(item),
    embeds: parseEmbeds(item),
    reactions: parseReactions(item),
    reply: parseReply(item),
    stickers: parseStickers(item),
  };
}

function parseAttachments(el) {
  const links = el.querySelectorAll(SEL.attachmentLink);
  return Array.from(links).map((a) => {
    const href = a.getAttribute('href') || '';
    const urlPath = href.split('?')[0];
    const filename = urlPath.split('/').pop() || 'attachment';
    return { url: href, filename, contentType: null, size: null };
  });
}

function parseStickers(el) {
  const items = el.querySelectorAll(SEL.sticker);
  return Array.from(items).map((s) => ({
    id: s.getAttribute('data-id'),
    name: s.getAttribute('data-name') || 'sticker',
    formatType: s.getAttribute('data-format-type'),
    url: s.tagName === 'IMG' ? s.src : null,
  }));
}

function parseEmbeds(el) {
  const items = el.querySelectorAll(SEL.inlineEmbed);
  return Array.from(items).map((e) => {
    const link = e.querySelector('a[class*="originalLink"]');
    const video = e.querySelector('video');
    const img = e.querySelector('img[alt="Image"], img[alt="GIF"]');
    return {
      title: null,
      description: null,
      url: link?.getAttribute('href') || null,
      thumbnail: img?.src || video?.poster || null,
      video: video?.src || null,
    };
  });
}

function parseReactions(el) {
  const items = el.querySelectorAll('[class*="reaction_"][class*="reactionBtn_"], [class*="reaction "]');
  return Array.from(items).map((r) => {
    const emojiEl = r.querySelector('[data-type="emoji"]');
    const imgEl = r.querySelector('img');
    const emoji = emojiEl?.getAttribute('data-name') || imgEl?.alt || '?';
    const emojiId = emojiEl?.getAttribute('data-id') || null;
    const countText = r.textContent?.trim()?.match(/(\d+)/);
    return {
      emoji,
      emojiId,
      count: countText ? parseInt(countText[1]) : 1,
    };
  });
}

function parseReply(el) {
  const reply = el.querySelector(SEL.replyContext);
  if (!reply) return null;

  // Message ID from the reply context's content div id: "message-content-{id}"
  let messageId = null;
  const contentDiv = reply.querySelector('div[id^="message-content-"]');
  if (contentDiv) {
    const match = contentDiv.id.match(/message-content-(\d+)/);
    if (match) messageId = match[1];
  }

  const usernameEl = reply.querySelector(SEL.username);
  const authorName = usernameEl?.getAttribute('data-text')?.replace(/^@/, '')
    || usernameEl?.textContent?.trim()?.replace(/^@/, '') || null;

  const avatarEl = reply.querySelector('img[class*="replyAvatar"]');
  const authorAvatar = avatarEl?.src || null;
  const authorId = extractUserIdFromAvatar(authorAvatar);

  const content = contentDiv?.textContent?.trim() || null;

  return { messageId, authorName, authorId, content };
}

function getCurrentChannelId() {
  const match = window.location.pathname.match(/\/channels\/(?:\d+|@me)\/(\d+)/);
  return match ? match[1] : null;
}

function getCurrentChannel() {
  const channelId = getCurrentChannelId();
  const pathMatch = window.location.pathname.match(/\/channels\/((?:\d+|@me))\/(\d+)/);
  const nameEl = document.querySelector(SEL.channelName);
  const isDm = pathMatch && pathMatch[1] === '@me';
  // Use only visible text — the h1 may contain hidden spans (e.g. username in DMs)
  let displayName = 'unknown';
  if (nameEl) {
    const clone = nameEl.cloneNode(true);
    clone.querySelectorAll('[class*="hiddenVisually"]').forEach((el) => el.remove());
    displayName = clone.textContent?.trim() || 'unknown';
  }

  // Discord's document.title:
  //   DMs:     "@username" or "Display Name (@username)"
  //   Server:  "#channel | Server Name"
  const title = document.title || '';
  let username = null;
  let guildName = null;

  let userId = null;

  if (isDm) {
    // Primary: get user ID and username from the profile sidebar
    const sidebar = document.querySelector('aside[aria-labelledby^="user-profile-sidebar-heading-"]');
    if (sidebar) {
      const labelId = sidebar.getAttribute('aria-labelledby') || '';
      const idMatch = labelId.match(/user-profile-sidebar-heading-(\d+)/);
      if (idMatch) userId = idMatch[1];
      const usernameTag = sidebar.querySelector('[class*="userTagUsername"]');
      if (usernameTag) username = usernameTag.textContent?.trim() || null;
    }
    // Fallback: title and avatar URL
    if (!username) {
      const handleMatch = title.match(/@(\S+)/);
      if (handleMatch) username = handleMatch[1];
    }
    if (!userId) {
      const headerAvatar = document.querySelector('[class*="avatar_"] img[src*="cdn.discordapp.com/avatars/"]');
      if (headerAvatar) userId = extractUserIdFromAvatar(headerAvatar.src);
    }
  } else {
    const serverMatch = title.match(/\|\s*(.+)$/);
    if (serverMatch) guildName = serverMatch[1].trim();
  }

  return {
    id: channelId,
    name: displayName,
    username,
    userId,
    type: isDm ? 'dm' : 'text',
    guildId: !isDm && pathMatch ? pathMatch[1] : null,
    guildName,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
