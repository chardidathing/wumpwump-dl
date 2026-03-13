const sendMsg = (type, data = {}) => {
  const msg = { type, data };
  if (typeof browser !== 'undefined') return browser.runtime.sendMessage(msg);
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
};

const sendTab = async (tabId, type, data = {}) => {
  const msg = { type, data };
  try {
    if (typeof browser !== 'undefined') return await browser.tabs.sendMessage(tabId, msg);
    return await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  } catch (err) {
    if (err.message && err.message.includes('Could not establish connection')) {
      showReloadPrompt();
    }
    throw err;
  }
};

const $ = (sel) => document.querySelector(sel);

let currentTabId = null;
let scrollMode = 'auto'; // 'auto' or 'manual'
let embedMedia = true;

async function init() {
  const queryTabs = typeof browser !== 'undefined' ? browser.tabs.query : chrome.tabs.query;
  const tabs = await new Promise((resolve) =>
    queryTabs({ active: true, currentWindow: true }, resolve)
  );
  const tab = tabs[0];

  if (!tab || !tab.url || !tab.url.includes('discord.com')) {
    $('#status').textContent = 'Navigate to Discord to get started.';
    return;
  }

  currentTabId = tab.id;
  $('#status').textContent = 'Connected to Discord tab.';
  $('#actions').style.display = 'flex';

  // Show hint for DM channels to open profile sidebar
  if (tab.url.includes('/channels/@me/')) {
    $('#dmHint').style.display = 'block';
  }

  await refreshStatus();
  await restoreScrapeState();
  loadSettings();

  $('#scrapeBtn').addEventListener('click', onScrape);
  $('#stopBtn').addEventListener('click', onStop);
  $('#settingsToggle').addEventListener('click', toggleSettings);
  $('#scrollModeAuto').addEventListener('click', () => setScrollMode('auto'));
  $('#scrollModeManual').addEventListener('click', () => setScrollMode('manual'));
  $('#scrollModeApi').addEventListener('click', () => setScrollMode('api'));
  $('#mediaOff').addEventListener('click', () => setMediaMode(false));
  $('#mediaOn').addEventListener('click', () => setMediaMode(true));

  for (const input of document.querySelectorAll('.settings input')) {
    input.addEventListener('change', saveSettings);
  }

  const listener = (message) => {
    if (message.type === 'SCRAPE_PROGRESS') {
      showProgress(message.data.count, message.data.channelName, message.data.error);
    } else if (message.type === 'SCRAPE_DONE') {
      hideProgress();
      refreshStatus();
    } else if (message.type === 'EXPORT_PROGRESS') {
      showExportStatus(message.data.text);
    }
  };
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener(listener);
  } else {
    chrome.runtime.onMessage.addListener(listener);
  }
}

function setScrollMode(mode) {
  scrollMode = mode;
  $('#scrollModeAuto').className = 'toggle-btn' + (mode === 'auto' ? ' active' : '');
  $('#scrollModeManual').className = 'toggle-btn' + (mode === 'manual' ? ' active' : '');
  $('#scrollModeApi').className = 'toggle-btn' + (mode === 'api' ? ' active' : '');
  $('#autoScrollSettings').style.display = (mode === 'auto' || mode === 'api') ? 'block' : 'none';
  $('#scrollOnlySettings').style.display = mode === 'auto' ? 'block' : 'none';
  $('#pauseLabel').textContent = mode === 'api'
    ? 'Delay between requests (ms)'
    : 'Pause between scrolls (ms)';
  const hints = {
    auto: 'Scrolls automatically at a natural pace.',
    manual: 'You scroll manually. Messages are captured as they appear.',
    api: 'Fetches messages directly via Discord\'s API using captured headers. Fastest method, but also the most risky.',
  };
  $('#scrollModeHint').textContent = hints[mode] || '';
  saveSettings();
}

