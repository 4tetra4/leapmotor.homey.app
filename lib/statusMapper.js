'use strict';
const SIGNAL_TO_NAMED = {
  2: 'longitudeSigned',
  3: 'latitudeSigned',
  47: 'acInputSlowCharge',
  48: 'healthyChargeEnabled',
  49: 'leftMirrorHeating',
  50: 'rightMirrorHeating',
  240: 'sunShade',
  1010: 'gearStatus',
  1149: 'chargeState',
  1177: 'batteryVoltage',
  1178: 'batteryCurrent',
  1182: 'minBatteryTemp',
  1186: 'batteryThermalRequest',
  1197: 'dcInputFastCharge',
  1200: 'chargeRemainTime',
  1204: 'soc',
  1255: 'vehicleSecurityActive',
  1256: 'bcmKeyPositionOn1',
  1257: 'bcmKeyPositionOn2',
  1258: 'bcmKeyPositionOn3',
  1277: 'lbcmDriverDoorStatus',
  1278: 'rbcmDriverDoorStatus',
  1279: 'lbcmLeftRearDoorStatus',
  1280: 'rbcmRightRearDoorStatus',
  1281: 'bbcmBackDoorStatus',
  1298: 'driverDoorLockStatus',
  1318: 'totalMileage',
  1319: 'speed',
  1349: 'interiorTemp',
  1480: 'parkingBrakeState',
  1624: 'steeringWheelHeaterMinutes',
  1693: 'driverWindowStatus',
  1694: 'rightFrontWindowStatus',
  1695: 'leftRearWindowStatus',
  1696: 'rightRearWindowStatus',
  1724: 'roofOpening',
  1816: 'steeringWheelHeating',
  1879: 'leftRearWindowPercent',
  1880: 'rightRearWindowPercent',
  1938: 'acSwitch',
  1939: 'acOperateMode',
  1941: 'acAirVolume',
  1943: 'recirculationMode',
  1944: 'vehicleState',
  1945: 'windshieldDefrost',
  1946: 'rearWindowHeating',
  2100: 'driverSeatHeating',
  2101: 'driverSeatVentilation',
  2118: 'passengerSeatHeating',
  2119: 'passengerSeatVentilation',
  2183: 'acSetting',
  2184: 'acSettingRight',
  2188: 'liveRemainingRange',
  2190: 'latitudeFallback',
  2191: 'longitudeFallback',
  2641: 'leftFrontTirePressureState',
  2646: 'leftRearTirePressure',
  2648: 'rightFrontTirePressureState',
  2653: 'rightFrontTirePressure',
  2655: 'leftRearTirePressureState',
  2660: 'rightRearTirePressure',
  2662: 'rightRearTirePressureState',
  2667: 'leftFrontTirePressure',
  2669: 'rapidCooling',
  2681: 'rapidHeating',
  3257: 'maxRange',
  3260: 'expectedMileage',
  3262: 'rangeMode',
  3636: 'sentryMode',
  3713: 'climateMode',
  3724: 'longitude',
  3725: 'latitude',
  3727: 'leftFrontWindowPercent',
  3728: 'rightFrontWindowPercent',
  3736: 'chargeCompleted',
  3737: 'chargeScheduleCancelledOnce',
  6047: 'speedLimitUnit',
  6048: 'speedLimit',
  12054: 'speedLimitActive',
  100003: 'preciseSoc'
};
const LOCK_KEYS = ['driverDoorLockStatus', 'doorLockStatus', 'lockStatus', 'centralLockStatus', 'isLocked'];
const DOOR_KEYS = [
  'lbcmDriverDoorStatus',
  'rbcmDriverDoorStatus',
  'lbcmLeftRearDoorStatus',
  'rbcmRightRearDoorStatus',
  'frontLeftDoorStatus',
  'frontRightDoorStatus',
  'rearLeftDoorStatus',
  'rearRightDoorStatus',
  'bbcmBackDoorStatus',
  'backDoorStatus'
];
const BOOT_KEYS = ['bbcmBackDoorStatus', 'backDoorStatus', 'trunkStatus', 'tailgateStatus'];
const WINDOW_KEYS = [
  'driverWindowStatus',
  'rightFrontWindowStatus',
  'leftRearWindowStatus',
  'rightRearWindowStatus',
  'leftFrontWindowPercent',
  'rightFrontWindowPercent',
  'leftRearWindowPercent',
  'rightRearWindowPercent'
];
const INTERIOR_TEMP_KEYS = ['interiorTemp', 'insideTemperature', 'insideTemp'];
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function toInteger(value) {
  const number = toNumber(value);
  return number === null ? null : Math.trunc(number);
}
function toBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalised = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'lock', 'locked', 'open', 'opened', 'active'].includes(normalised)) return true;
  if (['0', 'false', 'off', 'no', 'unlock', 'unlocked', 'close', 'closed', 'inactive'].includes(normalised)) return false;
  const number = toNumber(value);
  return number === null ? null : number !== 0;
}
function clamp(value, min, max) {
  if (value === null || value === undefined) return null;
  return Math.min(Math.max(value, min), max);
}
function round1(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value * 10) / 10;
}
function toBar(value) {
  const number = toNumber(value);
  if (number === null || number <= 0) return null;
  if (number > 100) return number / 100;
  if (number > 10) return number / 10;
  return number;
}
function toTemperature(value) {
  const number = toNumber(value);
  if (number === null) return null;
  if (number < -60 || number > 90) return null;
  return number;
}
function toSoc(value) {
  const number = toNumber(value);
  if (number === null) return null;
  if (number > 100 && number <= 1000) return number / 10;
  return number;
}
function firstDefined(data, keys) {
  for (const key of keys) {
    if (data[key] !== null && data[key] !== undefined && data[key] !== '') return data[key];
  }
  return null;
}
function openState(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalised = String(value).trim().toLowerCase();
  if (['open', 'opened', 'opening', 'unlock', 'unlocked'].includes(normalised)) return true;
  if (['close', 'closed', 'closing', 'shut', 'lock', 'locked'].includes(normalised)) return false;
  const number = toNumber(value);
  return number === null ? null : number > 0;
}
function mergeSignalToNamed(statusData) {
  const source = statusData && typeof statusData === 'object' ? statusData : {};
  const result = Object.assign({}, source);
  const assignSignal = (id, value) => {
    const name = SIGNAL_TO_NAMED[id] || SIGNAL_TO_NAMED[Number(id)];
    if (name) result[name] = value;
  };
  ['signal', 'signals', 'signalList', 'signalMap', 'dataList', 'list', 'items'].forEach((key) => {
    const collection = source[key];
    if (!collection) return;
    if (Array.isArray(collection)) {
      collection.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const id = entry.id !== undefined
          ? entry.id
          : entry.signalId !== undefined
            ? entry.signalId
            : entry.key !== undefined
              ? entry.key
              : entry.code !== undefined
                ? entry.code
                : entry.name;
        const value = entry.value !== undefined
          ? entry.value
          : entry.val !== undefined
            ? entry.val
            : entry.signalValue !== undefined
              ? entry.signalValue
              : entry.data;
        if (id !== undefined) assignSignal(id, value);
      });
      return;
    }
    if (typeof collection === 'object') {
      Object.entries(collection).forEach(([id, value]) => assignSignal(id, value));
    }
  });
  return result;
}
function getWindowsOpen(data) {
  const states = WINDOW_KEYS
    .map((key) => openState(data[key]))
    .filter((state) => state !== null);
  if (states.length === 0) return null;
  return states.some(Boolean);
}
function getDoorState(data) {
  const states = DOOR_KEYS
    .map((key) => openState(data[key]))
    .filter((value) => value !== null);
  if (states.length === 0) return null;
  return states.some(Boolean) ? 'open' : 'closed';
}
function map(statusData) {
  const data = mergeSignalToNamed(statusData);
  const values = {};
  const set = (capability, value) => {
    if (value !== null && value !== undefined && !Number.isNaN(value)) values[capability] = value;
  };
  const preciseSoc = toSoc(data.preciseSoc);
  const coarseSoc = toSoc(data.soc);
  const soc = preciseSoc !== null ? preciseSoc : coarseSoc;
  set('leapmotor_soc', clamp(soc, 0, 100));
  set('measure_battery', clamp(soc, 0, 100));
  const lockedValue = firstDefined(data, LOCK_KEYS);
  const locked = toBoolean(lockedValue);
  set('leapmotor_locked', locked);
  set('leapmotor_lock_control', locked);
  const slowPlug = toBoolean(data.acInputSlowCharge);
  const fastPlug = toBoolean(data.dcInputFastCharge);
  const plugged = slowPlug === null && fastPlug === null ? null : Boolean(slowPlug || fastPlug);
  const directCharging = toBoolean(firstDefined(data, ['isCharging', 'charging']));
  const chargeState = toInteger(data.chargeState);
  let charging;
  if (directCharging !== null) {
    charging = directCharging;
  } else if (chargeState !== null) {
    charging = chargeState === 1;
  } else {
    charging = plugged === false ? false : null;
  }
  let plugType = null;
  if (plugged === true) {
    plugType = fastPlug === true ? 'ccs' : 'type2';
  } else if (plugged === false) {
    plugType = 'no';
  }
  set('leapmotor_plugged', plugged);
  set('leapmotor_plug_type', plugType);
  set('leapmotor_charging', charging);
  set('leapmotor_charging_control', charging);
  const batteryCurrentValue = toNumber(data.batteryCurrent);
  const batteryVoltageValue = toNumber(data.batteryVoltage);
  const chargingPowerKw = charging === true && batteryCurrentValue !== null && batteryVoltageValue !== null
    ? Math.abs((batteryCurrentValue * batteryVoltageValue) / 1000)
    : null;
  const chargingPowerKwRounded = chargingPowerKw === null ? null : Math.round(chargingPowerKw * 10) / 10;
  set('leapmotor_charging_power_kw', chargingPowerKwRounded === null ? 0 : chargingPowerKwRounded);
  set('leapmotor_charging_power', chargingPowerKwRounded === null ? 'No' : `${chargingPowerKwRounded.toFixed(1)} kW`);
  const chargeRemain = toNumber(firstDefined(data, ['chargeRemainTime', 'chargeRemainingTime', 'remainChargeTime']));
  if (charging === true && chargeRemain !== null && chargeRemain >= 0) {
    set('leapmotor_charge_remaining', chargeRemain);
  } else if (charging === false) {
    set('leapmotor_charge_remaining', 0);
  }
  const thermalRequest = toInteger(data.batteryThermalRequest);
  const directHeating = toBoolean(firstDefined(data, ['batteryHeating', 'batteryPreheating']));
  const heating = thermalRequest !== null ? thermalRequest === 4 : directHeating;
  set('leapmotor_heating', heating);
  set('leapmotor_battery_heating_control', heating);
  set('leapmotor_ac', toBoolean(data.acSwitch));
  set('leapmotor_security', toBoolean(firstDefined(data, ['vehicleSecurityActive', 'securityActive', 'sentryMode'])));
  set('measure_temperature', toTemperature(firstDefined(data, INTERIOR_TEMP_KEYS)));
  set('leapmotor_odometer', toNumber(firstDefined(data, ['totalMileage', 'odometer'])));
  set('leapmotor_speed', toNumber(data.speed));
  const fl = toBar(data.leftFrontTirePressure);
  const fr = toBar(data.rightFrontTirePressure);
  const rl = toBar(data.leftRearTirePressure);
  const rr = toBar(data.rightRearTirePressure);
  set('leapmotor_tire_pressure_front_left', fl);
  set('leapmotor_tire_pressure_front_right', fr);
  set('leapmotor_tire_pressure_rear_left', rl);
  set('leapmotor_tire_pressure_rear_right', rr);
  if (fl !== null && fr !== null && rl !== null && rr !== null) {
    set('leapmotor_tire_pressure_average', (fl + fr + rl + rr) / 4);
  } else if (fl !== null || fr !== null || rl !== null || rr !== null) {
    const valid = [fl, fr, rl, rr].filter((v) => v !== null);
    if (valid.length > 0) {
      set('leapmotor_tire_pressure_average', valid.reduce((a, b) => a + b, 0) / valid.length);
    }
  }
  set('leapmotor_voltage', toNumber(data.batteryVoltage));
  set('leapmotor_current', toNumber(data.batteryCurrent));
  set('leapmotor_battery_temperature', toTemperature(firstDefined(data, ['minBatteryTemp', 'batteryTemp', 'batteryTemperature'])));
  set('leapmotor_doors', getDoorState(data));
  set('measure_range', toNumber(firstDefined(data, ['liveRemainingRange', 'expectedMileage', 'remainingRange'])));
  set('leapmotor_latitude', toNumber(firstDefined(data, ['latitudeSigned', 'latitude', 'latitudeFallback'])));
  set('leapmotor_longitude', toNumber(firstDefined(data, ['longitudeSigned', 'longitude', 'longitudeFallback'])));
  const windowsOpen = getWindowsOpen(data);
  if (windowsOpen !== null) {
    set('leapmotor_windows', windowsOpen ? 'open' : 'closed');
    set('leapmotor_windows_control', windowsOpen);
  }
  set('leapmotor_boot_control', openState(firstDefined(data, BOOT_KEYS)));
  set('leapmotor_sunshade', openState(data.sunShade));
  set('leapmotor_fast_heating', toBoolean(data.rapidHeating));
  set('leapmotor_cabin_heating', toBoolean(data.rapidHeating));
  set('leapmotor_windshield_defrost', toBoolean(data.windshieldDefrost));
  const passengerHeat = toNumber(data.passengerSeatHeating);
  const driverHeat = toNumber(data.driverSeatHeating);
  set('leapmotor_seat_heat_passenger', passengerHeat === null ? null : passengerHeat > 0);
  set('leapmotor_seat_heat_driver', driverHeat === null ? null : driverHeat > 0);
  set('leapmotor_steering_wheel_heat', toBoolean(data.steeringWheelHeating));
  set('leapmotor_fast_cooling', toBoolean(data.rapidCooling));
  const passengerVent = toNumber(data.passengerSeatVentilation);
  const driverVent = toNumber(data.driverSeatVentilation);
  set('leapmotor_seat_ventilation_passenger', passengerVent === null ? null : passengerVent > 0);
  set('leapmotor_seat_ventilation_driver', driverVent === null ? null : driverVent > 0);
  const leftMirror = toBoolean(data.leftMirrorHeating);
  const rightMirror = toBoolean(data.rightMirrorHeating);
  set('leapmotor_mirror_heating', leftMirror === null && rightMirror === null ? null : Boolean(leftMirror || rightMirror));
  const rawTime = firstDefined(data, ['updateTime', 'reportTime', 'collectTime', 'timestamp', 'gpsTime', 'time', 'createTime']);
  const ts = toNumber(rawTime);
  if (ts !== null && ts > 0) {
    const ms = ts > 100000000000 ? ts : ts * 1000;
    set('leapmotor_data_age_min', Math.round((Date.now() - ms) / 60000));
    set('__reportTime', ms);
  }
  return values;
}
module.exports = {
  SIGNAL_TO_NAMED,
  mergeSignalToNamed,
  map
};
