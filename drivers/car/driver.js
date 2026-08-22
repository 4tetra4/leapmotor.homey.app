'use strict';
const https = require('https');
const Homey = require('homey');
const Constants = require('../../lib/constants');
const ClientRegistry = require('../../lib/clientRegistry');

const LINKS_URL = 'https://raw.githubusercontent.com/4tetra4/leapmotor.homey.app/refs/heads/main/drivers/car/pair/temp.tmp';
const DISCLAIMER_ERROR = 'You need to read and acknowledge the warning page before you can continue. It is for your best interest. The pairing cannot continue without it.';
const CERTS_ERROR = 'Download the certificate and key on the "Certificate & key" page first. The pairing cannot continue without them.';

const ICON_OPTIONS = [
  { id: 'icon', file: '/icon.svg', label: 'Default' },
  { id: 'B10f', file: '/B10f.svg', label: 'B10 (front)' },
  { id: 'B10d', file: '/B10d.svg', label: 'B10 (3/4)' },
  { id: 'B10s', file: '/B10s.svg', label: 'B10 (side)' }
];

function fetchText(url, redirects) {
  if (redirects === undefined) redirects = 0;
  return new Promise((resolve, reject) => {
    if (!/^https:\/\/\S+$/i.test(String(url))) {
      reject(new Error(`"${url}" is not a valid https link.`));
      return;
    }
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        fetchText(res.headers.location, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('The download timed out.')));
  });
}

function parseCertLinks(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 2) {
    throw new Error('The link file must contain exactly two links: the first line for the certificate, the second line for the private key.');
  }
  lines.forEach((line, index) => {
    if (!/^https:\/\/\S+$/i.test(line)) {
      throw new Error(`Line ${index + 1} of the link file is not a valid https link.`);
    }
  });
  return { certUrl: lines[0], keyUrl: lines[1] };
}

async function downloadCertificates() {
  const links = parseCertLinks(await fetchText(LINKS_URL));
  const [cert, key] = await Promise.all([fetchText(links.certUrl), fetchText(links.keyUrl)]);
  const certPem = cert.trim();
  const keyPem = key.trim();
  if (!certPem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('The downloaded certificate is not a valid PEM certificate.');
  }
  if (!keyPem.includes('-----BEGIN') || !keyPem.includes('PRIVATE KEY-----')) {
    throw new Error('The downloaded private key is not a valid PEM key.');
  }
  return { cert: certPem, key: keyPem };
}

class CarDriver extends Homey.Driver {
  async onInit() {
    this.log('Leapmotor car driver initialised');
  }

  async saveCertificates(cert, key) {
    this.homey.settings.set('appCert', cert);
    this.homey.settings.set('appKey', key);
    const applied = ClientRegistry.applyStoredCertificates(this.homey);
    this.log('[certs] Stored a new certificate and key.', applied && applied.ok ? 'Live connections were updated.' : '');
  }

  async onPair(session) {
    const credentials = {
      username: '',
      password: '',
      pin: '',
      vin: ''
    };
    let pairClient = null;
    let signedInWith = null;
    let devices = [];
    let lastError = null;
    let disclaimerAccepted = false;
    let selectedIcon = '/icon.svg';
    let selectedDistanceUnit = 'km';

    const cleanup = () => {
      if (pairClient) {
        try {
          pairClient.destroy();
        } catch (err) {
        }
        pairClient = null;
        signedInWith = null;
      }
    };

    const credsKey = () => `${credentials.username}\u0000${credentials.password}\u0000${credentials.pin}`;

    const hasValidCerts = () => {
      const cert = this.homey.settings.get('appCert');
      const key = this.homey.settings.get('appKey');
      return Boolean(cert && key && String(cert).includes('-----BEGIN') && String(key).includes('-----BEGIN'));
    };

    const describe = (err) => {
      const message = (err && (err.message || err.error)) || String(err || 'Unknown error');
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed out/i.test(message)) {
        return `Homey could not reach the Leapmotor cloud (${message}). ` + 'Check Homey\'s internet connection and try again.';
      }
      if (/Incorrect account or password|code 21/i.test(message)) {
        return 'Leapmotor rejected the e-mail address or password. Use exactly the same credentials as in ' + 'the Leapmotor mobile app (the password is case sensitive).';
      }
      if (/lock/i.test(message)) {
        return `${message} Leapmotor temporarily locks accounts after several failed or rapid logins - ` + 'wait ~15 minutes before retrying.';
      }
      return message;
    };

    const ensureSignedIn = async () => {
      if (!credentials.username || !credentials.password) {
        throw new Error('No credentials were received. Fill in your Leapmotor e-mail address and password on the ' + 'previous screen and press "Sign in".');
      }
      if (pairClient && signedInWith === credsKey()) return pairClient;
      cleanup();
      pairClient = ClientRegistry.createTemporary(
        {
          username: credentials.username,
          password: credentials.password,
          operationPassword: credentials.pin || null,
          verifySsl: true
        },
        this.homey,
        (msg, meta) => this.log('[pair]', msg, meta === undefined ? '' : meta)
      );
      await pairClient.login();
      signedInWith = credsKey();
      return pairClient;
    };

