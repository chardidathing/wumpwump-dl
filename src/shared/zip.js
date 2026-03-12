/**
 * Minimal ZIP file builder for browser environments.
 * Produces a valid ZIP with STORE (no compression) — keeps it simple and fast.
 * Returns a Blob.
 */

export function createZip(files) {
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
    const crc = crc32(data);

    // Local file header
    const local = new ArrayBuffer(30 + nameBytes.length + data.length);
    const lv = new DataView(local);
    const lu = new Uint8Array(local);

    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression: STORE
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // name length
    lv.setUint16(28, 0, true);           // extra length
    lu.set(nameBytes, 30);
    lu.set(data, 30 + nameBytes.length);

    localHeaders.push(lu);

    // Central directory header
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    const cu = new Uint8Array(central);

    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, crc, true);         // crc32
    cv.setUint32(20, data.length, true); // compressed size
    cv.setUint32(24, data.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk start
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, offset, true);      // local header offset
    cu.set(nameBytes, 46);

    centralHeaders.push(cu);
    offset += lu.length;
  }

  const centralSize = centralHeaders.reduce((s, c) => s + c.length, 0);

  // End of central directory
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // central dir disk
  ev.setUint16(8, files.length, true);   // entries on disk
  ev.setUint16(10, files.length, true);  // total entries
  ev.setUint32(12, centralSize, true);   // central dir size
  ev.setUint32(16, offset, true);        // central dir offset

  return new Blob([...localHeaders, ...centralHeaders, new Uint8Array(eocd)], {
    type: 'application/zip',
  });
}

// CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
