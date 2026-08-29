const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 33;

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function header(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** Encode deterministic, uncompressed ZIP entries in the supplied order. */
export function encodeZipEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("ZIP entries must be a non-empty array");
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const entry of entries) {
    if (typeof entry?.name !== "string" || entry.name.length === 0 || !(entry.bytes instanceof Uint8Array)) {
      throw new Error("ZIP entry requires a name and Uint8Array bytes");
    }
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.bytes);
    const local = header(30);
    local.view.setUint32(0, LOCAL_SIGNATURE, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, UTF8_FLAG, true);
    local.view.setUint16(10, 0, true);
    local.view.setUint16(12, DOS_DATE_1980_01_01, true);
    local.view.setUint32(14, checksum, true);
    local.view.setUint32(18, entry.bytes.byteLength, true);
    local.view.setUint32(22, entry.bytes.byteLength, true);
    local.view.setUint16(26, name.byteLength, true);
    locals.push(local.bytes, name, entry.bytes);

    const central = header(46);
    central.view.setUint32(0, CENTRAL_SIGNATURE, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, UTF8_FLAG, true);
    central.view.setUint16(12, 0, true);
    central.view.setUint16(14, DOS_DATE_1980_01_01, true);
    central.view.setUint32(16, checksum, true);
    central.view.setUint32(20, entry.bytes.byteLength, true);
    central.view.setUint32(24, entry.bytes.byteLength, true);
    central.view.setUint16(28, name.byteLength, true);
    central.view.setUint32(42, localOffset, true);
    centrals.push(central.bytes, name);
    localOffset += local.bytes.byteLength + name.byteLength + entry.bytes.byteLength;
  }
  const centralBytes = concat(centrals);
  const end = header(22);
  end.view.setUint32(0, END_SIGNATURE, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralBytes.byteLength, true);
  end.view.setUint32(16, localOffset, true);
  return concat([...locals, centralBytes, end.bytes]);
}

function requireRange(offset, length, total, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error(`ZIP ${label} is outside the archive`);
  }
}

/** Decode a strict uncompressed ZIP with explicit archive and entry limits. */
export function decodeZipEntries(bytes, {
  expectedNames,
  maxArchiveBytes = 256 * 1024 * 1024,
  maxEntryBytes = 128 * 1024 * 1024
} = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error("ZIP archive must be a Uint8Array");
  if (bytes.byteLength > maxArchiveBytes) throw new Error("ZIP archive exceeds the size limit");
  if (bytes.byteLength < 22) throw new Error("ZIP archive is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.byteLength - 22;
  if (view.getUint32(endOffset, true) !== END_SIGNATURE || view.getUint16(endOffset + 20, true) !== 0) {
    throw new Error("ZIP end record is missing or has an unsupported comment");
  }
  const count = view.getUint16(endOffset + 10, true);
  if (view.getUint16(endOffset + 8, true) !== count) throw new Error("Multi-disk ZIP archives are unsupported");
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  requireRange(centralOffset, centralSize, endOffset, "central directory");
  const entries = {};
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    requireRange(offset, 46, endOffset, "central entry");
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error("ZIP central entry signature is invalid");
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    requireRange(offset + 46, nameLength + extraLength + commentLength, endOffset, "central entry name");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (Object.hasOwn(entries, name)) throw new Error(`ZIP contains duplicate entry ${name}`);
    if (expectedNames && !expectedNames.includes(name)) throw new Error(`ZIP contains unexpected entry ${name}`);
    if (method !== 0 || compressed !== size) throw new Error(`ZIP entry ${name} must be stored without compression`);
    if (size > maxEntryBytes) throw new Error(`ZIP entry ${name} exceeds the size limit`);
    requireRange(localOffset, 30, centralOffset, `local entry ${name}`);
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`ZIP local entry ${name} is invalid`);
    if (view.getUint16(localOffset + 8, true) !== method
      || view.getUint32(localOffset + 14, true) !== checksum
      || view.getUint32(localOffset + 18, true) !== compressed
      || view.getUint32(localOffset + 22, true) !== size) {
      throw new Error(`ZIP local entry ${name} disagrees with its central entry`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    requireRange(localOffset + 30, localNameLength + localExtraLength, centralOffset, `local entry name ${name}`);
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName !== name) throw new Error(`ZIP local entry name does not match ${name}`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(dataOffset, size, centralOffset, `entry data ${name}`);
    const data = bytes.slice(dataOffset, dataOffset + size);
    if (crc32(data) !== checksum) throw new Error(`ZIP entry ${name} failed CRC-32 verification`);
    entries[name] = data;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size is inconsistent");
  for (const name of expectedNames ?? []) {
    if (!Object.hasOwn(entries, name)) throw new Error(`ZIP is missing required entry ${name}`);
  }
  return entries;
}
