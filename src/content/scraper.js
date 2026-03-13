/**
 * DOM scraper — reads messages from Discord's rendered page.
 * Generates zero network traffic; only reads what's already in the DOM.
 */

import { sendMessage, extractIds } from '../shared/utils.js';
import { transformApiMessages } from './api-transform.js';

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

// ── Interceptor bridge ──────────────────────────────────────────────────
// The MAIN world interceptor communicates via postMessage. The nonce is
// written to a DOM attribute by the interceptor so we can pair up.

const INTERCEPTOR_ATTR = 'data-__pm_session_id';
let interceptorNonce = null;
let interceptorLoaded = false;  // script injected and running
let interceptorReady = false;   // headers actually captured
const pendingReplays = new Map();

function discoverInterceptor() {
  if (interceptorLoaded) return;
  const nonce = document.documentElement.getAttribute(INTERCEPTOR_ATTR);
  if (nonce) {
    interceptorNonce = nonce;
    interceptorLoaded = true;
    document.documentElement.removeAttribute(INTERCEPTOR_ATTR);
    console.log('[ww] Interceptor loaded, nonce:', nonce);
  }
}

// Listen for interceptor messages
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  const { type, nonce, requestId } = event.data;

  if (type === 'ww_captured') {
    interceptorNonce = nonce;
    interceptorLoaded = true;
    interceptorReady = true;
    document.documentElement.removeAttribute(INTERCEPTOR_ATTR);
    console.log('[ww] Headers captured by interceptor');
  }

  if (type === 'ww_status_result' && nonce === interceptorNonce) {
    if (event.data.available) {
      interceptorReady = true;
      console.log('[ww] Interceptor confirmed headers available');
    }
  }

  if (type === 'ww_replay_result' && nonce === interceptorNonce) {
    const resolver = pendingReplays.get(requestId);
    if (resolver) {
      pendingReplays.delete(requestId);
      resolver(event.data);
    }
  }
});

/** Ask the interceptor whether it has captured headers yet. */
function probeInterceptorStatus() {
  if (!interceptorLoaded || !interceptorNonce) return;
  window.postMessage({ type: 'ww_status', nonce: interceptorNonce }, '*');
}

/**
 * Request the interceptor to fetch a URL using captured Discord headers.
 * Returns a promise that resolves with the replay result.
 */
function replayFetch(url) {
  return new Promise((resolve, reject) => {
    if (!interceptorLoaded || !interceptorNonce) {
      reject(new Error('Interceptor not loaded'));
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingReplays.delete(requestId);
      reject(new Error('Replay request timed out'));
    }, 30000);

    pendingReplays.set(requestId, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });

    window.postMessage({
      type: 'ww_replay',
      nonce: interceptorNonce,
      requestId,
      url,
    }, '*');
  });
}

/**
 * Inject the interceptor script on Firefox (MV2) where world: "MAIN"
 * is not available. On Chrome MV3, the interceptor is loaded via manifest.
 */
function injectInterceptorFirefox() {
  if (typeof browser === 'undefined') return; // Chrome — handled by manifest

  const DISGUISE_PREFIXES = [
    'passwordmanager', 'adblock', 'darkmode', 'translate',
    'accessibility', 'readability', 'privacy', 'spellcheck',
    'autofill', 'clipboardhelper', 'grammarcheck', 'vaultbridge',
    'keystorebridge', 'secureautofill', 'formprotect',
  ];
  const DISGUISE_SUFFIXES = [
    'helper', 'bridge', 'loader', 'init', 'runtime',
    'content', 'inject', 'module', 'core', 'session',
  ];
  const prefix = DISGUISE_PREFIXES[Math.floor(Math.random() * DISGUISE_PREFIXES.length)];
  const suffix = DISGUISE_SUFFIXES[Math.floor(Math.random() * DISGUISE_SUFFIXES.length)];
  const id = `${prefix}-${suffix}-${crypto.randomUUID()}`;

  const url = browser.runtime.getURL('content/interceptor.js');
  const script = document.createElement('script');
  script.id = id;
  script.src = url;
  script.dataset.version =
    '1.' + Math.floor(Math.random() * 9) + '.' + Math.floor(Math.random() * 30);
  script.dataset.loaded = String(Date.now());

  // Listen for CSP blocking the script load — fall back to wrappedJSObject
  script.onerror = () => {
    script.remove();
    injectInterceptorFirefoxFallback();
  };

  (document.head || document.documentElement).prepend(script);
}

