'use strict';
const Homey = require('homey');
class LeapmotorApp extends Homey.App {
  async onInit() {
    this.log('Leapmotor app is starting');
    this._geofenceState = new Map();
    this._powerBelowState = new Map();
    this._tireBelowState = new Map();
    this._rangeBelowState = new Map();
    this._chargeRemainingBelowState = new Map();
    this._rangeAboveState = new Map();
    this._dataStaleState = new Map();
    this._registerFlowCards();
    this.log('Leapmotor app has been initialised');
  }
  _device(args) {
    const device = args && args.device;
    if (!device) throw new Error('This Flow card is not linked to a Leapmotor device any more.');
    return device;
  }
  _action(id, handler) {
    try {
      this.homey.flow.getActionCard(id).registerRunListener(async (args, state) => {
        await handler(this._device(args), args, state);
        return true;
      });
    } catch (err) {
      this.error(`Could not register action card "${id}": ${err.message}`);
    }
  }
  _condition(id, handler) {
    try {
      this.homey.flow.getConditionCard(id).registerRunListener(async (args, state) => {
        return handler(this._device(args), args, state);
      });
    } catch (err) {
      this.error(`Could not register condition card "${id}": ${err.message}`);
    }
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
  _radiusToMeters(radius, unit) {
    const r = Number(radius);
    if (unit === 'km') return r * 1000;
    if (unit === 'mi') return r * 1609.344;
    if (unit === 'ft') return r * 0.3048;
    return r;
  }
  _deviceId(args) {
    try {
      const d = args && args.device;
      if (!d) return 'unknown';
      const data = typeof d.getData === 'function' ? d.getData() : null;
      if (data && data.id) return String(data.id);
      if (d.id) return String(d.id);
      if (typeof d.getName === 'function') return String(d.getName());
      return 'unknown';
    } catch (err) {
      return 'unknown';
    }
  }
  _registerFlowCards() {
    const simple = (id, command) => this._action(id, (device) => device.runCommand(command));
    [
      ['lock', 'lock'],
      ['unlock', 'unlock'],
      ['find_car', 'find_car'],
      ['open_trunk', 'open_trunk'],
      ['close_trunk', 'close_trunk'],
      ['open_windows', 'open_windows'],
      ['close_windows', 'close_windows'],
      ['open_sunroof', 'open_sunroof'],
      ['close_sunroof', 'close_sunroof'],
      ['open_sunshade', 'open_sunshade'],
      ['close_sunshade', 'close_sunshade'],
      ['quick_cool', 'quick_cool'],
      ['quick_heat', 'quick_heat'],
      ['windshield_defrost', 'windshield_defrost'],
      ['climate_off', 'ac_off'],
      ['ventilation_off', 'ventilation_off'],
      ['unlock_charger', 'unlock_charger'],
      ['steering_wheel_heat_on', 'steering_wheel_heat_on'],
      ['steering_wheel_heat_off', 'steering_wheel_heat_off'],
      ['battery_preheat_on', 'battery_preheat_on'],
      ['battery_preheat_off', 'battery_preheat_off'],
      ['mirror_heat_on', 'rearview_mirror_heat_on'],
      ['mirror_heat_off', 'rearview_mirror_heat_off'],
      ['ble_key_restart', 'ble_key_restart'],
      ['sentry_mode_on', 'sentry_mode_on'],
      ['sentry_mode_off', 'sentry_mode_off'],
      ['healthy_charging_on', 'healthy_charging_on'],
      ['healthy_charging_off', 'healthy_charging_off']
    ].forEach(([id, command]) => simple(id, command));
    this._action('start_charging', (device) => device.runCommand(
      device.getSetting('chargeToggleMode') === 'chargePlan' ? 'start_charging_plan_clear' : 'start_charging'
    ));
    this._action('stop_charging', (device) => device.runCommand(
      device.getSetting('chargeToggleMode') === 'chargePlan' ? 'stop_charging_plan_block' : 'stop_charging'
    ));
    this._action('refresh_status', (device) => device.refreshStatus(true));
    this._action('set_climate', (device, args) => device.runCommand('ac_on', {
      temperature: args.temperature
    }));
    this._action('set_climate_complex', (device, args) => device.runCommand('set_climate_complex', {
      temperature: args.temperature,
      windlevel: args.windlevel,
      mode: args.mode,
      circle: args.circle,
      operate: args.operate,
      position: args.position,
      wshld: args.wshld
    }));
    this._action('set_charge_limit', (device, args) => device.runCommand('set_charge_limit', {
      charge_limit_percent: args.percentage
    }));
    this._action('seat_heat', (device, args) => device.runCommand('seat_heat', {
      position: parseInt(args.position, 10),
      level: parseInt(args.level, 10)
    }));
    this._action('seat_ventilation', (device, args) => device.runCommand('seat_ventilation', {
      position: parseInt(args.position, 10),
      level: parseInt(args.level, 10)
    }));
    this._action('seat_adjust', (device, args) => device.runCommand('seat_adjust', {
      position: args.seat,
      seat: args.seat,
      adjustment: args.adjustment
    }));
    this._action('send_coordinates', (device, args) => device.runCommand('send_coordinates', {
      latitude: args.latitude,
      longitude: args.longitude,
      name: args.name || `${args.latitude},${args.longitude}`
    }));
    this._action('set_speed_limit', (device, args) => device.runCommand('set_speed_limit', {
      value: args.speed
    }));
    this._action('set_speed_limit_mph', (device, args) => device.runCommand('set_speed_limit', {
      value: args.speed,
      unit: 'mph'
    }));
    this._action('set_charge_plan', (device, args) => {
      const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const selected = Array.isArray(args.cycles) ? args.cycles : [];
      const cycles = dayOrder.map((day) => (selected.indexOf(day) !== -1 ? '1' : '0')).join(',');
      return device.runCommand('charge_plan', {
        chargeEnable: args.chargeEnable === undefined ? 1 : (args.chargeEnable === true || String(args.chargeEnable) === '1' ? 1 : 0),
        starttime: typeof args.starttime === 'string' ? args.starttime.trim() : '',
        endtime: typeof args.endtime === 'string' ? args.endtime.trim() : '',
        chargesoc: Number(args.chargesoc),
        circulation: selected.length > 0 ? 1 : 0,
        cycles: selected.length > 0 ? cycles : '',
        recharge: String(args.recharge) === '1' || args.recharge === true ? 1 : 0
      });
    });
    this._action('raw_command', (device, args) => device.runRawCommand(
      args.cmdId,
      args.cmdContent,
      args.requiresPin !== 'no'
    ));
    this._condition('is_charging', (device) => device.getCapabilityValue('leapmotor_charging') === true);
    this._condition('is_plugged_in', (device) => device.getCapabilityValue('leapmotor_plugged') === true);
    this._condition('plug_type', (device, args) => {
      const plug = device.getCapabilityValue('leapmotor_plug_type');
      if (args.type === 'plugged') return plug === 'type2' || plug === 'ccs';
      return plug === args.type;
    });
    this._condition('is_locked', (device) => device.getCapabilityValue('leapmotor_locked') === true);
    this._condition('windows_open', (device) => device.getCapabilityValue('leapmotor_windows') === 'open');
    this._condition('battery_below', (device, args) => {
      const soc = device.getCapabilityValue('measure_battery');
      if (typeof soc !== 'number') return false;
      return soc < Number(args.percentage);
    });
    this._condition('charging_power_above', (device, args) => {
      const power = device.getCapabilityValue('leapmotor_charging_power_kw');
      if (typeof power !== 'number') return false;
      return power > Number(args.power);
    });
    this._condition('charging_power_below', (device, args) => {
      const power = device.getCapabilityValue('leapmotor_charging_power_kw');
      if (typeof power !== 'number') return false;
      return power < Number(args.power);
    });
    this._condition('location_within_tolerance', (device, args) => {
      const lat = device.getCapabilityValue('leapmotor_latitude');
      const lon = device.getCapabilityValue('leapmotor_longitude');
      if (typeof lat !== 'number' || typeof lon !== 'number') return false;
      const latOk = Math.abs(lat - Number(args.latitude)) <= Number(args.lat_tolerance);
      const lonOk = Math.abs(lon - Number(args.longitude)) <= Number(args.lon_tolerance);
      return latOk && lonOk;
    });
    this._condition('geofence_within', (device, args) => {
      const lat = device.getCapabilityValue('leapmotor_latitude');
      const lon = device.getCapabilityValue('leapmotor_longitude');
      if (typeof lat !== 'number' || typeof lon !== 'number') return false;
      const dist = this._haversine(lat, lon, Number(args.latitude), Number(args.longitude));
      const radiusM = this._radiusToMeters(args.radius, args.unit);
      return dist <= radiusM;
    });
    this._condition('data_is_stale', (device, args) => {
      const duration = Number(args.duration);
      const unit = args.unit;
      const thresholdMin = unit === 'hours' ? duration * 60 : duration;
      const age = device.getDataAgeMinutes();
      if (age === null) return true;
      return age >= thresholdMin;
    });
    this._condition('charge_remaining_below', (device, args) => {
      const remaining = device.getCapabilityValue('leapmotor_charge_remaining');
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return false;
      const duration = Number(args.duration);
      if (!Number.isFinite(duration)) return false;
      const thresholdMin = args.unit === 'hours' ? duration * 60 : duration;
      return remaining < thresholdMin;
    });
    this._condition('charge_remaining_known', (device) => {
      const remaining = device.getCapabilityValue('leapmotor_charge_remaining');
      return typeof remaining === 'number' && Number.isFinite(remaining);
    });
    this._condition('is_parked', (device) => {
      const speed = device.getCapabilityValue('leapmotor_speed');
      if (typeof speed === 'number') return speed === 0;
      return device.isParked();
    });
    this._condition('tire_pressure_below', (device, args) => {
      const map = {
        front_left: 'leapmotor_tire_pressure_front_left',
        front_right: 'leapmotor_tire_pressure_front_right',
        rear_left: 'leapmotor_tire_pressure_rear_left',
        rear_right: 'leapmotor_tire_pressure_rear_right',
        average: 'leapmotor_tire_pressure_average'
      };
      const checkOne = (cap) => {
        const v = device.getCapabilityValue(cap);
        if (typeof v !== 'number') return false;
        return v < Number(args.pressure);
      };
      if (args.tire === 'any') {
        return Object.values(map).some((cap) => checkOne(cap));
      }
      const cap = map[args.tire];
      if (!cap) return false;
      return checkOne(cap);
    });
    this._condition('range_below', (device, args) => {
      const range = device.getCapabilityValue('measure_range');
      if (typeof range !== 'number') return false;
      const threshold = Number(args.range);
      const isImperialDevice = device.getSetting('distanceUnit') === 'mi';
      const isImperialArgs = args.unit === 'mi';
      let displayThreshold = threshold;
      if (isImperialDevice !== isImperialArgs) {
        if (isImperialArgs) {
          displayThreshold = Math.round(threshold / 1.609344);
        } else {
          displayThreshold = Math.round(threshold * 1.609344);
        }
      }
      return range < displayThreshold;
    });
    try {
      this.homey.flow.getDeviceTriggerCard('plug_type_changed').registerRunListener(async (args, state) => {
        return !args.type || args.type === state.type;
      });
    } catch (err) {
      this.error(`Could not register plug_type_changed: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('tire_pressure_changed').registerRunListener(async (args, state) => {
        if (!args || !args.tire) return true;
        if (args.tire === 'any') return true;
        return args.tire === state.tire;
      });
    } catch (err) {
      this.error(`Could not register tire_pressure_changed: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('geofence_entered').registerRunListener(async (args, state) => {
        const sLat = Number(state.latitude);
        const sLon = Number(state.longitude);
        const aLat = Number(args.latitude);
        const aLon = Number(args.longitude);
        if (!Number.isFinite(sLat) || !Number.isFinite(sLon) || !Number.isFinite(aLat) || !Number.isFinite(aLon)) return false;
        const dist = this._haversine(sLat, sLon, aLat, aLon);
        const radiusM = this._radiusToMeters(args.radius, args.unit);
        const nowInside = dist <= radiusM;
        const devId = this._deviceId(args);
        const key = `${devId}:${aLat},${aLon},${Number(args.radius)},${args.unit}`;
        const lastInside = this._geofenceState.get(key);
        if (lastInside === undefined) {
          this._geofenceState.set(key, nowInside);
          return false;
        }
        const shouldFire = lastInside === false && nowInside === true;
        this._geofenceState.set(key, nowInside);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register geofence_entered: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('geofence_exited').registerRunListener(async (args, state) => {
        const sLat = Number(state.latitude);
        const sLon = Number(state.longitude);
        const aLat = Number(args.latitude);
        const aLon = Number(args.longitude);
        if (!Number.isFinite(sLat) || !Number.isFinite(sLon) || !Number.isFinite(aLat) || !Number.isFinite(aLon)) return false;
        const dist = this._haversine(sLat, sLon, aLat, aLon);
        const radiusM = this._radiusToMeters(args.radius, args.unit);
        const nowInside = dist <= radiusM;
        const devId = this._deviceId(args);
        const key = `${devId}:${aLat},${aLon},${Number(args.radius)},${args.unit}`;
        const lastInside = this._geofenceState.get(key);
        if (lastInside === undefined) {
          this._geofenceState.set(key, nowInside);
          return false;
        }
        const shouldFire = lastInside === true && nowInside === false;
        this._geofenceState.set(key, nowInside);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register geofence_exited: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('charging_power_below').registerRunListener(async (args, state) => {
        const threshold = Number(args.power);
        const power = Number(state.power);
        if (!Number.isFinite(power) || !Number.isFinite(threshold)) return false;
        const nowBelow = power < threshold;
        const devId = this._deviceId(args);
        const key = `${devId}:${threshold}`;
        const lastBelow = this._powerBelowState.get(key);
        if (lastBelow === undefined) {
          this._powerBelowState.set(key, nowBelow);
          return false;
        }
        const shouldFire = lastBelow === false && nowBelow === true;
        this._powerBelowState.set(key, nowBelow);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register charging_power_below: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('tire_pressure_low').registerRunListener(async (args, state) => {
        const threshold = Number(args.pressure);
        const pressure = Number(state.pressure);
        if (!Number.isFinite(pressure) || !Number.isFinite(threshold)) return false;
        const nowBelow = pressure < threshold;
        const tire = state.tire || args.tire;
        const devId = this._deviceId(args);
        const key = `${devId}:${tire}:${threshold}`;
        const lastBelow = this._tireBelowState.get(key);
        if (lastBelow === undefined) {
          this._tireBelowState.set(key, nowBelow);
          return false;
        }
        const matchesFilter = !args.tire || args.tire === 'any' || args.tire === state.tire;
        if (!matchesFilter) {
          this._tireBelowState.set(key, nowBelow);
          return false;
        }
        const shouldFire = lastBelow === false && nowBelow === true;
        this._tireBelowState.set(key, nowBelow);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register tire_pressure_low: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('charge_remaining_below').registerRunListener(async (args, state) => {
        const duration = Number(args.duration);
        const remaining = Number(state.remaining);
        if (!Number.isFinite(remaining) || !Number.isFinite(duration)) return false;
        const thresholdMin = args.unit === 'hours' ? duration * 60 : duration;
        const nowBelow = remaining < thresholdMin;
        const devId = this._deviceId(args);
        const key = `${devId}:${duration}:${args.unit || 'minutes'}`;
        const lastBelow = this._chargeRemainingBelowState.get(key);
        if (lastBelow === undefined) {
          this._chargeRemainingBelowState.set(key, nowBelow);
          return false;
        }
        const shouldFire = lastBelow === false && nowBelow === true;
        this._chargeRemainingBelowState.set(key, nowBelow);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register charge_remaining_below: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('range_dropped_below').registerRunListener(async (args, state) => {
        const threshold = Number(args.range);
        const range = Number(state.range);
        if (!Number.isFinite(range) || !Number.isFinite(threshold)) return false;
        const stateUnit = state.unit || 'km';
        const argsUnit = args.unit || 'km';
        let r = range;
        let t = threshold;
        if (stateUnit !== argsUnit) {
          if (argsUnit === 'mi' && stateUnit === 'km') {
            t = t * 1.609344;
          } else if (argsUnit === 'km' && stateUnit === 'mi') {
            t = t / 1.609344;
          }
        }
        const nowBelow = r < t;
        const devId = this._deviceId(args);
        const key = `${devId}:${threshold}:${argsUnit}`;
        const lastBelow = this._rangeBelowState.get(key);
        if (lastBelow === undefined) {
          this._rangeBelowState.set(key, nowBelow);
          return false;
        }
        const shouldFire = lastBelow === false && nowBelow === true;
        this._rangeBelowState.set(key, nowBelow);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register range_dropped_below: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('range_rose_above').registerRunListener(async (args, state) => {
        const threshold = Number(args.range);
        const range = Number(state.range);
        if (!Number.isFinite(range) || !Number.isFinite(threshold)) return false;
        const stateUnit = state.unit || 'km';
        const argsUnit = args.unit || 'km';
        let t = threshold;
        if (stateUnit !== argsUnit) {
          if (argsUnit === 'mi' && stateUnit === 'km') {
            t = t * 1.609344;
          } else if (argsUnit === 'km' && stateUnit === 'mi') {
            t = t / 1.609344;
          }
        }
        const nowAbove = range > t;
        const devId = this._deviceId(args);
        const key = `${devId}:${threshold}:${argsUnit}`;
        const lastAbove = this._rangeAboveState.get(key);
        if (lastAbove === undefined) {
          this._rangeAboveState.set(key, nowAbove);
          return false;
        }
        const shouldFire = lastAbove === false && nowAbove === true;
        this._rangeAboveState.set(key, nowAbove);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register range_rose_above: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('opening_changed').registerRunListener(async (args, state) => {
        if (!args.item || !args.state) return true;
        return args.item === state.item && args.state === state.state;
      });
    } catch (err) {
      this.error(`Could not register opening_changed: ${err.message}`);
    }
    try {
      this.homey.flow.getDeviceTriggerCard('data_stale').registerRunListener(async (args, state) => {
        const age = Number(state.age_minutes);
        if (!Number.isFinite(age)) return false;
        const threshold = args.unit === 'hours' ? Number(args.duration) * 60 : Number(args.duration);
        const nowStale = age >= threshold;
        const devId = this._deviceId(args);
        const key = `${devId}:${Number(args.duration)}:${args.unit}`;
        const lastStale = this._dataStaleState.get(key);
        if (lastStale === undefined) {
          this._dataStaleState.set(key, nowStale);
          return false;
        }
        const shouldFire = lastStale === false && nowStale === true;
        this._dataStaleState.set(key, nowStale);
        return shouldFire;
      });
    } catch (err) {
      this.error(`Could not register data_stale: ${err.message}`);
    }
    const alwaysTrue = async () => true;
    ['charging_completed', 'charging_started', 'charging_stopped', 'car_parked', 'car_moving', 'car_locked', 'car_unlocked'].forEach((id) => {
      try {
        this.homey.flow.getDeviceTriggerCard(id).registerRunListener(alwaysTrue);
      } catch (err) {
        this.error(`Could not register trigger ${id}: ${err.message}`);
      }
    });
  }
}
module.exports = LeapmotorApp;
