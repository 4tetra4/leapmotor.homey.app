'use strict';

const crypto = require('crypto');
const Constants = require('./constants');
const LeapmotorException = require('./leapmotorException');

const SM4_SBOX = [
  0xD6, 0x90, 0xE9, 0xFE, 0xCC, 0xE1, 0x3D, 0xB7, 0x16, 0xB6, 0x14, 0xC2, 0x28, 0xFB, 0x2C, 0x05,
  0x2B, 0x67, 0x9A, 0x76, 0x2A, 0xBE, 0x04, 0xC3, 0xAA, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9C, 0x42, 0x50, 0xF4, 0x91, 0xEF, 0x98, 0x7A, 0x33, 0x54, 0x0B, 0x43, 0xED, 0xCF, 0xAC, 0x62,
  0xE4, 0xB3, 0x1C, 0xA9, 0xC9, 0x08, 0xE8, 0x95, 0x80, 0xDF, 0x94, 0xFA, 0x75, 0x8F, 0x3F, 0xA6,
  0x47, 0x07, 0xA7, 0xFC, 0xF3, 0x73, 0x17, 0xBA, 0x83, 0x59, 0x3C, 0x19, 0xE6, 0x85, 0x4F, 0xA8,
  0x68, 0x6B, 0x81, 0xB2, 0x71, 0x64, 0xDA, 0x8B, 0xF8, 0xEB, 0x0F, 0x4B, 0x70, 0x56, 0x9D, 0x35,
  0x1E, 0x24, 0x0E, 0x5E, 0x63, 0x58, 0xD1, 0xA2, 0x25, 0x22, 0x7C, 0x3B, 0x01, 0x21, 0x78, 0x87,
  0xD4, 0x00, 0x46, 0x57, 0x9F, 0xD3, 0x27, 0x52, 0x4C, 0x36, 0x02, 0xE7, 0xA0, 0xC4, 0xC8, 0x9E,
  0xEA, 0xBF, 0x8A, 0xD2, 0x40, 0xC7, 0x38, 0xB5, 0xA3, 0xF7, 0xF2, 0xCE, 0xF9, 0x61, 0x15, 0xA1,
  0xE0, 0xAE, 0x5D, 0xA4, 0x9B, 0x34, 0x1A, 0x55, 0xAD, 0x93, 0x32, 0x30, 0xF5, 0x8C, 0xB1, 0xE3,
  0x1D, 0xF6, 0xE2, 0x2E, 0x82, 0x66, 0xCA, 0x60, 0xC0, 0x29, 0x23, 0xAB, 0x0D, 0x53, 0x4E, 0x6F,
  0xD5, 0xDB, 0x37, 0x45, 0xDE, 0xFD, 0x8E, 0x2F, 0x03, 0xFF, 0x6A, 0x72, 0x6D, 0x6C, 0x5B, 0x51,
  0x8D, 0x1B, 0xAF, 0x92, 0xBB, 0xDD, 0xBC, 0x7F, 0x11, 0xD9, 0x5C, 0x41, 0x1F, 0x10, 0x5A, 0xD8,
  0x0A, 0xC1, 0x31, 0x88, 0xA5, 0xCD, 0x7B, 0xBD, 0x2D, 0x74, 0xD0, 0x12, 0xB8, 0xE5, 0xB4, 0xB0,
  0x89, 0x69, 0x97, 0x4A, 0x0C, 0x96, 0x77, 0x7E, 0x65, 0xB9, 0xF1, 0x09, 0xC5, 0x6E, 0xC6, 0x84,
  0x18, 0xF0, 0x7D, 0xEC, 0x3A, 0xDC, 0x4D, 0x20, 0x79, 0xEE, 0x5F, 0x3E, 0xD7, 0xCB, 0x39, 0x48,
];

const P12_SM4_ROUND_KEYS = [
  0x818FA553, 0xEBA3318D, 0x5FC3C93A, 0xBD1DADD9,
  0xBB61CAB9, 0x000FD7EA, 0xDC6E0166, 0xDA937279,
  0x607EE786, 0xB548754C, 0x107330E4, 0xEA17C186,
  0x0F56F74B, 0xB21E443C, 0xE1210FE2, 0x009995C8,
  0xE7529A48, 0x6EF474F6, 0x2AB06DF6, 0x43B11BE8,
  0x359D4A14, 0xC29E2CDE, 0x30CF6A3E, 0x79D1C806,
  0x7C502387, 0xAAAB9BC6, 0xF0FE744B, 0x1CAFC872,
  0x95A9D075, 0x88070D58, 0x22800475, 0x8391938B,
];