/**
 * Fallback for Firefox when CSP blocks script injection.
 * Uses Firefox's privileged wrappedJSObject API to patch fetch in the page context.
 */
function injectInterceptorFirefoxFallback() {
  if (typeof wrappedJSObject === 'undefined' || typeof exportFunction === 'undefined') return;

  const NONCE = crypto.randomUUID();
  document.documentElement.setAttribute('data-__pm_session_id', NONCE);

  const pageWindow = window.wrappedJSObject;
  const origFetch = pageWindow.fetch;

  // Store captured headers in a page-world variable
  const stateKey = '_pm_' + NONCE.slice(0, 8);
  pageWindow[stateKey] = cloneInto({ headers: null }, pageWindow);

  pageWindow.fetch = exportFunction(async function (input, init) {
    const response = await origFetch.apply(this, arguments);

    try {
      const url = typeof input === 'string'
        ? input
        : (input instanceof Request ? input.url : String(input));

      if (url.includes('/api/v') && !pageWindow[stateKey].headers) {
        const headers = {};
        if (init && init.headers) {
          for (const [key, value] of new Headers(init.headers)) {
            headers[key] = value;
          }
        } else if (input instanceof Request) {
          for (const [key, value] of input.headers) {
            headers[key] = value;
          }
        }
        if (headers['authorization']) {
          pageWindow[stateKey].headers = cloneInto(headers, pageWindow);
          window.postMessage({
            type: 'ww_captured',
            nonce: NONCE,
            headerKeys: Object.keys(headers),
          }, '*');
        }
      }
    } catch {}

    return response;
  }, pageWindow);

  // Listen for replay commands
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.nonce !== NONCE) return;

    if (event.data.type === 'ww_replay') {
      const { requestId, url } = event.data;
      const headers = pageWindow[stateKey].headers;

      if (!headers) {
        window.postMessage({
          type: 'ww_replay_result', nonce: NONCE, requestId,
          error: 'No headers captured yet — browse Discord normally first.',
        }, '*');
        return;
      }

      try {
        const resp = await origFetch.call(pageWindow, url, {
          method: 'GET',
          headers: Object.fromEntries(
            Object.keys(headers).map((k) => [k, headers[k]])
          ),
          credentials: 'include',
        });

        if (resp.status === 429) {
          const retryAfter = resp.headers.get('retry-after');
          window.postMessage({
            type: 'ww_replay_result', nonce: NONCE, requestId,
            rateLimited: true,
            retryAfter: retryAfter ? parseFloat(retryAfter) * 1000 : 2000,
          }, '*');
          return;
        }

        if (!resp.ok) {
          window.postMessage({
            type: 'ww_replay_result', nonce: NONCE, requestId,
            error: 'HTTP ' + resp.status,
          }, '*');
          return;
        }

        const data = await resp.json();
        window.postMessage({
          type: 'ww_replay_result', nonce: NONCE, requestId,
          data: JSON.parse(JSON.stringify(data)),
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'ww_replay_result', nonce: NONCE, requestId,
          error: err.message || 'Fetch failed',
        }, '*');
      }
    }
  });
}