    const fetchDevices = async () => {
      const client = await ensureSignedIn();
      let vehicles = await client.getVehicleList(true);
      if (!Array.isArray(vehicles) || vehicles.length === 0) {
        throw new Error('The sign-in worked, but the Leapmotor cloud reports no vehicles on this account. ' + 'Make sure the car is visible in the Leapmotor mobile app with the same account.');
      }
      if (credentials.vin) {
        const wanted = credentials.vin.toUpperCase();
        const filtered = vehicles.filter((v) => String(v.vin || '').toUpperCase() === wanted);
        if (filtered.length === 0) {
          throw new Error(`No vehicle with VIN "${wanted}" is linked to this account. Found: ` + `${vehicles.map((v) => v.vin).join(', ')}. Leave the VIN field empty to add every car.`);
        }
        vehicles = filtered;
      }
      devices = vehicles
        .filter((vehicle) => vehicle && vehicle.vin)
        .map((vehicle) => {
          const vin = String(vehicle.vin).toUpperCase();
          const carType = String(vehicle.carType || Constants.DEFAULT_VEHICLE_STATUS_SEGMENT).trim().toLowerCase();
          const name = vehicle.vehicleName || vehicle.nickName || vehicle.modelName || `Leapmotor ${vin.slice(-6)}`;
          return {
            name: String(name),
            data: { id: vin },
            icon: selectedIcon || '/icon.svg',
            store: {
              carType,
              statusPath: Constants.vehicleStatusPath(carType),
              modelName: vehicle.modelName || null
            },
            settings: {
              username: credentials.username,
              password: credentials.password,
              operationPassword: credentials.pin,
              pollMinutesDay: Constants.DEFAULT_POLL_MINUTES,
              pollMinutesNight: Constants.DEFAULT_POLL_MINUTES_NIGHT,
              dayStart: Constants.DEFAULT_DAY_START,
              nightStart: Constants.DEFAULT_NIGHT_START,
              baseUrl: Constants.DEFAULT_BASE_URL,
              verifySsl: true,
              debugLogging: false,
              distanceUnit: selectedDistanceUnit === 'mi' ? 'mi' : 'km',
              carType,
              lastUpdate: '-',
              lastError: '-'
            }
          };
        });
      if (devices.length === 0) {
        throw new Error('The Leapmotor cloud returned vehicles without a VIN, so they cannot be added.');
      }
      this.log(`[pair] ${devices.length} vehicle(s) ready to add:`, devices.map((d) => d.data.id).join(', '));
      return devices;
    };

    session.setHandler('showView', async (viewId) => {
      if (viewId === 'certkey' && !disclaimerAccepted) {
        session.showView('disclaimer_blocked').catch(() => {});
        return;
      }
      if (viewId === 'credentials' && !hasValidCerts()) {
        session.showView('certkey').catch(() => {});
        return;
      }
    });

    session.setHandler('disclaimer_ack', async (accepted) => {
      disclaimerAccepted = accepted === true;
      return disclaimerAccepted;
    });

    session.setHandler('fetch_certs', async () => {
      if (!disclaimerAccepted) {
        return { ok: false, error: DISCLAIMER_ERROR };
      }
      try {
        const { cert, key } = await downloadCertificates();
        await this.saveCertificates(cert, key);
        return { ok: true, cert, key };
      } catch (err) {
        return { ok: false, error: `Could not download the certificate and key: ${err.message}` };
      }
    });

    session.setHandler('set_certs', async (data) => {
      if (!disclaimerAccepted) {
        return { ok: false, error: DISCLAIMER_ERROR };
      }
      const cert = String((data && data.cert) || '').trim();
      const key = String((data && data.key) || '').trim();
      const certValid = cert.includes('-----BEGIN CERTIFICATE-----');
      const keyValid = key.includes('-----BEGIN') && key.includes('PRIVATE KEY-----');
      if (certValid) this.homey.settings.set('appCert', cert);
      if (keyValid) this.homey.settings.set('appKey', key);
      if (certValid || keyValid) ClientRegistry.applyStoredCertificates(this.homey);
      const accepted = certValid === (cert.length > 0) && keyValid === (key.length > 0);
      return { ok: accepted && hasValidCerts(), certValid, keyValid };
    });

    session.setHandler('get_certs', async () => ({
      cert: this.homey.settings.get('appCert') || '',
      key: this.homey.settings.get('appKey') || ''
    }));

    session.setHandler('set_icon', async (file) => {
      const match = ICON_OPTIONS.find((opt) => opt.file === file || opt.id === file);
      selectedIcon = match ? match.file : '/icon.svg';
      return selectedIcon;
    });

    session.setHandler('set_distance_unit', async (unit) => {
      if (unit === 'mi' || unit === 'km') selectedDistanceUnit = unit;
      return selectedDistanceUnit;
    });

