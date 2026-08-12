'use strict';
const LeapmotorException = require('./leapmotorException');
const CMD_RIGHTS = {
  110: 110,
  120: 120,
  130: 130,
  140: 140,
  150: 150,
  160: 190,
  170: 170,
  180: 180,
  190: 340,
  192: 192,
  193: 193,
  220: 220,
  230: 230,
  240: 161,
  270: 270,
  280: 280,
  290: 290,
  300: 160,
  301: 301,
  320: 320,
  360: 360,
  370: 370,
  380: 380,
  410: 410,
  440: 440,
  480: 480,
  510: 510
};
function encode(payload) {
  return JSON.stringify(payload);
}
function pick(params, keys, fallback) {
  for (const key of keys) {
    if (params && params[key] !== undefined && params[key] !== null && params[key] !== '') {
      return params[key];
    }
  }
  return fallback;
}
function planValue(plan, keys, fallback) {
  const source = plan && typeof plan === 'object' ? plan : {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return fallback;
}
function clampInt(value, min, max, fallback) {
  const number = parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}
function spec(cmdId, payload, requiresPin) {
  return {
    cmdId: String(cmdId),
    cmdContent: encode(payload),
    requiresPin: requiresPin === undefined ? true : requiresPin
  };
}
function value(cmdId, commandValue, requiresPin) {
  return spec(cmdId, { value: String(commandValue) }, requiresPin);
}
function operation(cmdId, commandValue, requiresPin) {
  return spec(cmdId, { operation: String(commandValue) }, requiresPin);
}
function overridableValue(cmdId, params, defaultValue) {
  return value(cmdId, pick(params, ['value'], defaultValue));
}
function climate(params, defaults) {
  const operate = String(pick(params, ['operate'], defaults.operate));
  if (operate === 'close' || operate === 'off') {
    return spec('170', { operate: 'off' });
  }
  return spec('170', {
    circle: String(pick(params, ['circle'], defaults.circle)),
    mode: String(pick(params, ['mode'], defaults.mode)),
    operate: String(pick(params, ['operate'], defaults.operate)),
    position: String(pick(params, ['position'], defaults.position)),
    temperature: String(clampInt(pick(params, ['temperature'], defaults.temperature), 16, 32, defaults.temperature)),
    windlevel: String(clampInt(pick(params, ['windlevel', 'fan_speed'], defaults.windlevel), 1, 7, defaults.windlevel)),
    wshld: String(pick(params, ['wshld'], defaults.wshld))
  });
}
function seatPositionName(position) {
  const number = parseInt(position, 10);
  if (Number.isFinite(number)) {
    if (number === 2) return 'copilot';
    if (number === 3) return 'driver';
    return null;
  }
  const name = String(position || '').trim().toLowerCase();
  if (name === 'driver') return 'driver';
  if (name === 'copilot' || name === 'passenger') return 'copilot';
  return null;
}
function seat(cmdId, params, defaultLevel) {
  const rawPosition = pick(params, ['position', 'seat'], 3);
  const level = clampInt(pick(params, ['level'], defaultLevel), 0, 3, defaultLevel);
  const named = seatPositionName(rawPosition);
  if (named) {
    return spec(cmdId, { position: named, level: String(level) });
  }
  const numeric = clampInt(rawPosition, 1, 6, 3);
  return value(cmdId, `${numeric},${level}`);
}
function toBool(valueToConvert) {
  if (typeof valueToConvert === 'boolean') return valueToConvert;
  return ['1', 'true', 'on', 'yes'].includes(String(valueToConvert).toLowerCase());
}
function chargeLimit(params) {
  const percentage = clampInt(
    pick(params, ['charge_limit_percent', 'chargeLimitPercent', 'percentage', 'soc_limit', 'socLimit'], 80),
    20,
    100,
    80
  );
  return spec('190', {
    chargeEnable: 1,
    chargesoc: percentage,
    circulation: clampInt(pick(params, ['circulation'], 0), 0, 1, 0),
    cycles: String(pick(params, ['cycles'], '')),
    endtime: String(pick(params, ['end_time', 'endTime'], '')),
    recharge: clampInt(pick(params, ['recharge'], 0), 0, 1, 0),
    starttime: String(pick(params, ['start_time', 'startTime'], ''))
  });
}
function chargeSchedule(params) {
  const enabled = params.enabled === undefined ? true : toBool(params.enabled);
  return spec('190', {
    chargeEnable: enabled ? 1 : 0,
    chargesoc: clampInt(pick(params, ['soc_limit', 'socLimit', 'charge_limit_percent', 'percentage'], 80), 20, 100, 80),
    circulation: clampInt(pick(params, ['circulation'], 1), 0, 1, 1),
    cycles: String(pick(params, ['cycles'], '1,2,3,4,5,6,7')),
    endtime: String(pick(params, ['end_time', 'endTime'], '07:00')),
    recharge: clampInt(pick(params, ['recharge'], 0), 0, 1, 0),
    starttime: String(pick(params, ['start_time', 'startTime'], '23:00'))
  });
}
function chargePlan(params) {
  const cycles = String(pick(params, ['cycles'], ''));
  const circulationFallback = cycles ? 1 : 0;
  return spec('190', {
    chargeEnable: toBool(pick(params, ['chargeEnable', 'charge_enable', 'enabled', 'enable'], 1)) ? 1 : 0,
    chargesoc: clampInt(pick(params, ['chargesoc', 'chargeSoc', 'soc_limit', 'socLimit', 'charge_limit_percent', 'percentage'], 80), 1, 100, 80),
    circulation: clampInt(pick(params, ['circulation'], circulationFallback), 0, 1, circulationFallback),
    cycles,
    endtime: String(pick(params, ['endtime', 'end_time', 'endTime'], '')),
    recharge: clampInt(pick(params, ['recharge'], 0), 0, 1, 0),
    starttime: String(pick(params, ['starttime', 'start_time', 'startTime'], ''))
  });
}
function chargeToggle(params, enable) {
  const plan = params && typeof params.plan === 'object' && params.plan !== null ? params.plan : {};
  return spec('190', {
    chargeEnable: enable ? 1 : 0,
    chargesoc: clampInt(
      pick(params, ['chargesoc', 'charge_limit_percent', 'percentage'], planValue(plan, ['chargesoc', 'percent'], 80)),
      1,
      100,
      80
    ),
    circulation: clampInt(pick(params, ['circulation'], planValue(plan, ['circulation'], 0)), 0, 1, 0),
    cycles: String(pick(params, ['cycles'], planValue(plan, ['cycles'], ''))),
    endtime: String(pick(params, ['endtime', 'end_time', 'endTime'], planValue(plan, ['endtime', 'endTime'], ''))),
    recharge: clampInt(pick(params, ['recharge'], planValue(plan, ['recharge'], 0)), 0, 1, 0),
    starttime: String(pick(params, ['starttime', 'start_time', 'startTime'], planValue(plan, ['starttime', 'beginTime'], '')))
  });
}
function prepareCar(params) {
  if (params && typeof params.params === 'object' && params.params !== null) {
    return spec('360', params.params);
  }
  const airCondition = {
    circle: String(pick(params, ['circle'], 'out')),
    enable: true,
    mode: String(pick(params, ['mode'], 'wind')),
    operate: String(pick(params, ['operate'], 'manual')),
    position: String(pick(params, ['position'], 'all')),
    temperature: String(clampInt(pick(params, ['temperature'], 22), 16, 32, 22)),
    windlevel: String(clampInt(pick(params, ['windlevel', 'fan_speed'], 4), 1, 7, 4)),
    wshld: String(pick(params, ['wshld'], '0'))
  };
  return spec('360', { air_condition: airCondition });
}
function rawJson(cmdId, params, requiresPin) {
  const payload = params && typeof params.params === 'object' ? params.params : params || {};
  return spec(cmdId, payload, requiresPin);
}
function sendDestinationPayload(params) {
  const raw = pick(params, ['rawjson', 'rawJson', 'json'], null);
  if (raw && typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return spec('180', parsed, false);
    } catch (err) {
    }
  }
  const address = String(pick(params, ['address'], '')).trim();
  const addressname = String(pick(params, ['addressname', 'address_name', 'name', 'poi'], '')).trim();
  const latitude = String(pick(params, ['latitude', 'lat'], '0')).trim();
  const longitude = String(pick(params, ['longitude', 'lon', 'lng'], '0')).trim();
  const latNum = Number(latitude);
  const lonNum = Number(longitude);
  return spec('180', {
    address: address || addressname || `${latitude},${longitude}`,
    addressname: addressname || address || `${latitude},${longitude}`,
    latitude: Number.isFinite(latNum) ? String(latNum) : '0',
    longitude: Number.isFinite(lonNum) ? String(lonNum) : '0',
    linenum: '0'
  }, false);
}
function sendAddressPayload(params) {
  const address = String(pick(params, ['address', 'addressname', 'name'], '')).trim();
  const name = String(pick(params, ['name', 'addressname', 'address'], address)).trim();
  const safeAddress = address || name || 'Destination';
  const safeName = name || address || 'Destination';
  return spec('180', {
    address: safeAddress,
    addressname: safeName,
    latitude: '0',
    longitude: '0',
    linenum: '0'
  }, false);
}
function sendCoordinatesPayload(params) {
  const latRaw = pick(params, ['latitude', 'lat'], '0');
  const lonRaw = pick(params, ['longitude', 'lon', 'lng'], '0');
  const latNum = Number(latRaw);
  const lonNum = Number(lonRaw);
  const latStr = Number.isFinite(latNum) ? String(latNum) : '0';
  const lonStr = Number.isFinite(lonNum) ? String(lonNum) : '0';
  const name = String(pick(params, ['name', 'addressname', 'address'], `${latStr},${lonStr}`)).trim() || `${latStr},${lonStr}`;
  return spec('180', {
    address: name,
    addressname: name,
    latitude: latStr,
    longitude: lonStr,
    linenum: '0'
  }, false);
}
function seatAdjustPayload(params) {
  const raw = pick(params, ['adjustment', 'json', 'payload', 'params'], null);
  if (raw && typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return spec('280', parsed, true);
    } catch (err) {
    }
  }
  if (params && typeof params === 'object' && params.adjustment && typeof params.adjustment === 'object') {
    return spec('280', params.adjustment, true);
  }
  const position = pick(params, ['position', 'seat'], null);
  if (position !== null) {
    const copy = Object.assign({}, params);
    delete copy.adjustment;
    delete copy.json;
    delete copy.payload;
    return spec('280', copy, true);
  }
  return rawJson('280', params, true);
}
const COMMANDS = {
  lock: () => value('110', 'lock'),
  lock_vehicle: () => value('110', 'lock'),
  unlock: () => value('110', 'unlock'),
  unlock_vehicle: () => value('110', 'unlock'),
  find_car: (params) => overridableValue('120', params, 'true'),
  find_vehicle: (params) => overridableValue('120', params, 'true'),
  open_trunk: () => value('130', 'true'),
  trunk: () => value('130', 'true'),
  close_trunk: () => value('130', 'false'),
  trunk_close: () => value('130', 'false'),
  hotspot: (params) => overridableValue('140', params, 'findCar'),
  autopark: (params) => overridableValue('150', params, 'findCar'),
  open_windows: () => value('230', '10'),
  windows_open: () => value('230', '10'),
  close_windows: () => value('230', '0'),
  windows_close: () => value('230', '0'),
  open_sunshade: (params) => value('240', clampInt(pick(params, ['value', 'percent'], 10), 0, 10, 10)),
  sunshade_open: (params) => value('240', clampInt(pick(params, ['value', 'percent'], 10), 0, 10, 10)),
  close_sunshade: () => value('240', '0'),
  sunshade_close: () => value('240', '0'),
  open_sunroof: () => value('300', 'open'),
  sunroof_open: () => value('300', 'open'),
  close_sunroof: () => value('300', 'close'),
  sunroof_close: () => value('300', 'close'),
  ac_on: (params) => climate(params, {
    circle: 'out',
    mode: 'wind',
    operate: 'manual',
    position: 'all',
    temperature: 26,
    windlevel: 3,
    wshld: '0'
  }),
  ac_off: (params) => climate(params, {
    circle: 'out',
    mode: 'wind',
    operate: 'close',
    position: 'all',
    temperature: 26,
    windlevel: 3,
    wshld: '0'
  }),
  heating_ac_off: (params) => climate(params, {
    circle: 'out',
    mode: 'wind',
    operate: 'close',
    position: 'all',
    temperature: 26,
    windlevel: 3,
    wshld: '0'
  }),
  climate_off: (params) => climate(params, {
    circle: 'out',
    mode: 'wind',
    operate: 'close',
    position: 'all',
    temperature: 26,
    windlevel: 3,
    wshld: '0'
  }),
  ventilation_off: () => spec('170', { operate: 'off' }),
  quick_cool: (params) => climate(params, {
    circle: 'in',
    mode: 'cold',
    operate: 'manual',
    position: 'all',
    temperature: 18,
    windlevel: 7,
    wshld: '0'
  }),
  quick_heat: (params) => climate(params, {
    circle: 'in',
    mode: 'hot',
    operate: 'manual',
    position: 'all',
    temperature: 32,
    windlevel: 7,
    wshld: '0'
  }),
  windshield_defrost: (params) => climate(params, {
    circle: 'in',
    mode: 'hot',
    operate: 'manual',
    position: 'all',
    temperature: 32,
    windlevel: 7,
    wshld: '2'
  }),
  defrost: (params) => climate(params, {
    circle: 'in',
    mode: 'hot',
    operate: 'manual',
    position: 'all',
    temperature: 32,
    windlevel: 7,
    wshld: '2'
  }),
  set_climate_complex: (params) => climate(params, {
    circle: 'out',
    mode: 'wind',
    operate: 'manual',
    position: 'all',
    temperature: 22,
    windlevel: 4,
    wshld: '0'
  }),
  battery_preheat_on: () => value('160', 'ptcon'),
  battery_preheat_off: () => value('160', 'ptcoff'),
  start_charging: (params) => value('193', 'start'),
  stop_charging: (params) => value('193', 'stop'),
  start_charging_plan: (params) => chargeToggle(params, true),
  stop_charging_plan: (params) => chargeToggle(params, false),
  start_charging_plan_clear: (params) => spec('190', {
    chargeEnable: 0,
    chargesoc: clampInt(pick(params, ['chargesoc', 'soc', 'limit'], 100), 1, 100, 100),
    circulation: 0,
    cycles: String(pick(params, ['cycles'], '1,2,3,4,5,6,7')),
    endtime: String(pick(params, ['endtime'], '08:00')),
    recharge: 0,
    starttime: String(pick(params, ['starttime'], '00:00'))
  }),
  stop_charging_plan_block: (params) => spec('190', {
    chargeEnable: 1,
    chargesoc: clampInt(pick(params, ['chargesoc', 'soc', 'limit'], 1), 1, 100, 1),
    circulation: 1,
    cycles: String(pick(params, ['cycles'], '0,0,0,0,0,0,1')),
    endtime: String(pick(params, ['endtime'], '18:01')),
    recharge: 0,
    starttime: String(pick(params, ['starttime'], '18:00'))
  }),
  unlock_charger: () => operation('192', 'unlock'),
  set_charge_limit: (params) => chargeLimit(params),
  charge_limit: (params) => chargeLimit(params),
  charge_schedule: (params) => chargeSchedule(params),
  charge_plan: (params) => chargePlan(params),
  set_charge_plan: (params) => chargePlan(params),
  healthy_charging_on: () => value('480', '1'),
  healthy_charging_off: () => value('480', '0'),
  seat_heat: (params) => seat('301', params, 3),
  seat_ventilation: (params) => seat('370', params, 3),
  seat_adjust: (params) => seatAdjustPayload(params),
  seat_position_adjust: (params) => seatAdjustPayload(params),
  steering_wheel_heat_on: () => spec('320', { level: '2' }),
  steering_wheel_heat_off: () => spec('320', { level: '1' }),
  fuel_heating_on: () => value('380', '1'),
  fuel_heating_off: () => value('380', '0'),
  rearview_mirror_heat_on: () => value('440', '2'),
  rearview_mirror_heat_off: () => value('440', '1'),
  mirror_heat_on: () => value('440', '2'),
  mirror_heat_off: () => value('440', '1'),
  sentry_mode_on: () => value('220', '1'),
  sentry_mode_off: () => value('220', '0'),
  on3_on: () => spec('410', { on3: 'on' }),
  on3_off: () => spec('410', { on3: 'off' }),
  ble_key_restart: () => value('430', 'restart'),
  set_speed_limit: (params) => value('510', clampInt(pick(params, ['value', 'speed'], 80), 0, 200, 80)),
  speed_limit: (params) => value('510', clampInt(pick(params, ['value', 'speed'], 80), 0, 200, 80)),
  send_destination: (params) => sendDestinationPayload(params),
  send_destination_address: (params) => sendDestinationPayload(params),
  send_destination_coordinates: (params) => sendDestinationPayload(params),
  send_destination_json: (params) => sendDestinationPayload(params),
  send_address: (params) => sendAddressPayload(params),
  send_coordinates: (params) => sendCoordinatesPayload(params),
  prepare_car: (params) => prepareCar(params)
};
function getSpec(command, params) {
  const builder = COMMANDS[command];
  if (typeof builder !== 'function') {
    const supported = Object.keys(COMMANDS).sort().join(', ');
    throw new LeapmotorException(`Unknown Leapmotor command "${command}". Supported commands: ${supported}`);
  }
  return builder(params || {});
}
function warnIfMissingRight(cmdId, vehicle, log) {
  try {
    const requiredRight = CMD_RIGHTS[Number(cmdId)];
    if (!requiredRight) return;
    const rights = vehicle && (vehicle.rightList || vehicle.rights || vehicle.vehicleRightList) || [];
    const hasRight = rights.some((entry) => {
      if (entry === null || entry === undefined) return false;
      if (typeof entry === 'object') {
        return Number(entry.code || entry.right || entry.rightCode) === requiredRight;
      }
      return Number(entry) === requiredRight;
    });
    if (!hasRight && typeof log === 'function') {
      log(`Vehicle is missing the required right ${requiredRight} for command ${cmdId} (soft check).`);
    }
  } catch (err) {
    return;
  }
}
module.exports = {
  getSpec,
  warnIfMissingRight,
  COMMANDS,
  CMD_RIGHTS
};
