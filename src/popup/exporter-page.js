import { createZip } from '../shared/zip.js';

const sendMsg = (type, data = {}) => {
  const msg = { type, data };
  if (typeof browser !== 'undefined') return browser.runtime.sendMessage(msg);
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
};

const $ = (sel) => document.querySelector(sel);

function showStatus(text) {
  $('#exportStatus').style.display = 'block';
  $('#exportStatus').textContent = text;
}

const params = new URLSearchParams(window.location.search);
const channelId = params.get('channelId');
const channelName = params.get('channelName') || 'export';
const format = params.get('format') || 'html';

runExport();

const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50MB per part
const CONCURRENCY = 4;

async function runExport() {
  try {
    showStatus('Preparing export data...');
    const result = await prepareExport();
    if (!result) return;

    const { errors, downloadedMediaUrls } = await downloadMediaIncrementally(result.mediaUrls);
    const builtExport = await buildExport(downloadedMediaUrls);
    if (!builtExport) return;

    // Add the export file to the last (or only) ZIP
    showStatus('Building ZIP...');
    const exportFilename = format === 'json' ? 'export.json' : 'export.html';
    const encoder = new TextEncoder();
    if (errors.length > 0) {
      flushState.zipFiles.push({
        name: `${channelName}/failed-downloads.json`,
        data: encoder.encode(JSON.stringify(errors, null, 2)),
      });
    }
    flushState.zipFiles.push({
      name: `${channelName}/${exportFilename}`,
      data: encoder.encode(builtExport.exportContent),
    });

    triggerDownload(flushState.zipFiles, flushState.partNumber > 1 ? flushState.partNumber : 0);

    // Show completion
    $('#exportStatus').style.display = 'none';
    if (flushState.partNumber > 1) {
      $('#doneMessage').textContent = `Export complete! Saved as ${flushState.partNumber} parts. You can close this tab.`;
    }
    if (errors.length > 0) {
      $('#doneMessage').textContent = `Export complete with ${errors.length} failed media download${errors.length > 1 ? 's' : ''}. You can close this tab.`;
      const errorList = document.createElement('div');
      errorList.className = 'media-errors';
      const heading = document.createElement('div');
      heading.className = 'media-errors-heading';
      heading.textContent = `Failed downloads (${errors.length}):`;
      errorList.appendChild(heading);
      for (const err of errors) {
        const item = document.createElement('div');
        item.className = 'media-error-item';
        item.textContent = `${err.path}: ${err.reason}`;
        errorList.appendChild(item);
      }
      $('#doneMessage').after(errorList);
    }
    $('#doneMessage').style.display = 'block';
    $('#doneDonate').style.display = 'block';
  } catch (err) {
    showStatus('Export failed: ' + err.message);
  }
}

// Shared state for incremental flushing — accessed by workers and main flow
const flushState = {
  zipFiles: [],
  currentSize: 0,
  partNumber: 1,
};

function addFileAndFlush(name, data) {
  // If adding this file would exceed the limit, flush current ZIP first
  if (flushState.zipFiles.length > 0 && flushState.currentSize + data.length > MAX_ZIP_BYTES) {
    showStatus(`Saving part ${flushState.partNumber}...`);
    triggerDownload(flushState.zipFiles, flushState.partNumber);
    flushState.partNumber++;
    flushState.zipFiles = [];
    flushState.currentSize = 0;
  }
  flushState.zipFiles.push({ name: `${channelName}/${name}`, data });
  flushState.currentSize += data.length;
}

async function downloadMediaIncrementally(urls) {
  const errors = [];
  const downloadedMediaUrls = [];
  if (!urls || urls.length === 0) return { errors, downloadedMediaUrls };

  let completed = 0;
  const total = urls.length;
  let index = 0;

  async function worker() {
    while (index < total) {
      const i = index++;
      const { url, path } = urls[i];
      try {
        const result = await sendMsg('FETCH_URL', { url });
        if (!result || !result.ok) {
          errors.push({ url, path, reason: result?.error || `HTTP ${result?.status || '?'}` });
        } else {
          const binary = atob(result.data);
          const data = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) {
            data[j] = binary.charCodeAt(j);
          }
          addFileAndFlush(path, data);
          downloadedMediaUrls.push({ url, path });
        }
      } catch (err) {
        errors.push({ url, path, reason: err.message || 'Network error' });
      }
      completed++;
      showStatus(`Downloading media: ${completed}/${total}${errors.length > 0 ? ` (${errors.length} failed)` : ''}`);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, total); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { errors, downloadedMediaUrls };
}

function triggerDownload(files, partNumber) {
  const blob = createZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = partNumber > 0
    ? `${channelName}_part${partNumber}.zip`
    : `${channelName}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function prepareExport() {
  const result = await sendMsg('EXPORT_CHANNEL_PREPARE', { channelId, format });
  if (!result || !result.success) {
    showStatus(result?.error || 'Export failed.');
    return null;
  }
  return result;
}

async function buildExport(downloadedMediaUrls) {
  const result = await sendMsg('EXPORT_CHANNEL_BUILD', { channelId, format, downloadedMediaUrls });
  if (!result || !result.success) {
    showStatus(result?.error || 'Export failed.');
    return null;
  }
  return result;
}