async function setMediaMode(embed) {
  if (embed) {
    // Request broad host permission for fetching third-party embed media
    let granted;
    if (typeof browser !== 'undefined') {
      granted = await browser.permissions.request({ origins: ['<all_urls>'] });
    } else {
      granted = await new Promise((resolve) =>
        chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
      );
    }
    if (!granted) return; // user denied, stay on current mode
  }
  embedMedia = embed;
  $('#mediaOff').className = 'toggle-btn' + (!embed ? ' active' : '');
  $('#mediaOn').className = 'toggle-btn' + (embed ? ' active' : '');
  $('#mediaHint').textContent = embed
    ? 'Media files will be downloaded and bundled into a ZIP.'
    : 'Media will reference Discord CDN URLs (may expire).';
  saveSettings();
}

function toggleSettings() {
  const el = $('#settings');
  const visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  $('#settingsToggle').textContent = visible ? 'Settings' : 'Hide Settings';
}

function getConfigFromInputs() {
  return {
    scrollMode,
    scrollDistance: [
      parseInt($('#scrollDistMin').value) || 300,
      parseInt($('#scrollDistMax').value) || 700,
    ],
    scrollDuration: [
      parseInt($('#scrollDurMin').value) || 400,
      parseInt($('#scrollDurMax').value) || 900,
    ],
    pauseBetween: [
      parseInt($('#pauseMin').value) || 800,
      parseInt($('#pauseMax').value) || 2000,
    ],
  };
}

function saveSettings() {
  const config = getConfigFromInputs();
  config.embedMedia = embedMedia;
  const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
  storage.local.set({ scrapeConfig: config });
}

async function loadSettings() {
  const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;
  const result = await new Promise((resolve) => {
    if (typeof browser !== 'undefined') {
      browser.storage.local.get('scrapeConfig').then(resolve);
    } else {
      chrome.storage.local.get('scrapeConfig', resolve);
    }
  });
  if (result.scrapeConfig) {
    const c = result.scrapeConfig;
    if (c.scrollMode) setScrollMode(c.scrollMode);
    if (c.scrollDistance) {
      $('#scrollDistMin').value = c.scrollDistance[0];
      $('#scrollDistMax').value = c.scrollDistance[1];
    }
    if (c.scrollDuration) {
      $('#scrollDurMin').value = c.scrollDuration[0];
      $('#scrollDurMax').value = c.scrollDuration[1];
    }
    if (c.pauseBetween) {
      $('#pauseMin').value = c.pauseBetween[0];
      $('#pauseMax').value = c.pauseBetween[1];
    }
    if (c.embedMedia !== undefined) setMediaMode(c.embedMedia);
  }
}

async function refreshStatus() {
  const result = await sendMsg('GET_STATUS');
  const channelsDiv = $('#channels');
  channelsDiv.replaceChildren();

  if (!result.channels || result.channels.length === 0) {
    $('#status').textContent = 'No channels scraped yet.';
    return;
  }

  $('#status').textContent = result.channels.length + ' channel(s) stored.';
  for (const ch of result.channels) {
    const item = document.createElement('div');
    item.className = 'channel-item';

    const name = document.createElement('span');
    name.className = 'name';
    if (ch.type === 'dm') {
      name.textContent = ch.username
        ? ch.name + ' - @' + ch.username
        : ch.name;
    } else {
      name.textContent = ch.guildName
        ? ch.guildName + ' - #' + ch.name
        : '#' + ch.name;
    }

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = (result.counts[ch.id] || 0) + ' msgs';

    const actions = document.createElement('span');
    actions.className = 'channel-actions';

    const jsonBtn = document.createElement('button');
    jsonBtn.className = 'channel-icon-btn';
    jsonBtn.title = 'Export JSON';
    const jsonIcon = document.createElement('img');
    jsonIcon.src = 'json_dl.svg';
    jsonIcon.alt = 'JSON';
    jsonBtn.appendChild(jsonIcon);
    jsonBtn.addEventListener('click', () => exportChannel(ch.id, ch.name, 'json'));

    const htmlBtn = document.createElement('button');
    htmlBtn.className = 'channel-icon-btn';
    htmlBtn.title = 'Export HTML';
    const htmlIcon = document.createElement('img');
    htmlIcon.src = 'html_dl.svg';
    htmlIcon.alt = 'HTML';
    htmlBtn.appendChild(htmlIcon);
    htmlBtn.addEventListener('click', () => exportChannel(ch.id, ch.name, 'html'));

    const del = document.createElement('button');
    del.className = 'channel-icon-btn channel-delete';
    del.title = 'Delete channel data';
    const delIcon = document.createElement('img');
    delIcon.src = 'delete.svg';
    delIcon.alt = 'Delete';
    del.appendChild(delIcon);
    del.addEventListener('click', () => deleteChannel(ch.id));

    actions.appendChild(jsonBtn);
    actions.appendChild(htmlBtn);
    actions.appendChild(del);

    item.appendChild(name);
    item.appendChild(count);
    item.appendChild(actions);
    channelsDiv.appendChild(item);
  }
}

