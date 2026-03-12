/**
 * Extract channel and message snowflake IDs from a Discord li id attribute.
 * e.g. "chat-messages-1119069353023897712-1130474111957729341"
 *   → { channelId: "1119069353023897712", messageId: "1130474111957729341" }
 */
export function extractIds(elementId) {
  if (!elementId) return null;
  const match = elementId.match(/chat-messages-(\d+)-(\d+)/);
  return match ? { channelId: match[1], messageId: match[2] } : null;
}

/**
 * Snowflake ID → Date
 * Discord epoch: 2015-01-01T00:00:00.000Z = 1420070400000
 */
export function snowflakeToDate(snowflake) {
  const DISCORD_EPOCH = 1420070400000n;
  const ms = (BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
  return new Date(Number(ms));
}

/**
 * Send a message to the background script, abstracting browser differences.
 */
export function sendMessage(type, data) {
  const msg = { type, data };
  if (typeof browser !== 'undefined') {
    return browser.runtime.sendMessage(msg);
  }
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

/**
 * Listen for messages from content scripts or popup.
 */
export function onMessage(handler) {
  const listener = (message, sender, sendResponse) => {
    const result = handler(message, sender);
    if (result instanceof Promise) {
      result
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message || 'Unknown error' }));
      return true; // keep channel open for async
    }
    if (result !== undefined) {
      sendResponse(result);
    }
  };
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener(listener);
  } else {
    chrome.runtime.onMessage.addListener(listener);
  }
}

/**
 * Deduplicate messages by ID, preferring the most recent version.
 */
export function deduplicateMessages(messages) {
  const map = new Map();
  for (const msg of messages) {
    const existing = map.get(msg.id);
    if (!existing || (msg.editedTimestamp && !existing.editedTimestamp)) {
      map.set(msg.id, msg);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.id.length !== b.id.length) return a.id.length - b.id.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
