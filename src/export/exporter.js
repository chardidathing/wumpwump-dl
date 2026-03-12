import { deduplicateMessages } from '../shared/utils.js';

/**
 * Build the canonical JSON export object.
 * @param {import('../shared/types.js').Channel} channel
 * @param {import('../shared/types.js').Message[]} messages
 * @returns {string} JSON string
 */
export function buildExportJson(channel, messages) {
  const sorted = deduplicateMessages(messages);
  /** @type {import('../shared/types.js').ExportData} */
  const data = {
    channel,
    messages: sorted,
    exportedAt: new Date().toISOString(),
    exporterVersion: '0.1.0',
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Build a self-contained HTML file that embeds the viewer and references the JSON.
 * The HTML file includes a file picker to load the JSON export.
 * @param {string} jsonString - The JSON export data
 * @returns {string} HTML string
 */
export function buildExportHtml(jsonString) {
  // Escape only </ sequences so the JSON doesn't break out of the script tag
  const safeJson = jsonString.replace(/<\//g, '<\\/');
  return getViewerTemplate(safeJson);
}

function getViewerTemplate(safeJson) {
  // JSON is embedded in a <script type="application/json"> tag (not executed),
  // then read via textContent — no string-literal escaping issues.
  // All user content in the renderer is sanitized via textContent assignment.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>wumpwump-dl export</title>
<link rel="preconnect" href="https://fonts.bunny.net">
<link href="https://fonts.bunny.net/css?family=almarai:300,400,700,800" rel="stylesheet">
<style>
  :root { --bg: #1e1e2e; --bg-secondary: #181825; --text: #cdd6f4; --text-muted: #a6adc8; --accent: #f5c2e7; --accent-hover: #f0a8d8; --accent-text: #11111b; --border: #45475a; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Almarai', 'Noto Sans', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.375; }
  .header { background: var(--bg-secondary); padding: 12px 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; }
  .header-left { min-width: 0; }
  .header-left h1 { font-size: 16px; font-weight: 600; }
  .header .meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .header-right { text-align: right; font-size: 12px; color: var(--text-muted); flex-shrink: 0; margin-left: 16px; }
  .header-right a { color: var(--accent); text-decoration: none; transition: color 0.15s; }
  .header-right a:hover { color: var(--accent-hover); }
  .header-right a:hover { text-decoration: underline; }
  .header-right .support-line { margin-top: 2px; }
  .messages { padding: 16px; max-width: 900px; margin: 0 auto; }
  .message { display: flex; gap: 16px; padding: 4px 0; margin-top: 16px; }
  .message.continuation { margin-top: 0; }
  .message.continuation .avatar { visibility: hidden; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); flex-shrink: 0; overflow: hidden; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  .body { min-width: 0; flex: 1; }
  .author-row { display: flex; align-items: baseline; gap: 8px; }
  .author { font-weight: 600; font-size: 15px; }
  .author-handle { font-size: 12px; color: var(--text-muted); }
  .timestamp { font-size: 12px; color: var(--text-muted); }
  .reply-context { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted); margin-bottom: 2px; border-left: 2px solid var(--border); padding-left: 8px; }
  .reply-author { font-weight: 600; color: var(--text); flex-shrink: 0; }
  .reply-content { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .message.highlight { background: rgba(245, 194, 231, 0.1); border-radius: 4px; transition: background 0.5s; }
  .content { font-size: 15px; margin-top: 2px; white-space: pre-wrap; word-wrap: break-word; }
  .attachments { margin-top: 4px; }
  .attachment { color: var(--accent); text-decoration: none; font-size: 14px; display: block; }
  .attachment:hover { text-decoration: underline; }
  .reactions { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .reaction { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 2px 8px; font-size: 13px; }
  .embed { margin-top: 4px; max-width: 400px; border-radius: 4px; overflow: hidden; }
  .embed img, .embed video { display: block; max-width: 100%; max-height: 300px; border-radius: 4px; }
  .embed-rich { border-left: 4px solid var(--accent); background: var(--bg-secondary); padding: 8px 12px; margin-top: 4px; border-radius: 0 4px 4px 0; max-width: 520px; }
  .embed-title { font-weight: 600; font-size: 14px; }
  .embed-desc { font-size: 14px; color: var(--text-muted); margin-top: 4px; }
  .media { margin-top: 4px; max-width: 400px; }
  .media img { display: block; max-width: 100%; max-height: 350px; border-radius: 4px; }
  .media video { display: block; max-width: 100%; max-height: 350px; border-radius: 4px; }
  .drop-zone { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; align-items: center; justify-content: center; font-size: 24px; color: white; }
  .drop-zone.active { display: flex; }
  .load-prompt { text-align: center; padding: 80px 20px; }
  .load-prompt p { color: var(--text-muted); margin-bottom: 16px; }
  .load-prompt button { background: var(--accent); color: var(--accent-text); border: none; padding: 10px 24px; border-radius: 4px; font-size: 14px; cursor: pointer; font-family: inherit; }
  .load-prompt button:hover { background: var(--accent-hover); }

</style>
</head>
<body>
<div class="drop-zone" id="dropZone">Drop JSON file here</div>
<div id="app"></div>
<script type="application/json" id="embedded-data">${safeJson}</script>
<script>
'use strict';
let exportData = null;
try {
  const el = document.getElementById('embedded-data');
  if (el && el.textContent.trim()) exportData = JSON.parse(el.textContent);
} catch {}

function formatTimestamp(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

function renderMessage(msg, isContinuation, msgMap) {
  const div = document.createElement('div');
  div.className = 'message' + (isContinuation ? ' continuation' : '');
  div.id = 'msg-' + msg.id;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (msg.authorAvatar) {
    const img = document.createElement('img');
    img.src = msg.authorAvatar;
    img.loading = 'lazy';
    avatar.appendChild(img);
  }
  div.appendChild(avatar);

  const body = document.createElement('div');
  body.className = 'body';

  // Reply context
  const replyRef = msg.reply || (msg.replyToId ? { messageId: msg.replyToId } : null);
  if (replyRef) {
    const replyMsg = msgMap && replyRef.messageId ? msgMap[replyRef.messageId] : null;
    const replyAuthorName = replyMsg ? replyMsg.authorName : (replyRef.authorName || 'Unknown');
    const replyContent = replyMsg ? replyMsg.content : (replyRef.content || null);

    const replyDiv = document.createElement('div');
    replyDiv.className = 'reply-context';
    if (replyMsg) {
      replyDiv.style.cursor = 'pointer';
      replyDiv.addEventListener('click', () => {
        const target = document.getElementById('msg-' + replyRef.messageId);
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('highlight'); setTimeout(() => target.classList.remove('highlight'), 1500); }
      });
    }
    const replyAuthor = document.createElement('span');
    replyAuthor.className = 'reply-author';
    replyAuthor.textContent = replyAuthorName;
    replyDiv.appendChild(replyAuthor);
    if (replyContent) {
      const replyText = document.createElement('span');
      replyText.className = 'reply-content';
      replyText.textContent = replyContent;
      replyDiv.appendChild(replyText);
    }
    body.appendChild(replyDiv);
  }

  if (!isContinuation) {
    const authorRow = document.createElement('div');
    authorRow.className = 'author-row';
    const authorSpan = document.createElement('span');
    authorSpan.className = 'author';
    authorSpan.textContent = msg.authorName;
    authorRow.appendChild(authorSpan);
    if (msg.authorHandle && msg.authorHandle !== msg.authorName) {
      const handleSpan = document.createElement('span');
      handleSpan.className = 'author-handle';
      handleSpan.textContent = msg.authorHandle;
      authorRow.appendChild(handleSpan);
    }
    const tsSpan = document.createElement('span');
    tsSpan.className = 'timestamp';
    tsSpan.textContent = formatTimestamp(msg.timestamp);
    authorRow.appendChild(tsSpan);
    body.appendChild(authorRow);
  }

  if (msg.content) {
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = msg.content;
    body.appendChild(content);
  }

  if (msg.attachments && msg.attachments.length) {
    for (const a of msg.attachments) {
      const isImage = /\\.(png|jpe?g|gif|webp|svg)($|\\?)/i.test(a.url);
      const isVideo = /\\.(mp4|webm|mov)($|\\?)/i.test(a.url);
      if (isImage) {
        const wrap = document.createElement('div');
        wrap.className = 'media';
        const img = document.createElement('img');
        img.src = a.url;
        img.alt = a.filename;
        img.loading = 'lazy';
        wrap.appendChild(img);
        body.appendChild(wrap);
      } else if (isVideo) {
        const wrap = document.createElement('div');
        wrap.className = 'media';
        const vid = document.createElement('video');
        vid.src = a.url;
        vid.controls = true;
        vid.playsInline = true;
        wrap.appendChild(vid);
        body.appendChild(wrap);
      } else {
        const attDiv = document.createElement('div');
        attDiv.className = 'attachments';
        const link = document.createElement('a');
        link.className = 'attachment';
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = a.filename;
        attDiv.appendChild(link);
        body.appendChild(attDiv);
      }
    }
  }

  if (msg.embeds && msg.embeds.length) {
    for (const e of msg.embeds) {
      if (e.video || e.thumbnail) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed';
        if (e.video) {
          const vid = document.createElement('video');
          vid.src = e.video;
          vid.loop = true;
          vid.autoplay = true;
          vid.muted = true;
          vid.playsInline = true;
          if (e.thumbnail) vid.poster = e.thumbnail;
          embedDiv.appendChild(vid);
        } else if (e.thumbnail) {
          const img = document.createElement('img');
          img.src = e.thumbnail;
          img.loading = 'lazy';
          embedDiv.appendChild(img);
        }
        body.appendChild(embedDiv);
      } else if (e.title || e.description) {
        const embedDiv = document.createElement('div');
        embedDiv.className = 'embed-rich';
        if (e.title) {
          const t = document.createElement('div');
          t.className = 'embed-title';
          t.textContent = e.title;
          embedDiv.appendChild(t);
        }
        if (e.description) {
          const d = document.createElement('div');
          d.className = 'embed-desc';
          d.textContent = e.description;
          embedDiv.appendChild(d);
        }
        body.appendChild(embedDiv);
      }
    }
  }

  if (msg.reactions && msg.reactions.length) {
    const reactDiv = document.createElement('div');
    reactDiv.className = 'reactions';
    for (const r of msg.reactions) {
      const span = document.createElement('span');
      span.className = 'reaction';
      span.textContent = r.emoji + ' ' + r.count;
      reactDiv.appendChild(span);
    }
    body.appendChild(reactDiv);
  }

  div.appendChild(body);
  return div;
}

function render(data) {
  exportData = data;
  const app = document.getElementById('app');
  app.replaceChildren();

  const header = document.createElement('div');
  header.className = 'header';

  const left = document.createElement('div');
  left.className = 'header-left';
  const h1 = document.createElement('h1');
  const ch = data.channel;
  h1.textContent = ch.guildName
    ? ch.guildName + ' / #' + ch.name
    : ch.username
      ? ch.name + ' - @' + ch.username
      : ch.name;
  left.appendChild(h1);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const idLabel = ch.type === 'dm'
    ? (ch.username ? 'User: @' + ch.username + ' \\u00b7 ' : '')
      + (ch.userId ? 'User ID: ' + ch.userId + ' \\u00b7 ' : '')
      + 'Channel: ' + ch.id
    : (ch.guildId ? 'Guild: ' + ch.guildId + ' \\u00b7 ' : '') + 'Channel: ' + ch.id;
  meta.textContent = data.messages.length + ' messages \\u00b7 ' + idLabel + ' \\u00b7 exported ' + formatTimestamp(data.exportedAt);
  left.appendChild(meta);
  header.appendChild(left);

  const right = document.createElement('div');
  right.className = 'header-right';
  right.innerHTML = 'Exported with <a href="https://github.com/chardidathing/wumpwump-dl" target="_blank" rel="noopener">wumpwump-dl</a>'
    + '<div class="support-line">'
    + '<a href="https://github.com/sponsors/chardidathing" target="_blank" rel="noopener">GitHub Sponsors</a>'
    + ' \\u00b7 <a href="https://ko-fi.com/supportchardidathing" target="_blank" rel="noopener">Ko-fi</a>'
    + ' \\u00b7 <a href="https://github.com/chardidathing/wumpwump-dl" target="_blank" rel="noopener">\\u2b50 Star on GitHub</a>'
    + '</div>';
  header.appendChild(right);

  app.appendChild(header);

  const msgMap = {};
  for (const msg of data.messages) { msgMap[msg.id] = msg; }

  const container = document.createElement('div');
  container.className = 'messages';
  let lastAuthorKey = null;
  for (const msg of data.messages) {
    const authorKey = msg.authorId || msg.authorName;
    const hasReply = !!(msg.reply || msg.replyToId);
    container.appendChild(renderMessage(msg, !hasReply && authorKey === lastAuthorKey, msgMap));
    lastAuthorKey = authorKey;
  }
  app.appendChild(container);
}

function showLoadPrompt() {
  const app = document.getElementById('app');
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'load-prompt';
  const p = document.createElement('p');
  p.textContent = 'No embedded data. Load a JSON export:';
  wrap.appendChild(p);
  const btn = document.createElement('button');
  btn.textContent = 'Choose File';
  btn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try { render(JSON.parse(ev.target.result)); } catch (err) { alert('Invalid JSON: ' + err.message); }
      };
      reader.readAsText(e.target.files[0]);
    };
    input.click();
  });
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

const dropZone = document.getElementById('dropZone');
document.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) dropZone.classList.remove('active'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('active');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try { render(JSON.parse(ev.target.result)); } catch (err) { alert('Invalid JSON: ' + err.message); }
  };
  reader.readAsText(file);
});

if (exportData) { render(exportData); } else { showLoadPrompt(); }
</script>
</body>
</html>`;
}
