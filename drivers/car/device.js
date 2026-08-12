'use strict';
const Homey = require('homey');
const Constants = require('../../lib/constants');
const ClientRegistry = require('../../lib/clientRegistry');
const StatusMapper = require('../../lib/statusMapper');
const Units = require('../../lib/units');
const VehicleInfo = require('../../lib/vehicleInfo');
const CREDENTIAL_SETTINGS = ['username', 'password', 'language', 'baseUrl', 'verifySsl'];
const PIN_SETTINGS = ['operationPassword'];
const SCHEDULE_SETTINGS = ['pollMinutesDay', 'pollMinutesNight', 'dayStart', 'nightStart'];
const VEHICLE_INFO_SETTINGS = [
  'vehicleModel',
  'vehicleYear',
  'vehicleName',
  'vehicleDrive',
  'vehicleSeats',
  'vehicleVin',
  'vehicleCarId',
  'vehicleUserId',
  'vehicleDeviceId',
  'vehicleAppVersion',
  'vehicleApiLanguage'
];
const INFO_SETTINGS = ['lastUpdate', 'lastError'].concat(VEHICLE_INFO_SETTINGS);
const VEHICLE_INFO_STORE_KEY = 'vehicleInfo';
const VEHICLE_INFO_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CAPABILITY_LAYOUT_VERSION = 17;
const UNIT_STORE_KEY = 'distanceUnitApplied';
const OPTIONS_LAYOUT = 2;
const ACK_TIMEOUT_MS = 8000;
const CONFIRM_DELAYS_MS = [4000, 10000, 22000];
const COMMAND_METHODS = ['executeCommand', 'sendCommand', 'runCommand', 'remoteControl', 'sendRemoteCommand', 'command'];
const RAW_COMMAND_METHODS = ['executeRawCommand', 'sendRawCommand', 'rawCommand', 'remoteControlRaw'];
const STATUS_METHODS = ['getVehicleStatus', 'getStatus', 'vehicleStatus', 'fetchVehicleStatus'];
const STATE_COMMANDS = {
  leapmotor_lock_control: {
    true: { command: 'lock' },
    false: { command: 'unlock' }
  },
  leapmotor_boot_control: {
    true: { command: 'open_trunk' },
    false: { command: 'close_trunk' }
  },
  leapmotor_windows_control: {
    true: { command: 'open_windows' },
    false: { command: 'close_windows' }
  },
  leapmotor_sunshade: {
    true: { command: 'open_sunshade' },
    false: { command: 'close_sunshade' }
  },
  leapmotor_fast_heating: {
    true: { command: 'quick_heat' },
    false: { command: 'ac_off' }
  },
  leapmotor_windshield_defrost: {
    true: { command: 'windshield_defrost' },
    false: { command: 'ac_off' }
  },
  leapmotor_seat_heat_passenger: {
    true: { command: 'seat_heat', params: { position: 2, level: 3 } },
    false: { command: 'seat_heat', params: { position: 2, level: 0 } }
  },
  leapmotor_seat_heat_driver: {
    true: { command: 'seat_heat', params: { position: 3, level: 3 } },
    false: { command: 'seat_heat', params: { position: 3, level: 0 } }
  },
  leapmotor_steering_wheel_heat: {
    true: { command: 'steering_wheel_heat_on' },
    false: { command: 'steering_wheel_heat_off' }
  },
  leapmotor_fast_cooling: {
    true: { command: 'quick_cool' },
    false: { command: 'ac_off' }
  },
  leapmotor_seat_ventilation_passenger: {
    true: { command: 'seat_ventilation', params: { position: 2, level: 3 } },
    false: { command: 'seat_ventilation', params: { position: 2, level: 0 } }
  },
  leapmotor_seat_ventilation_driver: {
    true: { command: 'seat_ventilation', params: { position: 3, level: 3 } },
    false: { command: 'seat_ventilation', params: { position: 3, level: 0 } }
  },
  leapmotor_charging_control: {
    true: { command: 'start_charging', altCommand: 'start_charging_plan_clear' },
    false: { command: 'stop_charging', altCommand: 'stop_charging_plan_block' }
  },
  leapmotor_battery_heating_control: {
    true: { command: 'battery_preheat_on' },
    false: { command: 'battery_preheat_off' }
  },
  leapmotor_mirror_heating: {
    true: { command: 'rearview_mirror_heat_on' },
    false: { command: 'rearview_mirror_heat_off' }
  }
};
class CarDevice extends Homey.Device {
  async onInit() {
    this._destroyed = false;
    this._refreshTimer = null;
    this._refreshPromise = null;
    this._failureCount = 0;
    this._confirmTimers = new Map();
    this._pendingCommands = new Map();
    this._lastUpdateAt = this.getStoreValue('lastUpdateAt') || null;
    this._lastRangeKm = this.getStoreValue('lastRangeKm');
    if (typeof this._lastRangeKm !== 'number' || !Number.isFinite(this._lastRangeKm)) this._lastRangeKm = null;
    this._staleTimer = null;
    this._vehicleInfoTimer = null;
    this.log(`Leapmotor car device initialising: ${this.getName()}`);
    await this._migrateCapabilities();
    await this._applyUnitOptions(this.getSettings());
    this._registerCapabilityListeners();
    this._buildClient(this.getSettings());
    this._startStaleChecker();
    this._scheduleNextRefresh(5000);
    this._scheduleVehicleInfoRefresh(9000);
  }
  async onAdded() {
    this._scheduleNextRefresh(2000);
    this._scheduleVehicleInfoRefresh(6000);
  }
  async onUninit() {
    this._teardown();
  }
  onDeleted() {
    this._teardown();
    try {
      const settings = this.getSettings();
      ClientRegistry.release(settings.baseUrl, settings.username);
    } catch (err) {
      this.error('Failed to release the shared client:', err.message);
    }
  }
  _teardown() {
    this._destroyed = true;
    if (this._refreshTimer) {
      this.homey.clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._confirmTimers.forEach((timer) => this.homey.clearTimeout(timer));
    this._confirmTimers.clear();
    if (this._staleTimer) {
      this.homey.clearTimeout(this._staleTimer);
      this._staleTimer = null;
    }
    if (this._vehicleInfoTimer) {
      this.homey.clearTimeout(this._vehicleInfoTimer);
      this._vehicleInfoTimer = null;
    }
  }
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    const relevant = changedKeys.filter((key) => !INFO_SETTINGS.includes(key));
    if (relevant.length === 0) return;
    if (changedKeys.includes('distanceUnit')) {
      await this._applyUnitOptions(newSettings);
      await this._rewriteDisplayedValues(oldSettings.distanceUnit, newSettings.distanceUnit);
    }
    if (changedKeys.includes('rangeCorrectionEnabled') || changedKeys.includes('rangeCorrectionFactor')) {
      await this._reapplyRangeCorrection();
    }
    const credentialsChanged = relevant.some((key) => CREDENTIAL_SETTINGS.includes(key));
    if (credentialsChanged) {
      ClientRegistry.invalidate(this.homey, oldSettings.baseUrl, oldSettings.username);
      ClientRegistry.release(oldSettings.baseUrl, oldSettings.username);
    }
    if (credentialsChanged || relevant.some((key) => PIN_SETTINGS.includes(key))) {
      this._buildClient(newSettings);
    }
    if (credentialsChanged || relevant.some((key) => SCHEDULE_SETTINGS.includes(key))) {
      this._scheduleNextRefresh(2000);
    }
    if (credentialsChanged) {
      this._scheduleVehicleInfoRefresh(4000);
    }
    if (changedKeys.includes('distanceUnit')) {
      this._scheduleNextRefresh(1500);
    }
  }
  async _migrateCapabilities() {
    if (this.getStoreValue('capabilityLayout') === CAPABILITY_LAYOUT_VERSION) return;
    const manifest = new Set(this.driver.manifest && this.driver.manifest.capabilities || []);
    const current = typeof this.getCapabilities === 'function' ? this.getCapabilities() : [];
    for (const cap of current) {
      if (!manifest.has(cap)) {
        try {
          await this.removeCapability(cap);
        } catch (err) {
          this.error('Failed to remove capability', cap, err.message);
        }
      }
    }
    for (const cap of manifest) {
      if (!this.hasCapability(cap)) {
        try {
          await this.addCapability(cap);
        } catch (err) {
          this.error('Failed to add capability', cap, err.message);
        }
      }
    }
    try {
      await this.setStoreValue('capabilityLayout', CAPABILITY_LAYOUT_VERSION);
    } catch (err) {
      this.error('Failed to store the capability layout version:', err.message);
    }
  }
  _registerCapabilityListeners() {
    Object.entries(STATE_COMMANDS).forEach(([capability, states]) => {
      if (!this.hasCapability(capability)) return;
      this.registerCapabilityListener(capability, async (value) => {
        const desired = value === true;
        const state = states[desired ? 'true' : 'false'];
        const useAlternative = state.altCommand && this.getSetting('chargeToggleMode') === 'chargePlan';
        await this.runCommand(useAlternative ? state.altCommand : state.command, state.params || {});
        if (this.getSetting('confirmCommands') !== false) {
          this._scheduleConfirmation(capability, desired);
        }
      });
    });
    if (this.hasCapability('leapmotor_refresh')) {
      this.registerCapabilityListener('leapmotor_refresh', async () => {
        await this.refreshStatus(true);
      });
    }
    if (this.hasCapability('leapmotor_unlock_charger')) {
      this.registerCapabilityListener('leapmotor_unlock_charger', async () => {
        await this.runCommand('unlock_charger');
      });
    }
    if (this.hasCapability('leapmotor_btkey_reset')) {
      this.registerCapabilityListener('leapmotor_btkey_reset', async () => {
        await this.runCommand('ble_key_restart');
      });
    }
  }
  _buildClient(settings) {
    this.client = ClientRegistry.acquire(
      this.homey,
      {
        username: settings.username,
        password: settings.password,
        operationPassword: settings.operationPassword || null,
        language: settings.language || Constants.DEFAULT_LANGUAGE,
        baseUrl: settings.baseUrl || Constants.DEFAULT_BASE_URL,
        verifySsl: settings.verifySsl === true
      },
      (message, metadata) => {
        if (this.getSetting('debugLogging')) {
          this.log('[client]', message, metadata === undefined ? '' : metadata);
        }
      }
    );
    this.client.operationPassword = settings.operationPassword || null;
  }
  get vin() {
    return String(this.getSetting('vin') || this.getData().id || '').trim().toUpperCase();
  }
  get carType() {
    return this.getStoreValue('carType') || this.getStoreValue('statusPath') || Constants.DEFAULT_VEHICLE_STATUS_SEGMENT;
  }
  _isImperial() {
    return this.getSetting('distanceUnit') === 'mi';
  }
  _rangeCorrectionMultiplier() {
    if (this.getSetting('rangeCorrectionEnabled') !== true) return 1;
    const factor = Number(this.getSetting('rangeCorrectionFactor'));
    if (!Number.isFinite(factor) || factor <= 0) return 1;
    return (100 - Math.min(factor, 90)) / 100;
  }
  _applyRangeCorrection(displayValue) {
    if (typeof displayValue !== 'number' || !Number.isFinite(displayValue)) return displayValue;
    return displayValue * this._rangeCorrectionMultiplier();
  }
  async _reapplyRangeCorrection() {
    if (!this.hasCapability('measure_range')) return;
    let rawKm = this._lastRangeKm;
    if (typeof rawKm !== 'number' || !Number.isFinite(rawKm)) {
      const stored = this.getStoreValue('lastRangeKm');
      if (typeof stored === 'number' && Number.isFinite(stored)) rawKm = stored;
    }
    if (typeof rawKm !== 'number' || !Number.isFinite(rawKm)) {
      this._scheduleNextRefresh(1500);
      return;
    }
    const corrected = this._applyRangeCorrection(Units.toDisplay('measure_range', rawKm, this._isImperial()));
    try {
      await this.setCapabilityValue('measure_range', corrected);
    } catch (err) {
      this.error('Failed to apply the range correction:', err.message);
    }
  }
  getDataAgeMinutes() {
    if (!this._lastUpdateAt) return null;
    const diff = Date.now() - this._lastUpdateAt;
    if (diff < 0) return 0;
    return Math.round(diff / 60000);
  }
  isParked() {
    const speed = this.getCapabilityValue('leapmotor_speed');
    if (typeof speed === 'number' && Number.isFinite(speed)) return speed === 0;
    const charging = this.getCapabilityValue('leapmotor_charging');
    const plugged = this.getCapabilityValue('leapmotor_plugged');
    if (charging === true) return true;
    return null;
  }
  _haversine(lat1, lon1, lat2, lon2) {
    const toRad = (v) => v * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  _startStaleChecker() {
    if (this._staleTimer) {
      this.homey.clearTimeout(this._staleTimer);
      this._staleTimer = null;
    }
    const loop = async () => {
      if (this._destroyed) return;
      try {
        const age = this.getDataAgeMinutes();
        if (age !== null && Number.isFinite(age)) {
          const tokens = { age_minutes: age };
          const state = { age_minutes: age };
          try {
            await this.homey.flow.getDeviceTriggerCard('data_stale').trigger(this, tokens, state);
          } catch (err) {
          }
        }
      } catch (err) {
      }
      if (!this._destroyed) {
        this._staleTimer = this.homey.setTimeout(loop, 60000);
      }
    };
    this._staleTimer = this.homey.setTimeout(loop, 60000);
  }
  async _applyUnitOptions(settings) {
    const unit = settings && settings.distanceUnit === 'mi' ? 'mi' : 'km';
    if (this.getStoreValue(UNIT_STORE_KEY) === unit && this.getStoreValue('optionsLayout') === OPTIONS_LAYOUT) return;
    const isImperial = unit === 'mi';
    for (const cap of Units.getStaticCapabilities()) {
      if (!this.hasCapability(cap)) continue;
      try {
        const desired = Units.getCapabilityOptions(cap, isImperial);
        if (!desired) continue;
        let current = {};
        try {
          const opts = this.getCapabilityOptions(cap);
          if (opts && typeof opts === 'object') current = Object.assign({}, opts);
        } catch (err) {
          current = {};
        }
        const next = Object.assign({}, current, desired);
        if (JSON.stringify(current) === JSON.stringify(next)) continue;
        await this.setCapabilityOptions(cap, next);
      } catch (err) {
        this.error('Failed to set capability options', cap, err.message);
      }
    }
    for (const cap of Units.getConvertibleCapabilities()) {
      if (!this.hasCapability(cap)) continue;
      try {
        const desired = Units.getCapabilityOptions(cap, isImperial);
        if (!desired) continue;
        let current = {};
        try {
          const opts = this.getCapabilityOptions(cap);
          if (opts && typeof opts === 'object') current = Object.assign({}, opts);
        } catch (err) {
          current = {};
        }
        const next = Object.assign({}, current, desired);
        if (current.units && next.units && JSON.stringify(current.units) === JSON.stringify(next.units) && current.decimals === next.decimals) continue;
        if (JSON.stringify(current) === JSON.stringify(next)) continue;
        await this.setCapabilityOptions(cap, next);
      } catch (err) {
        this.error('Failed to set capability options', cap, err.message);
      }
    }
    try {
      await this.setStoreValue(UNIT_STORE_KEY, unit);
      await this.setStoreValue('optionsLayout', OPTIONS_LAYOUT);
    } catch (err) {
      this.error('Failed to store unit', err.message);
    }
  }
  async _rewriteDisplayedValues(oldUnit, newUnit) {
    const normalizedOld = oldUnit === 'mi' ? 'mi' : 'km';
    const normalizedNew = newUnit === 'mi' ? 'mi' : 'km';
    if (normalizedOld === normalizedNew) return;
    const toImperial = normalizedNew === 'mi';
    const caps = Units.getConvertibleCapabilities();
    for (const cap of caps) {
      if (!this.hasCapability(cap)) continue;
      const current = this.getCapabilityValue(cap);
      if (typeof current !== 'number' || !Number.isFinite(current)) continue;
      let next;
      if (cap === 'measure_range' || cap === 'leapmotor_odometer' || cap === 'leapmotor_speed') {
        next = toImperial ? current / Units.DIVISOR : current * Units.DIVISOR;
      } else {
        continue;
      }
      if (!Number.isFinite(next)) continue;
      if (current === next) continue;
      try {
        await this.setCapabilityValue(cap, next);
      } catch (err) {
        this.error('Failed to rewrite capability', cap, err.message);
      }
    }
  }
  _currentIntervalMinutes() {
    const settings = this.getSettings();
    const parseTime = (value, fallback) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
      if (!match) return fallback;
      return 60 * Math.min(parseInt(match[1], 10), 23) + Math.min(parseInt(match[2], 10), 59);
    };
    const defaultDayStart = parseTime(Constants.DEFAULT_DAY_START, 420);
    const defaultNightStart = parseTime(Constants.DEFAULT_NIGHT_START, 1380);
    const dayStart = parseTime(settings.dayStart, defaultDayStart);
    const nightStart = parseTime(settings.nightStart, defaultNightStart);
    const now = new Date();
    const minutesNow = 60 * now.getHours() + now.getMinutes();
    let isDay;
    if (dayStart === nightStart) {
      isDay = true;
    } else if (dayStart < nightStart) {
      isDay = minutesNow >= dayStart && minutesNow < nightStart;
    } else {
      isDay = minutesNow >= dayStart || minutesNow < nightStart;
    }
    const configured = parseInt(isDay ? settings.pollMinutesDay : settings.pollMinutesNight, 10);
    const fallback = isDay ? Constants.DEFAULT_POLL_MINUTES : Constants.DEFAULT_POLL_MINUTES_NIGHT;
    return Number.isFinite(configured) && configured > 0 ? configured : fallback;
  }
  _scheduleNextRefresh(delayMs) {
    if (this._destroyed) return;
    if (this._refreshTimer) {
      this.homey.clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    const delay = Number.isFinite(delayMs)
      ? Math.max(delayMs, 1000)
      : Math.max(60 * this._currentIntervalMinutes() * 1000, 60000);
    this._refreshTimer = this.homey.setTimeout(async () => {
      this._refreshTimer = null;
      try {
        await this.refreshStatus(false);
      } catch (err) {
        this.error('Scheduled refresh failed:', err.message);
      }
      this._scheduleNextRefresh();
    }, delay);
  }
  _clearConfirmation(capability) {
    const timer = this._confirmTimers.get(capability);
    if (timer) {
      this.homey.clearTimeout(timer);
      this._confirmTimers.delete(capability);
    }
  }
  _scheduleConfirmation(capability, desired) {
    this._clearConfirmation(capability);
    const delays = CONFIRM_DELAYS_MS.slice();
    const check = async () => {
      if (this._destroyed) return;
      this._confirmTimers.delete(capability);
      try {
        await this.refreshStatus(true);
      } catch (err) {
        this.error('Confirmation refresh failed:', err.message);
      }
      if (this._destroyed) return;
      if (this.getCapabilityValue(capability) !== desired) {
        if (delays.length > 0) {
          this._confirmTimers.set(capability, this.homey.setTimeout(check, delays.shift()));
          return;
        }
        this.setWarning('The vehicle did not confirm the last command. The displayed state is the last value reported by the car.').catch(() => {});
        return;
      }
      this.unsetWarning().catch(() => {});
    };
    this._confirmTimers.set(capability, this.homey.setTimeout(check, delays.shift()));
  }
  _assertReady() {
    if (!this.client) throw new Error('The Leapmotor connection is not ready yet, try again in a moment.');
    if (!this.vin) throw new Error('No VIN is configured for this vehicle.');
  }
  _resolveMethod(candidates) {
    for (const candidate of candidates) {
      if (this.client && typeof this.client[candidate] === 'function') return candidate;
    }
    return null;
  }
  _invokeCommand(command, params) {
    const method = this._resolveMethod(COMMAND_METHODS);
    if (!method) return Promise.reject(new Error('The Leapmotor client does not expose a remote command method.'));
    return Promise.resolve(this.client[method](this.vin, command, params || {}, this.carType));
  }
  _invokeRawCommand(cmdId, cmdContent, requiresPin) {
    const method = this._resolveMethod(RAW_COMMAND_METHODS);
    if (!method) {
      return this._invokeCommand('raw_command', { cmdId, cmdContent, requiresPin });
    }
    return Promise.resolve(this.client[method](this.vin, cmdId, cmdContent, requiresPin, this.carType));
  }
  _invokeStatus() {
    const method = this._resolveMethod(STATUS_METHODS);
    if (!method) return Promise.reject(new Error('The Leapmotor client does not expose a status method.'));
    return Promise.resolve(this.client[method](this.vin, this.carType));
  }
  _awaitAcknowledgement(key, promise) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.homey.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.log(`Command ${key} is still being executed by the car; releasing the Homey request.`);
          resolve({ accepted: true, pending: true });
        }
      }, ACK_TIMEOUT_MS);
      promise
        .then((result) => {
          this.homey.clearTimeout(timer);
          this._pendingCommands.delete(key);
          if (!settled) {
            settled = true;
            resolve({ accepted: true, pending: false, result });
          }
        })
        .catch((err) => {
          this.homey.clearTimeout(timer);
          this._pendingCommands.delete(key);
          this._recordError(err);
          if (settled) {
            this.error(`Command ${key} failed after Homey stopped waiting:`, err.message);
            this.setWarning(`The last command failed: ${err.message}`).catch(() => {});
            return;
          }
          settled = true;
          reject(err);
        });
    });
  }
  async runCommand(command, params) {
    this._assertReady();
    this.log(`Sending command ${command}`);
    let commandParams = params ? Object.assign({}, params) : {};
    if (command === 'set_speed_limit' || command === 'speed_limit') {
      const speedKey = commandParams.value !== undefined ? 'value' : (commandParams.speed !== undefined ? 'speed' : null);
      if (speedKey) {
        const raw = Number(commandParams[speedKey]);
        if (Number.isFinite(raw)) {
          const unit = String(commandParams.unit || '').toLowerCase();
          let kmh;
          if (unit === 'mph' || unit === 'mi') {
            kmh = raw * Units.DIVISOR;
          } else if (unit === 'kmh' || unit === 'km') {
            kmh = raw;
          } else {
            kmh = this._isImperial() ? raw * Units.DIVISOR : raw;
          }
          commandParams[speedKey] = Math.round(kmh);
        }
      }
      delete commandParams.unit;
    }
    if (command === 'send_address') {
      const addr = String(commandParams.address || '').trim();
      const name = String(commandParams.name || addr).trim();
      commandParams = { address: addr, addressname: name, latitude: 0, longitude: 0 };
      command = 'send_destination';
    }
    if (command === 'send_coordinates') {
      const lat = Number(commandParams.latitude);
      const lon = Number(commandParams.longitude);
      const name = String(commandParams.name || `${lat},${lon}`).trim();
      const latStr = Number.isFinite(lat) ? String(lat) : '0';
      const lonStr = Number.isFinite(lon) ? String(lon) : '0';
      commandParams = { address: name, addressname: name, latitude: latStr, longitude: lonStr };
      command = 'send_destination';
    }
    const promise = this._invokeCommand(command, commandParams);
    this._pendingCommands.set(command, promise);
    return this._awaitAcknowledgement(command, promise);
  }
  async runRawCommand(cmdId, cmdContent, requiresPin) {
    this._assertReady();
    const key = `raw:${cmdId}`;
    this.log(`Sending raw command ${cmdId}`);
    const promise = this._invokeRawCommand(cmdId, cmdContent, requiresPin !== false);
    this._pendingCommands.set(key, promise);
    return this._awaitAcknowledgement(key, promise);
  }
  _toCapabilityValues(status) {
    if (!status || typeof status !== 'object') return {};
    for (const key of ['values', 'capabilities', 'capabilityValues', 'mapped']) {
      if (status[key] && typeof status[key] === 'object') return status[key];
    }
    if (Object.keys(status).some((key) => this.hasCapability(key))) return status;
    return StatusMapper.map(status.raw || status.data || status.status || status);
  }
  async _applyValues(values) {
    const previousLatitude = this.getCapabilityValue('leapmotor_latitude');
    const previousLongitude = this.getCapabilityValue('leapmotor_longitude');
    const previousWindows = this.getCapabilityValue('leapmotor_windows');
    const previousPlug = this.getCapabilityValue('leapmotor_plug_type');
    const previousLocked = this.getCapabilityValue('leapmotor_locked');
    const previousCharging = this.getCapabilityValue('leapmotor_charging');
    const previousPower = this.getCapabilityValue('leapmotor_charging_power_kw');
    const previousRange = this.getCapabilityValue('measure_range');
    const previousChargeRemaining = this.getCapabilityValue('leapmotor_charge_remaining');
    const previousSpeed = this.getCapabilityValue('leapmotor_speed');
    const previousDoors = this.getCapabilityValue('leapmotor_doors');
    const previousBoot = this.getCapabilityValue('leapmotor_boot_control');
    const previousSunshade = this.getCapabilityValue('leapmotor_sunshade');
    const isImperial = this._isImperial();
    const prevPressures = {
      front_left: this.getCapabilityValue('leapmotor_tire_pressure_front_left'),
      front_right: this.getCapabilityValue('leapmotor_tire_pressure_front_right'),
      rear_left: this.getCapabilityValue('leapmotor_tire_pressure_rear_left'),
      rear_right: this.getCapabilityValue('leapmotor_tire_pressure_rear_right'),
      average: this.getCapabilityValue('leapmotor_tire_pressure_average')
    };
    for (const [capability, value] of Object.entries(values || {})) {
      if (value === null || value === undefined) continue;
      if (!this.hasCapability(capability)) continue;
      let displayValue = value;
      if (typeof value === 'number') {
        displayValue = Units.toDisplay(capability, value, isImperial);
        if (capability === 'measure_range') {
          if (value !== this._lastRangeKm) {
            this._lastRangeKm = value;
            this.setStoreValue('lastRangeKm', value).catch(() => {});
          }
          displayValue = this._applyRangeCorrection(displayValue);
        }
      }
      if (this.getCapabilityValue(capability) === displayValue) continue;
      try {
        await this.setCapabilityValue(capability, displayValue);
      } catch (err) {
        this.error('Failed to set capability', capability, err.message);
      }
    }
    const latitude = this.getCapabilityValue('leapmotor_latitude');
    const longitude = this.getCapabilityValue('leapmotor_longitude');
    const newWindows = this.getCapabilityValue('leapmotor_windows');
    const newPlug = this.getCapabilityValue('leapmotor_plug_type');
    const newLocked = this.getCapabilityValue('leapmotor_locked');
    const newCharging = this.getCapabilityValue('leapmotor_charging');
    const newPower = this.getCapabilityValue('leapmotor_charging_power_kw');
    const newRange = this.getCapabilityValue('measure_range');
    const newChargeRemaining = this.getCapabilityValue('leapmotor_charge_remaining');
    const newSpeed = this.getCapabilityValue('leapmotor_speed');
    const newDoors = this.getCapabilityValue('leapmotor_doors');
    const newBoot = this.getCapabilityValue('leapmotor_boot_control');
    const newSunshade = this.getCapabilityValue('leapmotor_sunshade');
    const soc = this.getCapabilityValue('measure_battery');
    if (typeof latitude === 'number' && typeof longitude === 'number' && (latitude !== previousLatitude || longitude !== previousLongitude)) {
      const tokens = { latitude, longitude };
      const state = { latitude, longitude };
      try {
        await this.homey.flow.getDeviceTriggerCard('location_changed').trigger(this, tokens, state);
      } catch (err) {
        this.error('Failed to trigger the location card:', err.message);
      }
      try {
        await this.homey.flow.getDeviceTriggerCard('geofence_entered').trigger(this, tokens, state);
      } catch (err) {
      }
      try {
        await this.homey.flow.getDeviceTriggerCard('geofence_exited').trigger(this, tokens, state);
      } catch (err) {
      }
    }
    if ((newWindows === 'open' || newWindows === 'closed') && newWindows !== previousWindows && previousWindows !== null && previousWindows !== undefined) {
      const cardId = newWindows === 'open' ? 'windows_opened' : 'windows_closed';
      try {
        await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, {}, {});
      } catch (err) {
        this.error('Failed to trigger the windows card:', err.message);
      }
    }
    if ((newPlug === 'no' || newPlug === 'ccs' || newPlug === 'type2') && newPlug !== previousPlug && previousPlug !== null && previousPlug !== undefined) {
      const plugLabels = { no: 'Unplugged', ccs: 'CCS', type2: 'Type2' };
      try {
        await this.homey.flow.getDeviceTriggerCard('plug_type_changed').trigger(this, { type: plugLabels[newPlug] || newPlug }, { type: newPlug });
      } catch (err) {
        this.error('Failed to trigger the plug type card:', err.message);
      }
    }
    const pressureMap = {
      front_left: 'leapmotor_tire_pressure_front_left',
      front_right: 'leapmotor_tire_pressure_front_right',
      rear_left: 'leapmotor_tire_pressure_rear_left',
      rear_right: 'leapmotor_tire_pressure_rear_right',
      average: 'leapmotor_tire_pressure_average'
    };
    for (const [tireId, cap] of Object.entries(pressureMap)) {
      if (!this.hasCapability(cap)) continue;
      const newVal = this.getCapabilityValue(cap);
      const oldVal = prevPressures[tireId];
      if (typeof newVal !== 'number' || !Number.isFinite(newVal)) continue;
      if (oldVal === null || oldVal === undefined) continue;
      if (newVal === oldVal) continue;
      try {
        await this.homey.flow.getDeviceTriggerCard('tire_pressure_changed').trigger(this, { pressure: newVal, tire: tireId, unit: 'bar' }, { tire: tireId });
      } catch (err) {
        this.error('Failed to trigger tire pressure card:', err.message);
      }
      try {
        await this.homey.flow.getDeviceTriggerCard('tire_pressure_low').trigger(this, { tire: tireId, pressure: newVal }, { tire: tireId, pressure: newVal });
      } catch (err) {
      }
    }
    if (typeof newChargeRemaining === 'number' && Number.isFinite(newChargeRemaining) && newChargeRemaining !== previousChargeRemaining) {
      try {
        await this.homey.flow.getDeviceTriggerCard('charge_remaining_changed').trigger(this, { remaining: newChargeRemaining }, {});
      } catch (err) {
      }
      try {
        await this.homey.flow.getDeviceTriggerCard('charge_remaining_below').trigger(this, { remaining: newChargeRemaining, unit: 'minutes' }, { remaining: newChargeRemaining });
      } catch (err) {
      }
    }
    if (typeof newPower === 'number' && typeof previousPower === 'number' && newPower !== previousPower) {
      try {
        await this.homey.flow.getDeviceTriggerCard('charging_power_below').trigger(this, { power: newPower, previous_power: previousPower }, { power: newPower, previous_power: previousPower });
      } catch (err) {
      }
    }
    if (previousCharging !== null && previousCharging !== undefined && newCharging !== null && newCharging !== undefined && previousCharging !== newCharging) {
      if (previousCharging === false && newCharging === true) {
        try {
          await this.homey.flow.getDeviceTriggerCard('charging_started').trigger(this, { power: newPower || 0, soc: soc || 0 }, {});
        } catch (err) {
        }
      }
      if (previousCharging === true && newCharging === false) {
        try {
          await this.homey.flow.getDeviceTriggerCard('charging_stopped').trigger(this, { power: newPower || 0, soc: soc || 0 }, {});
        } catch (err) {
        }
        try {
          await this.homey.flow.getDeviceTriggerCard('charging_completed').trigger(this, { soc: soc || 0, range: newRange || 0 }, {});
        } catch (err) {
        }
      }
    }
    const openingTriggers = [];
    if (previousDoors !== null && previousDoors !== undefined && newDoors !== null && newDoors !== undefined && previousDoors !== newDoors) {
      openingTriggers.push({ item: 'door', state: newDoors === 'open' ? 'opened' : 'closed' });
    }
    if (previousBoot !== null && previousBoot !== undefined && newBoot !== null && newBoot !== undefined && previousBoot !== newBoot) {
      openingTriggers.push({ item: 'trunk', state: newBoot === true ? 'opened' : 'closed' });
    }
    if (previousWindows !== null && previousWindows !== undefined && newWindows !== null && newWindows !== undefined && previousWindows !== newWindows) {
      openingTriggers.push({ item: 'window', state: newWindows === 'open' ? 'opened' : 'closed' });
    }
    if (previousSunshade !== null && previousSunshade !== undefined && newSunshade !== null && newSunshade !== undefined && previousSunshade !== newSunshade) {
      openingTriggers.push({ item: 'sunshade', state: newSunshade === true ? 'opened' : 'closed' });
    }
    for (const trig of openingTriggers) {
      try {
        await this.homey.flow.getDeviceTriggerCard('opening_changed').trigger(this, { item: trig.item, state: trig.state }, { item: trig.item, state: trig.state });
      } catch (err) {
      }
    }
    if (typeof previousLocked === 'boolean' && typeof newLocked === 'boolean' && previousLocked !== newLocked) {
      const card = newLocked === true ? 'car_locked' : 'car_unlocked';
      try {
        await this.homey.flow.getDeviceTriggerCard(card).trigger(this, {}, {});
      } catch (err) {
      }
    }
    if (typeof previousSpeed === 'number' && typeof newSpeed === 'number' && previousSpeed !== newSpeed) {
      if (previousSpeed !== 0 && newSpeed === 0) {
        try {
          await this.homey.flow.getDeviceTriggerCard('car_parked').trigger(this, { speed: newSpeed }, {});
        } catch (err) {
        }
      }
      if (previousSpeed === 0 && newSpeed !== 0) {
        try {
          await this.homey.flow.getDeviceTriggerCard('car_moving').trigger(this, { speed: newSpeed }, {});
        } catch (err) {
        }
      }
    }
    if (typeof previousRange === 'number' && typeof newRange === 'number' && newRange !== previousRange) {
      const unit = this._isImperial() ? 'mi' : 'km';
      try {
        await this.homey.flow.getDeviceTriggerCard('range_dropped_below').trigger(this, { range: newRange, unit }, { range: newRange, unit });
      } catch (err) {
      }
      try {
        await this.homey.flow.getDeviceTriggerCard('range_rose_above').trigger(this, { range: newRange, unit }, { range: newRange, unit });
      } catch (err) {
      }
    }
  }
  _timezone() {
    try {
      return this.homey.clock.getTimezone();
    } catch (err) {
      return undefined;
    }
  }
  _vehicleInfoContext() {
    const settings = this.getSettings();
    const state = this.client && this.client.state && typeof this.client.state === 'object' ? this.client.state : {};
    return {
      vin: this.vin,
      carType: this.carType,
      statusPath: this.getStoreValue('statusPath') || Constants.vehicleStatusPath(this.carType),
      name: this.getName(),
      username: settings.username,
      language: settings.language || Constants.DEFAULT_LANGUAGE,
      baseUrl: settings.baseUrl || Constants.DEFAULT_BASE_URL,
      appVersion: Constants.DEFAULT_APP_VERSION,
      userId: state.userId || null,
      deviceId: state.deviceId || (this.client && typeof this.client.deviceId === 'function' ? this.client.deviceId() : null),
      timezone: this._timezone()
    };
  }
  getStoredVehicleInfo() {
    const stored = this.getStoreValue(VEHICLE_INFO_STORE_KEY);
    if (!stored || typeof stored !== 'object') return null;
    return stored;
  }
  async refreshVehicleInfo(rethrow) {
    if (!this.client) {
      const err = new Error('The Leapmotor connection is not ready yet, try again in a moment.');
      if (rethrow) throw err;
      return this.getStoredVehicleInfo();
    }
    if (!this.vin) {
      const err = new Error('No VIN is configured for this vehicle.');
      if (rethrow) throw err;
      return this.getStoredVehicleInfo();
    }
    try {
      const vehicle = await this.client.findVehicleByVin(this.vin);
      const snapshot = VehicleInfo.buildSnapshot(vehicle, this._vehicleInfoContext());
      await this.setStoreValue(VEHICLE_INFO_STORE_KEY, snapshot);
      await this._storeInfo(VehicleInfo.toSettings(snapshot));
      return snapshot;
    } catch (err) {
      this.error('Failed to refresh the vehicle information:', err.message);
      if (rethrow) throw err;
      return this.getStoredVehicleInfo();
    }
  }
  _scheduleVehicleInfoRefresh(delayMs) {
    if (this._destroyed) return;
    if (this._vehicleInfoTimer) {
      this.homey.clearTimeout(this._vehicleInfoTimer);
      this._vehicleInfoTimer = null;
    }
    const stored = this.getStoredVehicleInfo();
    const age = stored && Number.isFinite(stored.generatedAt) ? Date.now() - stored.generatedAt : Infinity;
    if (age < VEHICLE_INFO_MAX_AGE_MS) return;
    const delay = Number.isFinite(delayMs) ? Math.max(delayMs, 1000) : 10000;
    this._vehicleInfoTimer = this.homey.setTimeout(async () => {
      this._vehicleInfoTimer = null;
      await this.refreshVehicleInfo(false);
    }, delay);
  }
  _formatNow() {
    try {
      return new Date().toLocaleString('en-GB', { timeZone: this.homey.clock.getTimezone() });
    } catch (err) {
      return new Date().toISOString();
    }
  }
  _formatTime(ms) {
    try {
      return new Date(ms).toLocaleString('en-GB', { timeZone: this.homey.clock.getTimezone() });
    } catch (err) {
      return new Date(ms).toISOString();
    }
  }
  async _storeInfo(info) {
    try {
      await this.setSettings(info);
    } catch (err) {
      this.error('Failed to store the status information:', err.message);
    }
  }
  _recordError(err) {
    const message = err && err.message || String(err);
    this._storeInfo({ lastError: `${this._formatNow()} - ${message}` }).catch(() => {});
  }
  async refreshStatus(rethrow) {
    if (!this._refreshPromise) {
      this._refreshPromise = this._refreshStatusOnce(rethrow === true).finally(() => {
        this._refreshPromise = null;
      });
    }
    return this._refreshPromise;
  }
  async _refreshStatusOnce(rethrow) {
    this._assertReady();
    try {
      const status = await this._invokeStatus();
      const values = this._toCapabilityValues(status);
      await this._applyValues(values);
      this._failureCount = 0;
      if (!this.getAvailable()) await this.setAvailable();
      const reportMs = values.__reportTime && Number.isFinite(values.__reportTime) ? values.__reportTime : null;
      const effectiveMs = reportMs || Date.now();
      this._lastUpdateAt = effectiveMs;
      try {
        await this.setStoreValue('lastUpdateAt', this._lastUpdateAt);
      } catch (err) {
      }
      const lastUpdateStr = reportMs ? this._formatTime(reportMs) : this._formatNow();
      await this._storeInfo({ lastUpdate: lastUpdateStr, lastError: '-' });
      if (this.getSetting('debugLogging')) {
        this.log('Status refreshed', JSON.stringify(values));
      }
      return values;
    } catch (err) {
      this._failureCount += 1;
      this.error(`Status refresh failed (${this._failureCount}):`, err.message);
      this._recordError(err);
      if (this._failureCount >= Constants.UNAVAILABLE_AFTER_FAILURES) {
        await this.setUnavailable(`Leapmotor cloud unreachable: ${err.message}`).catch(() => {});
      }
      if (rethrow) throw err;
      return {};
    }
  }
}
module.exports = CarDevice;
