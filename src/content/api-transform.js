/**
 * Transform Discord REST API message objects into the internal format
 * used by wumpwump-dl storage and export.
 */

/**
 * Build an avatar CDN URL from a user object.
 * @param {{ id: string, avatar: string|null }} author
 * @returns {string|null}
 */
function avatarUrl(author) {
  if (!author || !author.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.webp?size=80`;
}

/**
 * Convert a sticker format_type number to the CDN file extension.
 * 1 = PNG, 2 = APNG, 3 = Lottie (JSON), 4 = GIF
 */
function stickerExt(formatType) {
  switch (formatType) {
    case 1: case 2: return 'png';
    case 3: return 'json';
    case 4: return 'gif';
    default: return 'webp';
  }
}

/**
 * Transform a single Discord API message to the internal format.
 * @param {object} msg — raw Discord API message object
 * @returns {object} — internal message format matching storage schema
 */
export function transformApiMessage(msg) {
  return {
    id: msg.id,
    channelId: msg.channel_id,
    authorId: msg.author?.id || null,
    authorName: msg.author?.global_name || msg.author?.username || 'Unknown',
    authorHandle: msg.author?.username || null,
    authorAvatar: avatarUrl(msg.author),
    content: msg.content || '',
    timestamp: msg.timestamp,
    editedTimestamp: msg.edited_timestamp || null,
    attachments: (msg.attachments || []).map((a) => ({
      url: a.url,
      filename: a.filename || 'attachment',
      contentType: a.content_type || null,
      size: a.size || null,
    })),
    embeds: (msg.embeds || []).map((e) => ({
      title: e.title || null,
      description: e.description || null,
      url: e.url || null,
      thumbnail: e.thumbnail?.url || null,
      video: e.video?.url || null,
    })),
    reactions: (msg.reactions || []).map((r) => ({
      emoji: r.emoji?.name || '?',
      emojiId: r.emoji?.id || null,
      count: r.count || 1,
    })),
    reply: msg.referenced_message
      ? {
          messageId: msg.referenced_message.id,
          authorName:
            msg.referenced_message.author?.global_name ||
            msg.referenced_message.author?.username ||
            null,
          authorId: msg.referenced_message.author?.id || null,
          content: msg.referenced_message.content || null,
        }
      : null,
    stickers: (msg.sticker_items || []).map((s) => ({
      id: s.id,
      name: s.name || 'sticker',
      formatType: String(s.format_type),
      url: `https://media.discordapp.net/stickers/${s.id}.${stickerExt(s.format_type)}`,
    })),
  };
}

/**
 * Transform an array of Discord API messages and return them sorted oldest-first.
 * @param {object[]} apiMessages
 * @returns {object[]}
 */
export function transformApiMessages(apiMessages) {
  return apiMessages
    .filter((m) => m && m.id && m.author)
    .map(transformApiMessage)
    .sort((a, b) => {
      if (a.id.length !== b.id.length) return a.id.length - b.id.length;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