// Inject on Firefox at load time
injectInterceptorFirefox();
// Try to discover nonce (Chrome MAIN world script may have already run)
discoverInterceptor();

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

  // API mode skips DOM collection — it fetches everything from the REST API
  if (scrapeConfig.scrollMode !== 'api') {
    collectVisible(allMessages, seen);

    if (allMessages.length > 0) {
      sendMessage('STORE_MESSAGES', {
        channelId: channelInfo.id,
        channel: channelInfo,
        messages: allMessages,
      });
      sendMessage('SCRAPE_PROGRESS', { count: allMessages.length, channelName: channelInfo.name });
    }
  }

  if (scrapeConfig.scrollMode === 'api') {
    await apiScrape(channelInfo, allMessages, seen);
  } else if (scrapeConfig.scrollMode === 'manual') {
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

/**
 * API scrape mode: uses the network interceptor to fetch messages directly
 * from Discord's REST API with captured headers. Much faster than DOM scraping —
 * gets 100 messages per request instead of ~15 visible in the viewport.
 */
async function apiScrape(channelInfo, allMessages, seen) {
  // Step 1: Wait for the interceptor script to load
  if (!interceptorLoaded) {
    discoverInterceptor();
    console.log('[ww] Waiting for interceptor to load...');
    sendMessage('SCRAPE_PROGRESS', {
      count: 0,
      channelName: channelInfo.name,
      error: 'Waiting for interceptor to load...',
    });
    for (let i = 0; i < 30 && !interceptorLoaded; i++) {
      await sleep(200);
      discoverInterceptor();
      if (stopRequested) return;
    }
    if (!interceptorLoaded) {
      console.warn('[ww] Interceptor never loaded. Attr:', document.documentElement.getAttribute(INTERCEPTOR_ATTR));
      sendMessage('SCRAPE_PROGRESS', {
        count: 0,
        channelName: channelInfo.name,
        error: 'Interceptor failed to load — try reloading the page.',
      });
      return;
    }
  }

  // Step 2: Wait for headers to be captured (needs at least one Discord API call)
  if (!interceptorReady) {
    console.log('[ww] Interceptor loaded but no headers yet, probing...');
    sendMessage('SCRAPE_PROGRESS', {
      count: 0,
      channelName: channelInfo.name,
      error: 'Waiting for Discord to make an API call (try switching channels)...',
    });
    // Probe repeatedly — Discord makes background API calls (typing, presence, etc.)
    for (let i = 0; i < 75 && !interceptorReady; i++) {
      probeInterceptorStatus();
      await sleep(200);
      if (stopRequested) return;
    }
    if (!interceptorReady) {
      console.warn('[ww] No headers captured after 15s');
      sendMessage('SCRAPE_PROGRESS', {
        count: 0,
        channelName: channelInfo.name,
        error: 'No API headers captured — switch channels or scroll to trigger a Discord API call, then retry.',
      });
      return;
    }
  }
  console.log('[ww] Interceptor ready, starting API scrape for channel', channelInfo.id);

  const channelId = channelInfo.id;
  let beforeId = null;
  let emptyStreak = 0;

  while (!stopRequested) {
    // Build the API URL
    let url = `/api/v9/channels/${channelId}/messages?limit=100`;
    if (beforeId) url += `&before=${beforeId}`;

    console.log('[ww] Fetching:', url);
    let result;
    try {
      result = await replayFetch(url);
    } catch (err) {
      console.error('[ww] replayFetch threw:', err);
      sendMessage('SCRAPE_PROGRESS', {
        count: allMessages.length,
        channelName: channelInfo.name,
        error: err.message,
      });
      break;
    }

    if (result.error) {
      console.error('[ww] API error:', result.error);
      sendMessage('SCRAPE_PROGRESS', {
        count: allMessages.length,
        channelName: channelInfo.name,
        error: result.error,
      });
      break;
    }

    if (result.rateLimited) {
      const wait = result.retryAfter || 2000;
      console.log('[ww] Rate limited, waiting', wait, 'ms');
      await sleep(wait + randInt(500, 1500));
      continue;
    }

    if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break; // truly at the top of history
      await sleep(1000);
      continue;
    }
    emptyStreak = 0;

    console.log('[ww] Got', result.data.length, 'messages from API');

    // Transform API messages to internal format
    const transformed = transformApiMessages(result.data);
    let newCount = 0;
    for (const msg of transformed) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMessages.push(msg);
        newCount++;
      }
    }

    // Store in background — send all transformed messages; storage deduplicates via put()
    if (newCount > 0) {
      sendMessage('STORE_MESSAGES', {
        channelId: channelInfo.id,
        channel: channelInfo,
        messages: transformed,
      });
    }
    sendMessage('SCRAPE_PROGRESS', {
      count: allMessages.length,
      channelName: channelInfo.name,
    });

    // Set cursor to oldest message in this batch (API returns newest-first)
    const oldest = result.data[result.data.length - 1];
    if (oldest) {
      beforeId = oldest.id;
    }

    // Throttle: randomized delay to look natural
    const pause = randInt(
      scrapeConfig.pauseBetween[0],
      scrapeConfig.pauseBetween[1]
    );
    await sleep(pause);
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
