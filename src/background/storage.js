const DB_NAME = 'wumpwump';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const CHANNELS_STORE = 'channels';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
        msgStore.createIndex('channelId', 'channelId', { unique: false });
      }
      if (!db.objectStoreNames.contains(CHANNELS_STORE)) {
        db.createObjectStore(CHANNELS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Reset cache if the browser closes the connection (common in MV3 workers)
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function storeMessages(messages) {
  const db = await openDb();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const store = tx.objectStore(MESSAGES_STORE);
  for (const msg of messages) {
    store.put(msg);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMessagesByChannel(channelId) {
  const db = await openDb();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.objectStore(MESSAGES_STORE).index('channelId');
  const req = index.getAll(channelId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMessageCount(channelId) {
  const db = await openDb();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.objectStore(MESSAGES_STORE).index('channelId');
  const req = index.count(channelId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeChannel(channel) {
  const db = await openDb();
  const tx = db.transaction(CHANNELS_STORE, 'readwrite');
  tx.objectStore(CHANNELS_STORE).put(channel);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChannel(channelId) {
  const db = await openDb();
  const tx = db.transaction(CHANNELS_STORE, 'readonly');
  const req = tx.objectStore(CHANNELS_STORE).get(channelId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllChannels() {
  const db = await openDb();
  const tx = db.transaction(CHANNELS_STORE, 'readonly');
  const req = tx.objectStore(CHANNELS_STORE).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearChannel(channelId) {
  const db = await openDb();
  const tx = db.transaction([MESSAGES_STORE, CHANNELS_STORE], 'readwrite');
  const msgStore = tx.objectStore(MESSAGES_STORE);
  const index = msgStore.index('channelId');
  const req = index.getAllKeys(channelId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      for (const key of req.result) {
        msgStore.delete(key);
      }
      tx.objectStore(CHANNELS_STORE).delete(channelId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
