'use strict';

const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const Constants = require('./constants');
const CryptoUtil = require('./crypto');
const Pkcs12 = require('./pkcs12');
const RemoteActions = require('./remoteActions');
const StatusMapper = require('./statusMapper');
const LeapmotorException = require('./leapmotorException');

const SUCCESS_CODES = new Set(['0', '00', '000', '200', '20000', 'success', 'SUCCESS', 'ok', 'OK']);
const AUTH_CODES = new Set(['401', '403', '1001', '1002', '4001', '40001', '10002', '100002', '1000002']);
const PENDING_RESULT_VALUES = new Set(['0', 'executing', 'processing', 'ing', 'pending', 'running']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseDuration(value, fallbackMs, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return Math.min(Math.max(n, min), max);
}

function pinsForHost(hostname) {
  const table = Constants.PINNED_HOSTS || {};
  const pins = table[String(hostname).toLowerCase()];
  return Array.isArray(pins) && pins.length > 0 ? pins : null;
}

function spkiFingerprint(der) {
  const certificate = new crypto.X509Certificate(der);
  return crypto
    .createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
}

function verifyPinnedSocket(socket, hostname, pins) {
  const peer = socket.getPeerCertificate(true);
  if (!peer || !peer.raw) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: the server did not present a certificate.`,
    );
  }

  const identityError = tls.checkServerIdentity(hostname, peer);
  if (identityError) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: ${identityError.message}`,
    );
  }

  const now = Date.now();
  const notBefore = Date.parse(peer.valid_from);
  const notAfter = Date.parse(peer.valid_to);
  if (Number.isFinite(notBefore) && now < notBefore) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: the server certificate is not valid until ${peer.valid_from}.`,
    );
  }
  if (Number.isFinite(notAfter) && now > notAfter) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: the server certificate expired on ${peer.valid_to}.`,
    );
  }

  let fingerprint;
  try {
    fingerprint = spkiFingerprint(peer.raw);
  } catch (err) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: the server certificate could not be parsed (${err.message}).`,
    );
  }

  if (!pins.includes(fingerprint)) {
    return new LeapmotorException(
      `TLS verification failed for ${hostname}: the server public key does not match any pinned key `
      + `(received ${fingerprint}). The connection was refused before any data was sent.`,
    );
  }

  return null;
}

class LeapmotorClient {
  constructor(options) {
    this.username = String(options.username || '').trim();
    this.password = String(options.password || '');
    this.operationPassword = options.operationPassword ? String(options.operationPassword) : null;
    this.language = options.language || Constants.DEFAULT_LANGUAGE;
    this.baseUrl = (options.baseUrl || Constants.DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = Number(options.timeout) > 0 ? Number(options.timeout) : Constants.DEFAULT_TIMEOUT_MS;
    this.verifySsl = options.verifySsl === true;
    this.appCert = options.appCert || null;
    this.appKey = options.appKey || null;
    this.state = Object.assign({}, options.state || {});
    this.persistCb = typeof options.persist === 'function' ? options.persist : async () => {};
    this.logFn = typeof options.log === 'function' ? options.log : () => {};
    this._signKeyCache = null;
    this._signKeySource = null;
    this._authPromise = null;
    this._vehicleCache = null;
    this._vehicleCacheAt = 0;
    this._agents = new Map();
  }

  log(message, meta) {
    try {
      this.logFn(message, meta);
    } catch (err) {
    }
  }

  async persist() {
    this.state.updatedAt = Date.now();
    try {
      await this.persistCb(this.state);
    } catch (err) {
      this.log('Failed to persist client state.', { error: err.message });
    }
  }

  reset() {
    const deviceId = this.state.deviceId;
    this.state = { deviceId };
    this._signKeyCache = null;
    this._signKeySource = null;
    this._vehicleCache = null;
    this._vehicleCacheAt = 0;
    this.destroy();
  }

  destroy() {
    this._agents.forEach((agent) => {
      try {
        agent.destroy();
      } catch (err) {
      }
    });
    this._agents.clear();
  }

  deviceId() {
    return this.state.deviceId || null;
  }

  userId() {
    return this.state.userId || null;
  }

  signKey() {
    const source = `${this.state.signIkm}|${this.state.signSalt}|${this.state.signInfo}`;
    if (!this._signKeyCache || this._signKeySource !== source) {
      this._signKeyCache = CryptoUtil.deriveSignKey(this.state.signIkm, this.state.signSalt, this.state.signInfo);
      this._signKeySource = source;
    }
    return this._signKeyCache;
  }

  authHeaders() {
    const headers = {};
    if (this.state.token) headers.token = this.state.token;
    if (this.state.userId) headers.userId = String(this.state.userId);
    return headers;
  }

  assertStaticCertificatesExist() {
    if (!this.appCert || !this.appKey) {
      throw new LeapmotorException(
        'The Leapmotor app certificate (certs/app_cert.pem) and/or private key (certs/app_key.pem) are missing.',
      );
    }
  }

  appCertOptions() {
    this.assertStaticCertificatesExist();
    return { id: 'app', cert: this.appCert, key: this.appKey };
  }

  setAppCertificate(cert, key) {
    if (typeof cert === 'string' && cert.includes('-----BEGIN')) this.appCert = cert;
    if (typeof key === 'string' && key.includes('-----BEGIN')) this.appKey = key;
    this.destroy();
  }

  accountCertOptions() {
    if (this.state.accountCertPem && this.state.accountKeyPem) {
      return {
        id: `account:${this.state.certFingerprint || this.state.userId || 'x'}`,
        cert: this.state.accountCertPem,
        key: this.state.accountKeyPem,
      };
    }
    if (this.state.accountP12 && this.state.accountP12Password) {
      return {
        id: `p12:${this.state.userId || 'x'}`,
        pfx: Buffer.from(this.state.accountP12, 'base64'),
        passphrase: this.state.accountP12Password,
      };
    }
    throw new LeapmotorException('No account certificate available; a new login is required.', { authError: true });
  }

  async getVehicleList(force = false) {
    if (!force && this._vehicleCache && (Date.now() - this._vehicleCacheAt) < Constants.VEHICLE_LIST_CACHE_MS) {
      return this._vehicleCache;
    }

    await this.ensureToken();

    const vehicles = await this.retryOnTokenExpiry(async () => {
      const headers = Object.assign(
        CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language),
        this.authHeaders(),
      );
      const response = await this.post(Constants.ENDPOINT_VEHICLE_LIST, headers, '', this.accountCertOptions());
      const body = this.parseApiBody(response, 'vehicle list');
      return LeapmotorClient.extractVehicles(body);
    });

    this._vehicleCache = vehicles;
    this._vehicleCacheAt = Date.now();
    return vehicles;
  }

  static extractVehicles(body) {
    const data = (body && body.data) || {};
    if (Array.isArray(data)) return data;
    const groups = ['bindcars', 'bindCars', 'sharedcars', 'sharedCars', 'list', 'vehicles'];
    const vehicles = [];
    groups.forEach((key) => {
      if (Array.isArray(data[key])) vehicles.push(...data[key]);
    });
    return vehicles;
  }

  async findVehicleByVin(vin) {
    const wanted = String(vin || '').trim().toUpperCase();
    if (!wanted) throw new LeapmotorException('No VIN configured for this vehicle.');
    let vehicles = await this.getVehicleList();
    let match = vehicles.find((v) => String(v.vin || '').toUpperCase() === wanted);
    if (!match) {
      vehicles = await this.getVehicleList(true);
      match = vehicles.find((v) => String(v.vin || '').toUpperCase() === wanted);
    }
    if (!match) {
      throw new LeapmotorException(
        `VIN ${wanted} is not present on this Leapmotor account (found: ${vehicles.map((v) => v.vin).join(', ') || 'none'}).`,
      );
    }
    return match;
  }

  async getVehicleDetail(vin, carType, force = true) {
    const wanted = String(vin || '').trim().toUpperCase();
    if (!wanted) throw new LeapmotorException('No VIN configured for this vehicle.');
    if (force === true) {
      try {
        await this.getVehicleList(true);
      } catch (err) {
        this.log('Vehicle list refresh failed, falling back to the cached list.', { error: err.message });
      }
    }
    const vehicle = await this.findVehicleByVin(wanted);
    const detail = Object.assign({}, vehicle);
    if (!detail.vin) detail.vin = wanted;
    if (!detail.carType && carType) detail.carType = String(carType).trim().toLowerCase();
    if (!detail.userId && this.state.userId) detail.userId = this.state.userId;
    return detail;
  }

  vehicleStatusPath(carType) {
    const segment = String(carType || '').trim().toLowerCase();
    if (!segment) return Constants.DEFAULT_VEHICLE_STATUS_SEGMENT;
    return Constants.vehicleStatusPath(segment);
  }

  async getRawVehicleStatus(vin, carType) {
    await this.ensureToken();

    let type = carType;
    if (!type) {
      const vehicle = await this.findVehicleByVin(vin);
      type = vehicle.carType || Constants.DEFAULT_VEHICLE_STATUS_SEGMENT;
    }

    const resolved = this.vehicleStatusPath(type);
    const candidates = this._statusCandidates(vin, resolved);
    let lastNotFound = null;

    for (const segment of candidates) {
      try {
        const body = await this._postVehicleStatus(vin, segment);
        this._rememberStatusSegment(vin, segment);
        return body;
      } catch (err) {
        const notFound = err instanceof LeapmotorException
          && (err.httpStatus === 404 || String(err.code) === '404');
        if (!notFound) throw err;
        lastNotFound = err;
        this.log('Vehicle status endpoint answered 404 - retrying the shared C10 status endpoint.', {
          vin,
          segment,
        });
      }
    }

    throw lastNotFound || new LeapmotorException(
      'Leapmotor API error during "vehicle status" (HTTP 404, code 404): No message available',
      { httpStatus: 404, code: '404' },
    );
  }

  _statusCandidates(vin, resolved) {
    const stored = this.state.statusSegments && this.state.statusSegments[vin];
    const candidates = [];
    [stored, resolved, Constants.DEFAULT_VEHICLE_STATUS_SEGMENT].forEach((segment) => {
      if (segment && candidates.indexOf(segment) === -1) candidates.push(segment);
    });
    return candidates;
  }

  _rememberStatusSegment(vin, segment) {
    if (!this.state.statusSegments) this.state.statusSegments = {};
    if (this.state.statusSegments[vin] === segment) return;
    this.state.statusSegments[vin] = segment;
    this.persist().catch(() => {});
  }

  async _postVehicleStatus(vin, segment) {
    const headers = Object.assign(
      CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language, vin),
      this.authHeaders(),
    );
    const body = new URLSearchParams({ vin }).toString();
    const response = await this.post(
      Constants.ENDPOINT_VEHICLE_STATUS + segment,
      headers,
      body,
      this.accountCertOptions(),
    );
    return this.parseApiBody(response, 'vehicle status');
  }

  async getVehicleStatus(vin, carType) {
    const raw = await this.getRawVehicleStatus(vin, carType);
    const data = (raw && typeof raw.data === 'object' && raw.data) || {};
    return StatusMapper.map(data);
  }

  static firstPlanValue(plan, keys) {
    const source = plan && typeof plan === 'object' ? plan : {};
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }
    return undefined;
  }

  async getChargePlan(vin, carType) {
    const raw = await this.getRawVehicleStatus(vin, carType);
    const data = (raw && typeof raw.data === 'object' && raw.data) || {};
    const config = (data.config && typeof data.config === 'object') ? data.config : {};
    const plan = Object.assign({}, config['3']);
    if (data.chargesocSetting !== undefined && LeapmotorClient.firstPlanValue(plan, ['chargesoc', 'percent']) === undefined) {
      plan.percent = data.chargesocSetting;
    }
    if (data.chargeTimeSetting !== undefined && LeapmotorClient.firstPlanValue(plan, ['starttime', 'beginTime']) === undefined) {
      plan.beginTime = data.chargeTimeSetting;
    }
    if (data.chargeScheduleEnabled !== undefined && LeapmotorClient.firstPlanValue(plan, ['chargeEnable', 'isEnable']) === undefined) {
      plan.isEnable = data.chargeScheduleEnabled;
    }
    const normalized = {
      chargeEnable: LeapmotorClient.firstPlanValue(plan, ['chargeEnable', 'isEnable']),
      chargesoc: LeapmotorClient.firstPlanValue(plan, ['chargesoc', 'percent']),
      circulation: LeapmotorClient.firstPlanValue(plan, ['circulation']),
      cycles: LeapmotorClient.firstPlanValue(plan, ['cycles']),
      endtime: LeapmotorClient.firstPlanValue(plan, ['endtime', 'endTime']),
      recharge: LeapmotorClient.firstPlanValue(plan, ['recharge']),
      starttime: LeapmotorClient.firstPlanValue(plan, ['starttime', 'beginTime'])
    };
    Object.keys(normalized).forEach((key) => {
      if (normalized[key] === undefined || normalized[key] === null || normalized[key] === '') {
        delete normalized[key];
      }
    });
    return normalized;
  }

  async getUnreadMessageCount() {
    await this.ensureToken();
    return this.retryOnTokenExpiry(async () => {
      const headers = Object.assign(
        CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language),
        this.authHeaders(),
      );
      const response = await this.post(Constants.ENDPOINT_MESSAGE_UNREAD, headers, '', this.accountCertOptions());
      return this.parseApiBody(response, 'unread message count');
    });
  }

  async executeCommand(vin, command, params, carType) {
    let commandParams = params || {};
    if (command === 'start_charging' || command === 'stop_charging') {
      try {
        const plan = await this.getChargePlan(vin, carType);
        commandParams = Object.assign({}, commandParams, { plan });
      } catch (err) {
        this.log('Could not read the current charge plan, using defaults.', { error: err.message });
      }
    }
    const spec = RemoteActions.getSpec(command, commandParams);
    return this.remoteControl(vin, command, spec.cmdId, spec.cmdContent, spec.requiresPin);
  }

  async executeRawCommand(vin, cmdId, cmdContent, requiresPin) {
    const id = String(cmdId || '').trim();
    if (!/^\d+$/.test(id)) throw new LeapmotorException(`Invalid raw cmdId "${cmdId}".`);
    let content = cmdContent;
    if (content === undefined || content === null || content === '') content = '{}';
    if (typeof content !== 'string') content = JSON.stringify(content);
    try {
      JSON.parse(content);
    } catch (err) {
      throw new LeapmotorException(`Raw cmdContent is not valid JSON: ${content}`);
    }
    return this.remoteControl(vin, 'raw_command', id, content, requiresPin !== false);
  }

  hasSession() {
    return Boolean(
      this.state.token && this.state.signIkm && this.state.signSalt && this.state.signInfo
      && this.state.deviceId && (this.state.accountCertPem || this.state.accountP12),
    );
  }

  tokenLooksExpired() {
    const expiry = this.state.tokenExpiresAt || CryptoUtil.extractTokenExpiry(this.state.token);
    if (!expiry) return false;
    return Date.now() > (expiry - 60000);
  }

  async ensureToken() {
    if (this.hasSession() && !this.tokenLooksExpired()) return;
    if (this._authPromise) return this._authPromise;

    this._authPromise = (async () => {
      if (this.hasSession() && this.tokenLooksExpired() && this.state.refreshToken) {
        try {
          await this.refreshToken();
          return;
        } catch (err) {
          this.log('Token refresh failed, falling back to a full login.', { error: err.message });
        }
      }
      await this.login();
    })().finally(() => {
      this._authPromise = null;
    });

    return this._authPromise;
  }

  async login() {
    this.assertStaticCertificatesExist();
    if (!this.username || !this.password) {
      throw new LeapmotorException('Leapmotor username and/or password are not configured.', { authError: true });
    }

    if (!this.state.deviceId) {
      this.state.deviceId = require('crypto').randomBytes(16).toString('hex');
    }
    const deviceId = this.deviceId();
    this.log('Starting Leapmotor login.', { deviceId });

    const headers = CryptoUtil.buildLoginHeaders(deviceId, this.username, this.password, this.language);
    const body = new URLSearchParams({
      isRecoverAcct: '0',
      password: this.password,
      policyId: Constants.DEFAULT_POLICY_ID,
      loginMethod: '1',
      email: this.username,
    }).toString();

    const response = await this.post(Constants.ENDPOINT_LOGIN, headers, body, this.appCertOptions());
    const parsed = this.parseApiBody(response, 'login');
    const data = parsed.data;
    if (!data || typeof data !== 'object') {
      throw new LeapmotorException('Login response did not contain a data object.', { authError: true });
    }

    this.state.userId = String(data.id || '');
    this.state.token = String(data.token || '');
    this.state.refreshToken = String(data.refreshToken || '');
    this.state.signIkm = String(data.signIkm || '');
    this.state.signSalt = String(data.signSalt || '');
    this.state.signInfo = String(data.signInfo || '');
    this.state.tokenExpiresAt = CryptoUtil.extractTokenExpiry(this.state.token);
    this.state.remoteCertSynced = false;
    this._signKeyCache = null;

    const jwtDeviceId = CryptoUtil.extractDeviceIdFromToken(this.state.token);
    if (jwtDeviceId) {
      if (jwtDeviceId !== this.state.deviceId) {
        this.log('Adopting the deviceId advertised by the gateway.', { deviceId: jwtDeviceId });
      }
      this.state.deviceId = jwtDeviceId;
    }

    this.installAccountCertificate(data);
    this._vehicleCache = null;
    this._vehicleCacheAt = 0;
    this.destroy();
    await this.persist();
    this.log('Leapmotor login succeeded.', { userId: this.state.userId });
  }

  installAccountCertificate(loginData) {
    const base64Cert = loginData.base64Cert || loginData.p12 || loginData.cert;
    const password = CryptoUtil.deriveAccountP12Password(loginData.id, loginData.uid);
    this.state.accountP12 = base64Cert ? String(base64Cert).replace(/\s+/g, '') : null;
    this.state.accountP12Password = password;
    this.state.accountCertPem = null;
    this.state.accountKeyPem = null;

    if (!this.state.accountP12) {
      throw new LeapmotorException(
        'Login response did not contain the account certificate (base64Cert).',
        { authError: true },
      );
    }

    if (Pkcs12.available) {
      try {
        const pem = Pkcs12.p12ToPem(this.state.accountP12, password);
        this.state.accountCertPem = pem.cert;
        this.state.accountKeyPem = pem.key;
        this.state.certFingerprint = require('crypto')
          .createHash('sha1')
          .update(pem.cert)
          .digest('hex')
          .slice(0, 12);
      } catch (err) {
        this.log('PKCS#12 -> PEM conversion failed, falling back to the native pfx loader.', {
          error: err.message,
        });
      }
    }
  }

  async refreshToken() {
    if (!this.state.refreshToken) {
      throw new LeapmotorException('No refresh token available.', { authError: true });
    }

    this.log('Refreshing Leapmotor token.');
    const bodyParams = { refreshToken: this.state.refreshToken };
    const headers = Object.assign(
      CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language, null, bodyParams),
      this.authHeaders(),
    );
    const body = new URLSearchParams(bodyParams).toString();
    const response = await this.post(Constants.ENDPOINT_TOKEN_REFRESH, headers, body, this.accountCertOptions());
    const parsed = this.parseApiBody(response, 'token refresh');
    const data = parsed.data;
    if (!data || typeof data !== 'object' || !data.token) {
      throw new LeapmotorException('Token refresh response did not contain a new token.', { authError: true });
    }

    this.state.token = String(data.token);
    if (data.refreshToken) this.state.refreshToken = String(data.refreshToken);
    this.state.tokenExpiresAt = CryptoUtil.extractTokenExpiry(this.state.token);
    const jwtDeviceId = CryptoUtil.extractDeviceIdFromToken(this.state.token);
    if (jwtDeviceId) this.state.deviceId = jwtDeviceId;
    await this.persist();
  }

  async retryOnTokenExpiry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LeapmotorException) || !err.authError) throw err;
      this.log('Authenticated call rejected, renewing the session.', { error: err.message });
      if (this._authPromise) {
        await this._authPromise;
      } else {
        this._authPromise = (async () => {
          if (this.state.refreshToken) {
            try {
              await this.refreshToken();
              return;
            } catch (refreshErr) {
              this.log('Refresh failed, performing a full login.', { error: refreshErr.message });
            }
          }
          await this.login();
        })().finally(() => {
          this._authPromise = null;
        });
        await this._authPromise;
      }
      return fn();
    }
  }

  async remoteControl(vin, label, cmdId, cmdContent, requiresPin) {
    await this.ensureToken();
    const vehicle = await this.findVehicleByVin(vin);
    RemoteActions.warnIfMissingRight(cmdId, vehicle, (msg) => this.log(msg));
    this.log('Sending remote command.', { label, vin, cmdId, cmdContent });

    return this.retryOnTokenExpiry(async () => {
      let operatePassword = null;
      if (requiresPin) {
        if (!this.operationPassword) {
          throw new LeapmotorException(
            'No vehicle PIN configured. Remote commands require the PIN you use in the Leapmotor app.',
          );
        }
        operatePassword = CryptoUtil.encryptOperatePassword(this.operationPassword, this.state.token);
        await this.syncRemoteCertificate();
        await this.verifyOperationPassword(vin, operatePassword);
      }

      const headers = Object.assign(
        CryptoUtil.buildRemoteWriteHeaders(
          this.signKey(),
          this.deviceId(),
          vin,
          cmdContent,
          cmdId,
          operatePassword,
          this.language,
        ),
        this.authHeaders(),
      );

      const bodyObj = { cmdContent, vin, cmdId };
      if (operatePassword) bodyObj.operatePassword = operatePassword;
      const body = new URLSearchParams(bodyObj).toString();

      const response = await this.post(Constants.ENDPOINT_REMOTE_CTL, headers, body, this.accountCertOptions());
      const result = this.parseApiBody(response, `remote ${label}`);
      const data = (result && typeof result.data === 'object' && result.data) || {};

      if (data.remoteCtlId) {
        result.pollResult = await this.pollRemoteResult(
          String(data.remoteCtlId),
          normaliseDuration(data.queryRemoteCtlResultTimeout, Constants.DEFAULT_REMOTE_POLL_TIMEOUT_MS, {
            min: 5000,
            max: 120000,
          }),
          normaliseDuration(data.queryInterval, Constants.DEFAULT_REMOTE_POLL_INTERVAL_MS, {
            min: 1000,
            max: 10000,
          }),
        );
      }
      return result;
    });
  }

  async verifyOperationPassword(vin, operatePassword) {
    this.log('Verifying the vehicle PIN.');
    const headers = Object.assign(
      CryptoUtil.buildOperPwdVerifyHeaders(this.signKey(), this.deviceId(), vin, operatePassword, this.language),
      this.authHeaders(),
    );
    const body = new URLSearchParams({ operatePassword, vin }).toString();
    const response = await this.post(Constants.ENDPOINT_OPERPWD_VERIFY, headers, body, this.accountCertOptions());
    this.parseApiBody(response, 'PIN verification');
  }

  async syncRemoteCertificate() {
    if (this.state.remoteCertSynced) return;
    this.log('Syncing the remote-control certificate.');
    const headers = Object.assign(
      CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language),
      this.authHeaders(),
    );
    const response = await this.post(Constants.ENDPOINT_CERT_SYNC, headers, '', this.appCertOptions());
    this.parseApiBody(response, 'certificate sync');
    this.state.remoteCertSynced = true;
    await this.persist();
  }

  async pollRemoteResult(remoteCtlId, timeoutMs, intervalMs) {
    this.log('Polling the remote command result.', { remoteCtlId, timeoutMs, intervalMs });
    const deadline = Date.now() + timeoutMs;
    let last = null;

    while (Date.now() < deadline) {
      await sleep(intervalMs);
      try {
        const headers = Object.assign(
          CryptoUtil.buildSignedHeaders(this.signKey(), this.deviceId(), this.language),
          this.authHeaders(),
        );
        const body = new URLSearchParams({ remoteCtlId: String(remoteCtlId) }).toString();
        const response = await this.post(
          Constants.ENDPOINT_REMOTE_CTL_RESULT,
          headers,
          body,
          this.accountCertOptions(),
        );
        const parsed = this.parseApiBody(response, 'remote command result');
        const data = (parsed && typeof parsed.data === 'object' && parsed.data) || {};
        const stateValue = data.remoteCtlState !== undefined ? data.remoteCtlState : data.state;
        last = parsed;
        if (stateValue !== undefined && !PENDING_RESULT_VALUES.has(String(stateValue))) {
          this.log('Remote command finished.', { remoteCtlId, state: String(stateValue) });
          return parsed;
        }
      } catch (err) {
        if (err instanceof LeapmotorException && err.authError) throw err;
        this.log('Remote result poll failed, retrying.', { error: err.message });
      }
    }

    this.log('Remote command result poll timed out.', { remoteCtlId });
    return last;
  }

  agentFor(tlsOptions) {
    const hostname = new URL(this.baseUrl).hostname;
    const pins = this.verifySsl ? pinsForHost(hostname) : null;
    const mode = this.verifySsl ? (pins ? 'pinned' : 'ca') : 'off';
    const key = `${tlsOptions.id}|${mode}|${hostname}`;

    if (!this._agents.has(key)) {
      const agentOptions = {
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 4,
        rejectUnauthorized: this.verifySsl && !pins,
        cert: tlsOptions.cert,
        key: tlsOptions.key,
        pfx: tlsOptions.pfx,
        passphrase: tlsOptions.passphrase,
      };
      const agent = new https.Agent(agentOptions);

      if (pins) {
        agent.createConnection = (options, callback) => {
          const socket = tls.connect(
            Object.assign({}, options, {
              rejectUnauthorized: false,
              servername: hostname,
            }),
            () => {
              const failure = verifyPinnedSocket(socket, hostname, pins);
              if (failure) {
                socket.destroy();
                callback(failure);
                return;
              }
              callback(null, socket);
            },
          );
          socket.on('error', (err) => callback(err));
          return undefined;
        };
      }

      this._agents.set(key, agent);
    }
    return this._agents.get(key);
  }

  post(path, headers, body, tlsOptions) {
    const url = new URL(this.baseUrl + path);
    const payload = body || '';
    this.log('HTTP POST', {
      path,
      headers: LeapmotorClient.redactHeaders(headers),
      body: LeapmotorClient.redactBody(payload),
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      const req = https.request({
        agent: this.agentFor(tlsOptions),
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: Object.assign({}, headers, {
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'keep-alive',
        }),
        timeout: this.timeout,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          this.log('HTTP response', { path, status: res.statusCode, body: responseBody.slice(0, 800) });
          finish(resolve, { status: res.statusCode, body: responseBody, headers: res.headers });
        });
        res.on('error', (err) => finish(reject, new LeapmotorException(
          `HTTP response failed: ${err.message}`,
          { retryable: true },
        )));
      });

      req.on('timeout', () => {
        req.destroy(new LeapmotorException(
          `Request to ${path} timed out after ${this.timeout} ms`,
          { retryable: true },
        ));
      });
      req.on('error', (err) => finish(
        reject,
        err instanceof LeapmotorException
          ? err
          : new LeapmotorException(`HTTP request failed: ${err.message}`, { retryable: true }),
      ));

      if (payload) req.write(payload);
      req.end();
    });
  }

  parseApiBody(response, label) {
    const status = response.status;
    let body;
    try {
      body = JSON.parse(response.body);
    } catch (err) {
      if (status === 401 || status === 403) {
        throw new LeapmotorException(
          `Leapmotor API error during "${label}" - not authorised (HTTP ${status}).`,
          { httpStatus: status, authError: true },
        );
      }
      throw new LeapmotorException(
        `Leapmotor API error during "${label}" (HTTP ${status}): ${String(response.body).slice(0, 200)}`,
        { httpStatus: status, retryable: status >= 500 },
      );
    }

    const rawCode = [body.code, body.resultCode, body.errCode, body.status]
      .find((v) => v !== undefined && v !== null);
    const code = rawCode === undefined ? null : String(rawCode);
    const message = body.msg || body.message || body.errMsg || body.description || '';

    const httpOk = status >= 200 && status < 300;
    const codeOk = code === null || SUCCESS_CODES.has(code);
    if (httpOk && codeOk) return body;

    const authError = AUTH_CODES.has(code) || status === 401 || status === 403;
    throw new LeapmotorException(
      `Leapmotor API error during "${label}" (HTTP ${status}, code ${code}): ${message || 'No message available'}`,
      { httpStatus: status, code, authError, retryable: status >= 500 },
    );
  }

  static redactHeaders(headers) {
    const redacted = Object.assign({}, headers);
    ['token', 'sign', 'userId'].forEach((key) => {
      if (redacted[key]) redacted[key] = '***';
    });
    return redacted;
  }

  static redactBody(body) {
    return String(body || '')
      .replace(/(password=)[^&]*/gi, '$1***')
      .replace(/(operatePassword=)[^&]*/gi, '$1***')
      .replace(/(refreshToken=)[^&]*/gi, '$1***')
      .slice(0, 500);
  }
}

module.exports = LeapmotorClient;