function rotl(value, bits) {
  const v = value >>> 0;
  return (((v << bits) | (v >>> (32 - bits))) >>> 0);
}

function sm4EncryptBlock(block) {
  let x0 = block.readUInt32BE(0);
  let x1 = block.readUInt32BE(4);
  let x2 = block.readUInt32BE(8);
  let x3 = block.readUInt32BE(12);

  for (const roundKey of P12_SM4_ROUND_KEYS) {
    const t = (x1 ^ x2 ^ x3 ^ roundKey) >>> 0;
    const b = ((SM4_SBOX[(t >>> 24) & 0xFF] << 24)
      | (SM4_SBOX[(t >>> 16) & 0xFF] << 16)
      | (SM4_SBOX[(t >>> 8) & 0xFF] << 8)
      | SM4_SBOX[t & 0xFF]) >>> 0;
    const newX = (x0 ^ b ^ rotl(b, 2) ^ rotl(b, 10) ^ rotl(b, 18) ^ rotl(b, 24)) >>> 0;
    x0 = x1; x1 = x2; x2 = x3; x3 = newX;
  }

  const out = Buffer.alloc(16);
  out.writeUInt32BE(x3 >>> 0, 0);
  out.writeUInt32BE(x2 >>> 0, 4);
  out.writeUInt32BE(x1 >>> 0, 8);
  out.writeUInt32BE(x0 >>> 0, 12);
  return out;
}

function p12MemoryEncode(data) {
  const padLen = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  const blocks = [];
  for (let offset = 0; offset < padded.length; offset += 16) {
    blocks.push(sm4EncryptBlock(padded.subarray(offset, offset + 16)));
  }
  return Buffer.concat(blocks);
}


function deriveAccountP12Password(accountId, uid) {
  const cn = crypto.createHash('md5').update(String(accountId), 'utf8').digest('hex');
  let cnEven = '';
  for (let i = 0; i < cn.length; i += 2) cnEven += cn[i];
  const uidStr = String(uid || '');
  let uidOdd = '';
  for (let i = 1; i < uidStr.length; i += 2) uidOdd += uidStr[i];
  const digest = crypto.createHash('sha256').update(Buffer.from(cn + cnEven + uidOdd, 'utf8')).digest();
  const encoded = p12MemoryEncode(digest);
  return encoded.subarray(0, 12).toString('base64').slice(0, 15);
}


function deriveOperPwdKeyIv(token) {
  const t = String(token || '');
  if (t.length < 64) {
    return { key: Constants.DEFAULT_OPERPWD_AES_KEY, iv: Constants.DEFAULT_OPERPWD_AES_IV };
  }
  const key = crypto.createHash('md5').update(t.slice(0, 32), 'utf8').digest('hex').slice(8, 24);
  const iv = crypto.createHash('md5').update(t.slice(32, 64), 'utf8').digest('hex').slice(8, 24);
  return { key, iv };
}

function encryptOperatePassword(pin, token) {
  const value = String(pin === null || pin === undefined ? '' : pin);
  if (!value) throw new LeapmotorException('Cannot encrypt an empty vehicle PIN.');
  const { key, iv } = deriveOperPwdKeyIv(token);
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  cipher.setAutoPadding(true); // PKCS#7
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
}


function deriveSignKey(ikm, salt, info) {
  if (!ikm || !salt || !info) {
    throw new LeapmotorException(
      'Missing HKDF sign material (signIkm/signSalt/signInfo). A new login is required.',
      { authError: true },
    );
  }
  if (typeof crypto.hkdfSync !== 'function') {
    throw new LeapmotorException('crypto.hkdfSync is unavailable; Node.js 15 or newer is required.');
  }
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(String(ikm), 'utf8'),
    Buffer.from(String(salt), 'utf8'),
    Buffer.from(String(info), 'utf8'),
    32,
  ));
}


function extractDeviceIdFromToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    const userName = payload && payload.user_name;
    if (typeof userName !== 'string') return null;
    const segments = userName.split(',');
    if (segments.length < 3) return null;
    const deviceId = String(segments[2] || '').trim();
    return deviceId || null;
  } catch (err) {
    return null;
  }
}

function extractTokenExpiry(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    if (!payload || typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch (err) {
    return null;
  }
}


function randomNonce() {
  return String(crypto.randomInt(100000, 10000000));
}

function timestampMs() {
  return String(Date.now());
}


function signatureInput(fields) {
  return Object.keys(fields)
    .filter((key) => fields[key] !== undefined && fields[key] !== null)
    .sort()
    .map((key) => String(fields[key]))
    .join('');
}

function hmacSign(signKey, fields) {
  if (!Buffer.isBuffer(signKey) || signKey.length === 0) {
    throw new LeapmotorException('Sign key is not available; a new login is required.', { authError: true });
  }
  return crypto.createHmac('sha256', signKey).update(signatureInput(fields), 'utf8').digest('hex');
}

function baseFields(deviceId, language, nonce, timestamp) {
  return {
    acceptLanguage: language,
    channel: Constants.DEFAULT_CHANNEL,
    deviceId,
    deviceType: Constants.DEFAULT_DEVICE_TYPE,
    nonce,
    source: Constants.DEFAULT_SOURCE,
    timestamp,
    version: Constants.DEFAULT_APP_VERSION,
  };
}

function toHeaderObject(fields, sign) {
  return {
    acceptLanguage: fields.acceptLanguage,
    channel: fields.channel,
    deviceType: fields.deviceType,
    source: fields.source,
    version: fields.version,
    nonce: fields.nonce,
    deviceId: fields.deviceId,
    timestamp: fields.timestamp,
    sign,
    'X-P12_ENC_ALG': Constants.DEFAULT_P12_ENC_ALG,
    'Content-Type': Constants.CONTENT_TYPE_FORM,
  };
}


function buildLoginHeaders(deviceId, username, password, language) {
  const nonce = randomNonce();
  const timestamp = timestampMs();
  const input = [
    language,
    Constants.DEFAULT_DEVICE_TYPE,
    deviceId,
    '1',
    username,
    '0',
    Constants.DEFAULT_CHANNEL,
    nonce,
    password,
    Constants.DEFAULT_POLICY_ID,
    Constants.DEFAULT_SOURCE,
    timestamp,
    Constants.DEFAULT_APP_VERSION,
  ].join('');
  const sign = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  return toHeaderObject(baseFields(deviceId, language, nonce, timestamp), sign);
}

function buildSignedHeaders(signKey, deviceId, language, vin, bodyParams) {
  const nonce = randomNonce();
  const timestamp = timestampMs();
  const fields = baseFields(deviceId, language, nonce, timestamp);
  if (vin) fields.vin = vin;
  if (bodyParams && typeof bodyParams === 'object') {
    Object.keys(bodyParams).forEach((key) => {
      if (bodyParams[key] !== undefined && bodyParams[key] !== null) fields[key] = bodyParams[key];
    });
  }
  return toHeaderObject(fields, hmacSign(signKey, fields));
}

function buildOperPwdVerifyHeaders(signKey, deviceId, vin, operatePassword, language) {
  return buildSignedHeaders(signKey, deviceId, language, vin, { operatePassword });
}

function buildRemoteWriteHeaders(signKey, deviceId, vin, cmdContent, cmdId, operatePassword, language) {
  const body = { cmdContent, cmdId };
  if (operatePassword) body.operatePassword = operatePassword;
  return buildSignedHeaders(signKey, deviceId, language, vin, body);
}

function buildRemoteResultHeaders(signKey, deviceId, remoteCtlId, language) {
  return buildSignedHeaders(signKey, deviceId, language, null, { remoteCtlId });
}

module.exports = {
  deriveAccountP12Password,
  deriveOperPwdKeyIv,
  encryptOperatePassword,
  deriveSignKey,
  extractDeviceIdFromToken,
  extractTokenExpiry,
  randomNonce,
  timestampMs,
  signatureInput,
  hmacSign,
  buildLoginHeaders,
  buildSignedHeaders,
  buildOperPwdVerifyHeaders,
  buildRemoteWriteHeaders,
  buildRemoteResultHeaders,
};
