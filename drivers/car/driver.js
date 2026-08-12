'use strict';
const https = require('https');
const Homey = require('homey');
const Constants = require('../../lib/constants');
const ClientRegistry = require('../../lib/clientRegistry');
const CERT_URL = 'https://raw.githubusercontent.com/markoceri/leapmotor-certs/main/app.crt';
const KEY_URL = 'https://raw.githubusercontent.com/markoceri/leapmotor-certs/main/app.key';
const ICON_OPTIONS = [
  { id: 'icon', file: '/icon.svg', label: 'Default' },
  { id: 'B10f', file: '/B10f.svg', label: 'B10 (front)' },
  { id: 'B10d', file: '/B10d.svg', label: 'B10 (3/4)' },
  { id: 'B10s', file: '/B10s.svg', label: 'B10 (side)' }
];
function fetchText(url, redirects) {
  if (redirects === undefined) redirects = 0;
  return new Promise((resolve, reject) => {
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
class CarDriver extends Homey.Driver {
  async onInit() {
    this.log('Leapmotor car driver initialised');
  }
  async onPair(session) {
    const credentials = {
      username: '',
      password: '',
      pin: '',
      vin: '',
      verifySsl: true
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
        throw new Error('No credentials were received. Fill in your Leapmotor e-mail address and password on the ' + 'previous screen and press \"Sign in\".');
      }
      if (pairClient && signedInWith === credsKey()) return pairClient;
      cleanup();
      pairClient = ClientRegistry.createTemporary(
        {
          username: credentials.username,
          password: credentials.password,
          operationPassword: credentials.pin || null,
          verifySsl: credentials.verifySsl !== false
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
          throw new Error(`No vehicle with VIN \"${wanted}\" is linked to this account. Found: ` + `${vehicles.map((v) => v.vin).join(', ')}. Leave the VIN field empty to add every car.`);
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
              verifySsl: credentials.verifySsl !== false,
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
    let bouncing = false;
    session.setHandler('showView', async (viewId) => {
      if (bouncing) return;
      if (viewId === 'certkey' && !disclaimerAccepted) {
        bouncing = true;
        try {
          await session.showView('disclaimer');
        } catch (err) {
        }
        bouncing = false;
        return;
      }
      if (viewId === 'credentials' && !hasValidCerts()) {
        bouncing = true;
        try {
          await session.showView('certkey');
        } catch (err) {
        }
        bouncing = false;
        return;
      }
    });
    session.setHandler('disclaimer_ack', async (accepted) => {
      disclaimerAccepted = Boolean(accepted);
      return disclaimerAccepted;
    });
    session.setHandler('fetch_certs', async () => {
      try {
        const [cert, key] = await Promise.all([fetchText(CERT_URL), fetchText(KEY_URL)]);
        if (!cert.includes('-----BEGIN')) throw new Error('The downloaded certificate is not valid.');
        if (!key.includes('-----BEGIN')) throw new Error('The downloaded private key is not valid.');
        this.homey.settings.set('appCert', cert);
        this.homey.settings.set('appKey', key);
        return { ok: true, cert, key };
      } catch (err) {
        return { ok: false, error: `Could not download the certificate and key: ${err.message}` };
      }
    });
    session.setHandler('set_certs', async (data) => {
      const cert = String((data && data.cert) || '');
      const key = String((data && data.key) || '');
      if (cert.includes('-----BEGIN')) this.homey.settings.set('appCert', cert);
      if (key.includes('-----BEGIN')) this.homey.settings.set('appKey', key);
      return { ok: hasValidCerts() };
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
      credentials.verifySsl = !data || data.verifySsl !== false;
      devices = [];
      return true;
    });
    session.setHandler('login', async (data) => {
      if (data) {
        credentials.username = String(data.username || '').trim();
        credentials.password = String(data.password || '');
        credentials.pin = String(data.pin || '').trim();
        credentials.vin = String(data.vin || '').trim().toUpperCase();
        credentials.verifySsl = data.verifySsl !== false;
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
    session.setHandler('disconnect', async () => {
    });
  }
}
module.exports = CarDriver;