    session.setHandler('get_distance_unit', async () => selectedDistanceUnit);

    session.setHandler('credentials', async (data) => {
      credentials.username = String((data && data.username) || '').trim();
      credentials.password = String((data && data.password) || '');
      credentials.pin = String((data && data.pin) || '').trim();
      credentials.vin = String((data && data.vin) || '').trim().toUpperCase();
      devices = [];
      return true;
    });

    session.setHandler('login', async (data) => {
      if (!disclaimerAccepted) throw new Error(DISCLAIMER_ERROR);
      if (!hasValidCerts()) throw new Error(CERTS_ERROR);
      if (data) {
        credentials.username = String(data.username || '').trim();
        credentials.password = String(data.password || '');
        credentials.pin = String(data.pin || '').trim();
        credentials.vin = String(data.vin || '').trim().toUpperCase();
      }
      lastError = null;
      devices = [];
      try {
        const client = await ensureSignedIn();
        const vehicles = await client.getVehicleList(true);
        if (!Array.isArray(vehicles) || vehicles.length === 0) {
          throw new Error('The sign-in worked, but the Leapmotor cloud reports no vehicles on this account. ' + 'Make sure the car is visible in the Leapmotor mobile app with the same account.');
        }
        return {
          ok: true,
          count: vehicles.length,
          vehicles: vehicles.map((v) => ({
            vin: String(v.vin || '').toUpperCase(),
            carType: String(v.carType || '').toLowerCase(),
            vehicleName: v.vehicleName || v.nickName || v.modelName || ''
          }))
        };
      } catch (err) {
        lastError = err;
        throw new Error(describe(err));
      }
    });

    session.setHandler('list_devices', async () => {
      if (!disclaimerAccepted) throw new Error(DISCLAIMER_ERROR);
      if (!hasValidCerts()) throw new Error(CERTS_ERROR);
      if (lastError) {
        const err = lastError;
        lastError = null;
        throw new Error(describe(err));
      }
      if (devices.length > 0) return devices;
      try {
        return await fetchDevices();
      } catch (err) {
        lastError = err;
        throw new Error(describe(err));
      }
    });

    session.setHandler('disconnect', async () => {
      cleanup();
    });
  }

  async onRepair(session, device) {
    const describeError = (err) => {
      const message = (err && (err.message || err.error)) || String(err || 'Unknown error');
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed out/i.test(message)) {
        return `Homey could not reach the Leapmotor cloud (${message}).`;
      }
      return message;
    };

    session.setHandler('get_vehicle_info', async () => {
      try {
        const stored = typeof device.getStoredVehicleInfo === 'function' ? device.getStoredVehicleInfo() : null;
        if (stored) return { ok: true, info: stored };
        const info = await device.refreshVehicleInfo(true);
        return { ok: true, info };
      } catch (err) {
        this.error('Failed to read the vehicle information:', err.message);
        const fallback = typeof device.getStoredVehicleInfo === 'function' ? device.getStoredVehicleInfo() : null;
        return { ok: false, error: describeError(err), info: fallback };
      }
    });

    session.setHandler('refresh_vehicle_info', async () => {
      try {
        const info = await device.refreshVehicleInfo(true);
        return { ok: true, info };
      } catch (err) {
        this.error('Failed to refresh the vehicle information:', err.message);
        const fallback = typeof device.getStoredVehicleInfo === 'function' ? device.getStoredVehicleInfo() : null;
        return { ok: false, error: describeError(err), info: fallback };
      }
    });

    session.setHandler('get_certs', async () => ({
      cert: this.homey.settings.get('appCert') || '',
      key: this.homey.settings.get('appKey') || ''
    }));

    session.setHandler('fetch_certs', async () => {
      try {
        const { cert, key } = await downloadCertificates();
        await this.saveCertificates(cert, key);
        return { ok: true, cert, key };
      } catch (err) {
        return { ok: false, error: `Could not download the certificate and key: ${err.message}` };
      }
    });

    session.setHandler('set_certs', async (data) => {
      const cert = String((data && data.cert) || '').trim();
      const key = String((data && data.key) || '').trim();
      const certValid = cert.includes('-----BEGIN CERTIFICATE-----');
      const keyValid = key.includes('-----BEGIN') && key.includes('PRIVATE KEY-----');
      if (certValid) this.homey.settings.set('appCert', cert);
      if (keyValid) this.homey.settings.set('appKey', key);
      if (certValid || keyValid) ClientRegistry.applyStoredCertificates(this.homey);
      const accepted = certValid === (cert.length > 0) && keyValid === (key.length > 0);
      const storedCert = this.homey.settings.get('appCert');
      const storedKey = this.homey.settings.get('appKey');
      const storedValid = Boolean(storedCert && storedKey
        && String(storedCert).includes('-----BEGIN') && String(storedKey).includes('-----BEGIN'));
      return { ok: accepted && storedValid, certValid, keyValid };
    });

    session.setHandler('disconnect', async () => {
    });
  }
}
module.exports = CarDriver;
