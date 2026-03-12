/**
 * @typedef {Object} Message
 * @property {string} id - Discord message snowflake ID
 * @property {string} channelId
 * @property {string} authorId
 * @property {string} authorName
 * @property {string} authorAvatar - URL to avatar
 * @property {string} content - Text content (may contain markdown)
 * @property {string} timestamp - ISO 8601
 * @property {string} [editedTimestamp] - ISO 8601 if edited
 * @property {Attachment[]} attachments
 * @property {Embed[]} embeds
 * @property {Reaction[]} reactions
 * @property {string} [replyToId] - ID of message being replied to
 * @property {Sticker[]} [stickers]
 */

/**
 * @typedef {Object} Sticker
 * @property {string} id
 * @property {string} name
 * @property {string} [formatType]
 * @property {string} [url]
 */

/**
 * @typedef {Object} Attachment
 * @property {string} url
 * @property {string} filename
 * @property {string} [contentType]
 * @property {number} [size]
 */

/**
 * @typedef {Object} Embed
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [url]
 * @property {string} [thumbnail]
 */

/**
 * @typedef {Object} Reaction
 * @property {string} emoji - Unicode emoji or custom emoji name
 * @property {string} [emojiId] - Custom emoji ID
 * @property {number} count
 */

/**
 * @typedef {Object} Channel
 * @property {string} id
 * @property {string} name
 * @property {string} type - 'text' | 'dm' | 'group_dm' | 'thread'
 * @property {string} [guildId]
 * @property {string} [guildName]
 */

/**
 * @typedef {Object} ExportData
 * @property {Channel} channel
 * @property {Message[]} messages
 * @property {string} exportedAt - ISO 8601
 * @property {string} exporterVersion
 */

export const MESSAGE_SOURCE = {
  DOM: 'dom',
  API: 'api',
};