async function deleteChannel(channelId) {
  await sendMsg('CLEAR_CHANNEL', { channelId });
  await refreshStatus();
}

async function restoreScrapeState() {
  const state = await sendMsg('GET_SCRAPE_STATE');
  if (state?.active && state.scrape) {
    $('#scrapeBtn').style.display = 'none';
    $('#stopBtn').style.display = 'block';
    showProgress(state.scrape.count, state.scrape.channelName);
  }
}

function showReloadPrompt() {
  $('#actions').style.display = 'none';
  $('#reloadPrompt').style.display = 'block';
  $('#reloadBtn').addEventListener('click', () => {
    if (currentTabId) {
      if (typeof browser !== 'undefined') browser.tabs.reload(currentTabId);
      else chrome.tabs.reload(currentTabId);
    }
    $('#reloadPrompt').style.display = 'none';
    $('#status').textContent = 'Reloading... reopen the popup after the page loads.';
  });
}

async function onScrape() {
  if (!currentTabId) return;
  $('#scrapeBtn').style.display = 'none';
  $('#stopBtn').style.display = 'block';
  showProgress(0, '');
  const config = getConfigFromInputs();
  await sendTab(currentTabId, 'START_SCRAPE', { config });
}

async function onStop() {
  if (!currentTabId) return;
  $('#stopBtn').disabled = true;
  $('#stopBtn').textContent = 'Stopping...';
  await sendTab(currentTabId, 'STOP_SCRAPE');
}

async function exportChannel(channelId, channelName, format) {
  if (embedMedia) {
    // Open a dedicated export page in a new tab — the popup would close
    // when the file picker opens, killing the script.
    const exportUrl = (typeof browser !== 'undefined' ? browser : chrome)
      .runtime.getURL('popup/exporter.html');
    const params = new URLSearchParams({ channelId, channelName, format });
    window.open(`${exportUrl}?${params}`, '_blank');
    return;
  }

  showExportStatus('Preparing export...');
  const exportResult = await sendMsg('EXPORT_CHANNEL', { channelId, embedMedia: false, format });
  hideExportStatus();

  if (!exportResult || !exportResult.success) {
    alert(exportResult?.error || 'Export failed.');
  }
}

function showExportStatus(text) {
  $('#exportStatus').style.display = 'block';
  $('#exportStatusText').textContent = text;
}

function hideExportStatus() {
  $('#exportStatus').style.display = 'none';
}

function showProgress(count, channelName, error) {
  $('#progress').style.display = 'block';
  let text = count + ' messages' + (channelName ? ' from #' + channelName : '');
  if (error) text += ' — ' + error;
  $('#progressText').textContent = text;
}

function hideProgress() {
  $('#progress').style.display = 'none';
  $('#scrapeBtn').style.display = 'block';
  $('#stopBtn').style.display = 'none';
  $('#stopBtn').disabled = false;
  $('#stopBtn').textContent = 'Stop Scraping';
}

init();
