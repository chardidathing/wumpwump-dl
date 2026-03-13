/**
 * Network interceptor — runs in the page's MAIN world to patch fetch().
 *
 * Chrome MV3: loaded via manifest "world": "MAIN" content script.
 * Firefox MV2: injected via <script> tag from the content script.
 *
 * Captures Discord API request headers (including auth) and provides
 * a replay interface via postMessage so the content script can fetch
 * message history using the exact same headers as the real client.
 */

(function () {
  // Disguised global key — looks like a password manager session store
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

  function disguiseId() {
    const prefix = DISGUISE_PREFIXES[Math.floor(Math.random() * DISGUISE_PREFIXES.length)];
    const suffix = DISGUISE_SUFFIXES[Math.floor(Math.random() * DISGUISE_SUFFIXES.length)];
    const uuid = crypto.randomUUID();
    return `${prefix}-${suffix}-${uuid}`;
  }

  // Generate a session nonce and expose it via a disguised DOM attribute
  // so the isolated-world content script can discover it.
  const NONCE = crypto.randomUUID();
  const ATTR_NAME = '__pm_session_id'; // looks like password manager metadata
  document.documentElement.setAttribute('data-' + ATTR_NAME, NONCE);

  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  let capturedHeaders = null;

  console.log('[ww-interceptor] Patch installed at', performance.now().toFixed(1), 'ms');

  // ── Patch fetch() ──────────────────────────────────────────────────────
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);

    try {
      const url = typeof input === 'string'
        ? input
        : (input instanceof Request ? input.url : String(input));

      if (url.includes('/api/') && !capturedHeaders) {
        console.log('[ww-interceptor] Saw fetch to', url.split('?')[0]);
        const headers = {};
        if (init && init.headers) {
          // Handle Headers object, array of arrays, or plain object
          if (init.headers instanceof Headers) {
            for (const [key, value] of init.headers) headers[key] = value;
          } else if (Array.isArray(init.headers)) {
            for (const [key, value] of init.headers) headers[key.toLowerCase()] = value;
          } else {
            for (const key of Object.keys(init.headers)) headers[key.toLowerCase()] = init.headers[key];
          }
        } else if (input instanceof Request) {
          for (const [key, value] of input.headers) headers[key] = value;
        }
        if (headers['authorization']) {
          capturedHeaders = headers;
          console.log('[ww-interceptor] Captured headers from fetch:', Object.keys(headers).join(', '));
          window.postMessage({
            type: 'ww_captured',
            nonce: NONCE,
            headerKeys: Object.keys(headers),
          }, '*');
        }
      }
    } catch (err) {
      console.warn('[ww-interceptor] Error in fetch patch:', err);
    }

    return response;
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────
  // Discord may use XHR instead of (or alongside) fetch for API calls.
  XMLHttpRequest.prototype.open = function (method, url) {
    this._wwUrl = typeof url === 'string' ? url : String(url);
    this._wwHeaders = {};
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._wwHeaders) {
      this._wwHeaders[name.toLowerCase()] = value;
    }
    return originalXHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this._wwUrl && this._wwUrl.includes('/api/') && !capturedHeaders) {
      console.log('[ww-interceptor] Saw XHR to', this._wwUrl.split('?')[0]);
      if (this._wwHeaders && this._wwHeaders['authorization']) {
        capturedHeaders = this._wwHeaders;
        console.log('[ww-interceptor] Captured headers from XHR:', Object.keys(capturedHeaders).join(', '));
        window.postMessage({
          type: 'ww_captured',
          nonce: NONCE,
          headerKeys: Object.keys(capturedHeaders),
        }, '*');
      }
    }
    return originalXHRSend.apply(this, arguments);
  };

  // Listen for replay commands from the content script (isolated world)
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.nonce !== NONCE) return;

    if (event.data.type === 'ww_replay') {
      const { requestId, url } = event.data;

      if (!capturedHeaders) {
        window.postMessage({
          type: 'ww_replay_result',
          nonce: NONCE,
          requestId,
          error: 'No headers captured yet — browse Discord normally first.',
        }, '*');
        return;
      }

      try {
        const resp = await originalFetch(url, {
          method: 'GET',
          headers: capturedHeaders,
          credentials: 'include',
        });

        if (resp.status === 429) {
          const retryAfter = resp.headers.get('retry-after');
          window.postMessage({
            type: 'ww_replay_result',
            nonce: NONCE,
            requestId,
            rateLimited: true,
            retryAfter: retryAfter ? parseFloat(retryAfter) * 1000 : 2000,
          }, '*');
          return;
        }

        if (!resp.ok) {
          window.postMessage({
            type: 'ww_replay_result',
            nonce: NONCE,
            requestId,
            error: 'HTTP ' + resp.status,
          }, '*');
          return;
        }

        const data = await resp.json();
        window.postMessage({
          type: 'ww_replay_result',
          nonce: NONCE,
          requestId,
          data,
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'ww_replay_result',
          nonce: NONCE,
          requestId,
          error: err.message || 'Fetch failed',
        }, '*');
      }
    }

    if (event.data.type === 'ww_status') {
      window.postMessage({
        type: 'ww_status_result',
        nonce: NONCE,
        available: !!capturedHeaders,
      }, '*');
    }
  });

  // Tag the script element that loaded us (if any) with a disguised id
  // so it blends in with other extension scripts in the DOM.
  if (document.currentScript) {
    document.currentScript.id = disguiseId();
    document.currentScript.dataset.version =
      '1.' + Math.floor(Math.random() * 9) + '.' + Math.floor(Math.random() * 30);
    document.currentScript.dataset.loaded = String(Date.now());
  }
})();
