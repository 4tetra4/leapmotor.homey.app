'use strict';

const fs = require('fs');
const path = require('path');

const Constants = require('./constants');
const LeapmotorClient = require('./leapmotorClient');
const LeapmotorException = require('./leapmotorException');


const clients = new Map();
let bundledCertificates = null;

function normaliseKey(baseUrl, username) {
  return `${(baseUrl || Constants.DEFAULT_BASE_URL).replace(/\/+$/, '')}|${String(username || '').trim().toLowerCase()}`;
}

function settingsKey(key) {
  return `session:${key}`;
}

function looksLikePem(value) {
  return typeof value === 'string' && value.includes('-----BEGIN');
}

function loadBundledCertificates() {
  if (bundledCertificates) return bundledCertificates;
  const certDir = path.join(__dirname, '..', 'certs');
  const read = (file) => {
    const full = path.join(certDir, file);
    const content = fs.readFileSync(full);
    if (!content || content.length === 0) throw new Error(`${file} is empty`);
    if (!String(content).includes('-----BEGIN')) throw new Error(`${file} is not a PEM file`);
    return content;
  };

  try {
    bundledCertificates = { cert: read('app_cert.pem'), key: read('app_key.pem') };
  } catch (err) {
    throw new LeapmotorException(
      `The Leapmotor app certificate and key are not configured. Download them during pairing `
      + `(the "Certificate & key" step) so they are stored in the app settings. (${err.message})`,
    );
  }
  return bundledCertificates;
}

function resolveAppCertificates(homey) {
  if (homey && typeof homey.settings.get === 'function') {
    const cert = homey.settings.get('appCert');
    const key = homey.settings.get('appKey');
    if (looksLikePem(cert) && looksLikePem(key)) {
      return { cert: String(cert), key: String(key) };
    }
  }
  return loadBundledCertificates();
}

function acquire(homey, credentials, log) {
  const key = normaliseKey(credentials.baseUrl, credentials.username);
  const existing = clients.get(key);

  if (existing) {
    existing.refs += 1;
    existing.client.password = credentials.password;
    existing.client.language = credentials.language || Constants.DEFAULT_LANGUAGE;
    existing.client.verifySsl = credentials.verifySsl === true;
    return existing.client;
  }

  const { cert, key: privateKey } = resolveAppCertificates(homey);
  const client = new LeapmotorClient({
    username: credentials.username,
    password: credentials.password,
    operationPassword: credentials.operationPassword || null,
    language: credentials.language || Constants.DEFAULT_LANGUAGE,
    baseUrl: credentials.baseUrl || Constants.DEFAULT_BASE_URL,
    verifySsl: credentials.verifySsl === true,
    appCert: cert,
    appKey: privateKey,
    state: homey.settings.get(settingsKey(key)) || {},
    persist: async (state) => {
      try {
        await homey.settings.set(settingsKey(key), state);
      } catch (err) {
        if (typeof log === 'function') log('Unable to persist the Leapmotor session.', { error: err.message });
      }
    },
    log: typeof log === 'function' ? log : () => {},
  });

  clients.set(key, { client, refs: 1 });
  return client;
}

function release(baseUrl, username) {
  const key = normaliseKey(baseUrl, username);
  const entry = clients.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.client.destroy();
    clients.delete(key);
  }
}

function invalidate(homey, baseUrl, username) {
  const key = normaliseKey(baseUrl, username);
  const entry = clients.get(key);
  if (entry) {
    entry.client.reset();
    clients.delete(key);
  }
  try {
    homey.settings.unset(settingsKey(key));
  } catch (err) {
  }
}

function createTemporary(credentials, homey, log) {
  const { cert, key: privateKey } = resolveAppCertificates(homey);
  return new LeapmotorClient({
    username: credentials.username,
    password: credentials.password,
    operationPassword: credentials.operationPassword || null,
    language: credentials.language || Constants.DEFAULT_LANGUAGE,
    baseUrl: credentials.baseUrl || Constants.DEFAULT_BASE_URL,
    verifySsl: credentials.verifySsl === true,
    appCert: cert,
    appKey: privateKey,
    state: {},
    persist: async () => {},
    log: typeof log === 'function' ? log : () => {},
  });
}

module.exports = {
  acquire,
  release,
  invalidate,
  createTemporary,
  resolveAppCertificates,
  loadBundledCertificates,
  normaliseKey,
};
