'use strict';
const Homey = require('homey');
const Constants = require('../../lib/constants');
const ClientRegistry = require('../../lib/clientRegistry');
const StatusMapper = require('../../lib/statusMapper');
const Units = require('../../lib/units');
const VehicleInfo = require('../../lib/vehicleInfo');
const SensorLog = require('../../lib/sensorLog');
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
const CAPABILITY_LAYOUT_VERSION = 18;
const UNIT_STORE_KEY = 'distanceUnitApplied';
const OPTIONS_LAYOUT = 2;
const ACK_TIMEOUT_MS = 8000;
const CONFIRM_DELAYS_MS = [4000, 10000, 22000];
const FULLY_CHARGED_THRESHOLD = 99.9;
const MIN_REFRESH_INTERVAL_MS = 15 * 1000;
const MAX_REFRESH_INTERVAL_MS = 90 * 60 * 1000;
const MAX_REFRESH_DURATION_MIN = 60;
const OPEN_ITEM_CAPABILITIES = {
  door: 'leapmotor_doors',
  trunk: 'leapmotor_boot_control',
  window: 'leapmotor_windows',
  sunshade: 'leapmotor_sunshade'
};
const OPEN_ITEMS = ['door', 'trunk', 'window', 'sunshade'];
const LEFT_OPEN_CHECK_MS = 10000;
const OPEN_SINCE_STORE_KEY = 'openSince';
const OPEN_CLOSED_STORE_KEY = 'openClosedAt';
const COMMAND_METHODS = ['executeCommand', 'sendCommand', 'runCommand', 'remoteControl', 'sendRemoteCommand', 'command'];
const RAW_COMMAND_METHODS = ['executeRawCommand', 'sendRawCommand', 'rawCommand', 'remoteControlRaw'];
const STATUS_METHODS = ['getVehicleStatus', 'getStatus', 'vehicleStatus', 'fetchVehicleStatus'];
const VEHICLE_DETAIL_METHODS = ['getVehicleDetail', 'findVehicleByVin', 'getVehicleInfo', 'vehicleDetail'];
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
    this._tempRefreshIntervalMs = null;
    this._tempRefreshUntil = null;
    this._lastUpdateAt = this.getStoreValue('lastUpdateAt') || null;
    this._lastRangeKm = this.getStoreValue('lastRangeKm');
    if (typeof this._lastRangeKm !== 'number' || !Number.isFinite(this._lastRangeKm)) this._lastRangeKm = null;
    this._staleTimer = null;
    this._leftOpenTimer = null;
    this._vehicleInfoTimer = null;
    this._openSince = this._loadOpenStamp(OPEN_SINCE_STORE_KEY);
    this._openClosedAt = this._loadOpenStamp(OPEN_CLOSED_STORE_KEY);
    this._openEmitted = {};
    const initNow = Date.now();
    for (const item of OPEN_ITEMS) {
      if (this._openSince[item] && this._openSince[item] > initNow) {
        this._openSince[item] = initNow;
      }
    }
    this.log(`Leapmotor car device initialising: ${this.getName()}`);
    await this._migrateCapabilities();
    await this._applyUnitOptions(this.getSettings());
    this._registerCapabilityListeners();
    this._buildClient(this.getSettings());
    this._startStaleChecker();
    this._startLeftOpenWatcher();
    this._scheduleNextRefresh(5000);
    this._scheduleVehicleInfoRefresh(9000);
    this._sensorLog = new SensorLog(this);
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
    if (this._sensorLog) {
      try {
        this._sensorLog.removeFile();
      } catch (err) {
      }
      this._sensorLog = null;
    }
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
    if (this._leftOpenTimer) {
      this.homey.clearTimeout(this._leftOpenTimer);
      this._leftOpenTimer = null;
    }
    if (this._vehicleInfoTimer) {
      this.homey.clearTimeout(this._vehicleInfoTimer);
      this._vehicleInfoTimer = null;
    }
    this._tempRefreshIntervalMs = null;
    this._tempRefreshUntil = null;
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
  _loadOpenStamp(key) {
    const state = {};
    const stored = this.getStoreValue(key);
    if (!stored || typeof stored !== 'object') return state;
    Object.keys(stored).forEach((item) => {
      if (OPEN_ITEMS.indexOf(item) === -1) return;
      const value = Number(stored[item]);
      if (Number.isFinite(value)) state[item] = value;
    });
    return state;
  }
  _isOpenNow(item) {
    const capability = OPEN_ITEM_CAPABILITIES[item];
    if (!capability || !this.hasCapability(capability)) return null;
    const value = this.getCapabilityValue(capability);
    if (capability === 'leapmotor_doors' || capability === 'leapmotor_windows') {
      if (value === 'open' || value === true || value === '1' || value === 1) return true;
      if (value === 'closed' || value === false || value === '0' || value === 0) return false;
      return null;
    }
    if (value === true || value === 'open' || value === 'opened' || value === '1' || value === 1) return true;
    if (value === false || value === 'closed' || value === '0' || value === 0) return false;
    return null;
  }
  _openMinutes(since, now) {
    if (!Number.isFinite(since)) return null;
    if (now <= since) return 0;
    return Math.floor((now - since) / 60000);
  }
  async _emitLeftOpen(item, minutes) {
    if (this.getSetting('debugLogging')) {
      this.log(`Left open check: ${item} open for ${minutes} minute(s)`);
    }
    try {
      await this.homey.flow.getDeviceTriggerCard('opening_left_open').trigger(
        this,
        { item, open_minutes: minutes },
        { item, minutes }
      );
    } catch (err) {
      this.error(`Could not trigger the left open card for ${item}: ${err.message}`);
    }
  }
  async _updateOpenTracking(reportTime) {
    const now = Date.now();
    let changed = false;
    for (const item of OPEN_ITEMS) {
      const open = this._isOpenNow(item);
      if (open === false) {
        if (this._openClosedAt[item] !== now) {
          this._openClosedAt[item] = now;
          changed = true;
        }
        if (this._openSince[item] !== undefined) {
          delete this._openSince[item];
          delete this._openEmitted[item];
          changed = true;
          await this._emitLeftOpen(item, 0);
        }
        continue;
      }
      if (open !== true) continue;
      if (!Number.isFinite(this._openSince[item])) {
        this._openSince[item] = now;
        this._openEmitted[item] = 0;
        changed = true;
        await this._emitLeftOpen(item, 0);
      } else {
        const minutes = this._openMinutes(this._openSince[item], now);
        if (minutes !== null && this._openEmitted[item] !== minutes) {
          this._openEmitted[item] = minutes;
          await this._emitLeftOpen(item, minutes);
        }
      }
    }
    if (changed) {
      this.setStoreValue(OPEN_SINCE_STORE_KEY, this._openSince).catch(() => {});
      this.setStoreValue(OPEN_CLOSED_STORE_KEY, this._openClosedAt).catch(() => {});
    }
  }
  async _evaluateLeftOpen() {
    const now = Date.now();
    for (const item of OPEN_ITEMS) {
      const open = this._isOpenNow(item);
      if (open !== true) {
        if (this._openSince[item] !== undefined) {
          delete this._openSince[item];
          delete this._openEmitted[item];
          await this._emitLeftOpen(item, 0);
        }
        continue;
      }
      if (!Number.isFinite(this._openSince[item])) {
        this._openSince[item] = now;
        this._openEmitted[item] = 0;
        await this._emitLeftOpen(item, 0);
        continue;
      }
      const minutes = this._openMinutes(this._openSince[item], now);
      if (minutes === null || this._openEmitted[item] === minutes) continue;
      this._openEmitted[item] = minutes;
      await this._emitLeftOpen(item, minutes);
    }
  }
  _startLeftOpenWatcher() {
    if (this._leftOpenTimer) {
      this.homey.clearTimeout(this._leftOpenTimer);
      this._leftOpenTimer = null;
    }
    const loop = async () => {
      if (this._destroyed) return;
      try {
        await this._evaluateLeftOpen();
      } catch (err) {
        this.error('The left open check failed:', err.message);
      }
      if (!this._destroyed) {
        this._leftOpenTimer = this.homey.setTimeout(loop, LEFT_OPEN_CHECK_MS);
      }
    };
    this._leftOpenTimer = this.homey.setTimeout(loop, LEFT_OPEN_CHECK_MS);
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
    let delay;
    if (Number.isFinite(delayMs)) {
      delay = Math.max(delayMs, 1000);
    } else if (this._tempRefreshIntervalMs && this._tempRefreshUntil && Date.now() < this._tempRefreshUntil) {
      const remaining = this._tempRefreshUntil - Date.now();
      delay = Math.min(this._tempRefreshIntervalMs, Math.max(remaining, 1000));
    } else {
      if (this._tempRefreshUntil && Date.now() >= this._tempRefreshUntil) {
        this._tempRefreshUntil = null;
        this._tempRefreshIntervalMs = null;
      }
      delay = Math.max(60 * this._currentIntervalMinutes() * 1000, 60000);
    }
    this._refreshTimer = this.homey.setTimeout(async () => {
      this._refreshTimer = null;
      if (this._tempRefreshUntil && Date.now() >= this._tempRefreshUntil) {
        this._tempRefreshUntil = null;
        this._tempRefreshIntervalMs = null;
      }
      try {
        await this.refreshStatus(false);
      } catch (err) {
        this.error('Scheduled refresh failed:', err.message);
      }
      this._scheduleNextRefresh();
    }, delay);
  }
  async setTemporaryRefreshRate(rate, unit, durationMinutes) {
    const rateNumber = Number(rate);
    const durationNumber = Number(durationMinutes);
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      throw new Error('Enter a refresh rate between 15 and 5400 seconds.');
    }
    if (!Number.isFinite(durationNumber) || durationNumber <= 0) {
      throw new Error('Enter a duration in minutes between 1 and 60.');
    }
    const intervalMs = unit === 'minutes' ? rateNumber * 60000 : rateNumber * 1000;
    const clampedIntervalMs = Math.min(Math.max(intervalMs, MIN_REFRESH_INTERVAL_MS), MAX_REFRESH_INTERVAL_MS);
    const clampedDurationMs = Math.min(Math.max(durationNumber, 1), MAX_REFRESH_DURATION_MIN) * 60000;
    this._tempRefreshIntervalMs = clampedIntervalMs;
    this._tempRefreshUntil = Date.now() + clampedDurationMs;
    this.log(`Temporary refresh rate: ${Math.round(clampedIntervalMs / 1000)} seconds for ${Math.round(clampedDurationMs / 60000)} minutes.`);
    this._scheduleNextRefresh(1000);
    return true;
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
  _invokeVehicleDetail() {
    const method = this._resolveMethod(VEHICLE_DETAIL_METHODS);
    if (!method) return Promise.reject(new Error('The Leapmotor client does not expose a vehicle detail method.'));
    return Promise.resolve(this.client[method](this.vin, this.carType));
  }
  _clientUserId() {
    if (!this.client) return null;
    if (typeof this.client.userId === 'function') return this.client.userId();
    if (this.client.state && this.client.state.userId) return this.client.state.userId;
    return this.client.userId || null;
  }
  _clientDeviceId() {
    if (!this.client) return null;
    if (typeof this.client.deviceId === 'function') return this.client.deviceId();
    if (this.client.state && this.client.state.deviceId) return this.client.state.deviceId;
    return this.client.deviceId || null;
  }
  _homeyTimezone() {
    try {
      return this.homey.clock.getTimezone();
    } catch (err) {
      return undefined;
    }
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
    const previousGear = this.getCapabilityValue('leapmotor_gear');
    const previousLocked = this.getCapabilityValue('leapmotor_locked');
    const previousCharging = this.getCapabilityValue('leapmotor_charging');
    const previousPower = this.getCapabilityValue('leapmotor_charging_power_kw');
    const previousRange = this.getCapabilityValue('measure_range');
    const previousChargeRemaining = this.getCapabilityValue('leapmotor_charge_remaining');
    const previousSpeed = this.getCapabilityValue('leapmotor_speed');
    const previousDoors = this.getCapabilityValue('leapmotor_doors');
    const previousBoot = this.getCapabilityValue('leapmotor_boot_control');
    const previousSunshade = this.getCapabilityValue('leapmotor_sunshade');
    const previousSoc = this.getCapabilityValue('measure_battery');
    const isImperial = this._isImperial();
    const prevPressures = {
      front_left: this.getCapabilityValue('leapmotor_tire_pressure_front_left'),
      front_right: this.getCapabilityValue('leapmotor_tire_pressure_front_right'),
      rear_left: this.getCapabilityValue('leapmotor_tire_pressure_rear_left'),
      rear_right: this.getCapabilityValue('leapmotor_tire_pressure_rear_right'),
      average: this.getCapabilityValue('leapmotor_tire_pressure_average')
    };
    for (const [capability, value] of Object.entries(values || {})) {
      if (value === undefined) continue;
      if (value === null) {
        if (this.hasCapability(capability) && this.getCapabilityValue(capability) !== null) {
          try {
            await this.setCapabilityValue(capability, null);
          } catch (err) {
            this.error('Failed to clear capability', capability, err.message);
          }
        }
        continue;
      }
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
    const newGear = this.getCapabilityValue('leapmotor_gear');
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
    if ((newGear === 'park' || newGear === 'drive' || newGear === 'neutral' || newGear === 'reverse') && newGear !== previousGear && previousGear !== null && previousGear !== undefined) {
      const gearLabels = { park: 'Park', drive: 'Drive', neutral: 'Neutral', reverse: 'Reverse' };
      try {
        await this.homey.flow.getDeviceTriggerCard('gear_changed').trigger(this, { gear: gearLabels[newGear] || newGear }, { gear: newGear });
      } catch (err) {
        this.error('Failed to trigger the gear card:', err.message);
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
    if (typeof previousSoc === 'number' && Number.isFinite(previousSoc)
      && typeof soc === 'number' && Number.isFinite(soc)
      && previousSoc < FULLY_CHARGED_THRESHOLD && soc >= FULLY_CHARGED_THRESHOLD) {
      try {
        await this.homey.flow.getDeviceTriggerCard('fully_charged').trigger(this, { soc, range: newRange || 0 }, {});
      } catch (err) {
        this.error('Failed to trigger the fully charged card:', err.message);
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
      if (previousSpeed === 0 && newSpeed > 0) {
        try {
          await this.homey.flow.getDeviceTriggerCard('car_moving').trigger(this, { speed: newSpeed }, {});
        } catch (err) {
        }
      }
    }
    await this._updateOpenTracking(values && values.__reportTime);
  }
  async refreshStatus(force) {
    if (this._destroyed) return null;
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = (async () => {
      this._assertReady();
      try {
        const rawStatus = await this._invokeStatus();
        const values = this._toCapabilityValues(rawStatus);
        await this._applyValues(values);
        this._lastUpdateAt = Date.now();
        await this.setStoreValue('lastUpdateAt', this._lastUpdateAt);
        if (this.hasCapability('leapmotor_refresh')) {
          await this.setCapabilityValue('leapmotor_refresh', false).catch(() => {});
        }
        await this.setSettings({
          lastUpdate: new Date(this._lastUpdateAt).toLocaleString(),
          lastError: '-'
        }).catch(() => {});
        if (this._sensorLog) {
          try {
            if (typeof this._sensorLog.record === 'function') {
              await this._sensorLog.record(rawStatus, values);
            } else if (typeof this._sensorLog.append === 'function') {
              this._sensorLog.append(values, new Date(this._lastUpdateAt).toISOString());
            }
          } catch (err) {
            this.error('Failed to write the sensor log:', err.message);
          }
        }
        this._failureCount = 0;
        await this.unsetWarning().catch(() => {});
        return values;
      } catch (err) {
        this._failureCount += 1;
        this._recordError(err);
        throw err;
      } finally {
        this._refreshPromise = null;
      }
    })();
    return this._refreshPromise;
  }
  _scheduleVehicleInfoRefresh(delayMs) {
    if (this._destroyed) return;
    if (this._vehicleInfoTimer) {
      this.homey.clearTimeout(this._vehicleInfoTimer);
      this._vehicleInfoTimer = null;
    }
    const delay = Number.isFinite(delayMs) ? delayMs : VEHICLE_INFO_MAX_AGE_MS;
    this._vehicleInfoTimer = this.homey.setTimeout(async () => {
      this._vehicleInfoTimer = null;
      try {
        await this.refreshVehicleInfo(false);
      } catch (err) {
      }
      this._scheduleVehicleInfoRefresh();
    }, delay);
  }
  async refreshVehicleInfo(force) {
    this._assertReady();
    const stored = this.getStoredVehicleInfo();
    if (!force && stored && stored.generatedAt && Date.now() - stored.generatedAt < VEHICLE_INFO_MAX_AGE_MS) {
      return stored;
    }
    const raw = await this._invokeVehicleDetail();
    const snapshot = VehicleInfo.buildSnapshot(raw, {
      vin: this.vin,
      carType: this.carType,
      name: this.getName(),
      userId: this._clientUserId(),
      deviceId: this._clientDeviceId(),
      username: this.getSetting('username'),
      language: this.getSetting('language'),
      baseUrl: this.getSetting('baseUrl'),
      statusPath: this.getStoreValue('statusPath'),
      timezone: this._homeyTimezone()
    });
    await this.setStoreValue(VEHICLE_INFO_STORE_KEY, snapshot);
    const newSettings = VehicleInfo.toSettings(snapshot);
    try {
      await this.setSettings(newSettings);
    } catch (err) {
      this.error('Failed to store the vehicle information settings:', err.message);
    }
    this._scheduleVehicleInfoRefresh();
    return snapshot;
  }
  getStoredVehicleInfo() {
    return this.getStoreValue(VEHICLE_INFO_STORE_KEY) || null;
  }
  getSensorLogState() {
    return this._sensorLog ? this._sensorLog.getState() : { enabled: false, filename: null, exists: false, size: 0, sizeText: '0 B', rows: 0, full: false };
  }
  async setSensorLogEnabled(enabled) {
    if (this._sensorLog) await this._sensorLog.setEnabled(enabled);
  }
  async setSensorLogColumns(columns) {
    if (this._sensorLog) await this._sensorLog.setColumns(columns);
  }
  async clearSensorLog() {
    if (this._sensorLog) await this._sensorLog.clear();
  }
  readSensorLogChunk(offset, length) {
    return this._sensorLog ? this._sensorLog.readChunk(offset, length) : { chunk: '', done: true, size: 0 };
  }
  _recordError(err) {
    const msg = (err && (err.message || err.error)) || String(err || 'Unknown error');
    this.error('Leapmotor device error:', msg);
    this.setSettings({ lastError: msg }).catch(() => {});
  }
  async setWarning(message) {
    return super.setWarning(message);
  }
  async unsetWarning() {
    return super.unsetWarning();
  }
}
module.exports = CarDevice;
