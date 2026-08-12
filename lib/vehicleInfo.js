'use strict';

const Constants = require('./constants');

const RIGHT_CATALOG = [
  { id: 110, short: 'Lock', description: 'Lock / unlock doors' },
  { id: 120, short: 'Find Car', description: 'Find car (horn and lights)' },
  { id: 130, short: 'Trunk', description: 'Trunk open / close' },
  { id: 140, short: 'Hotspot', description: 'Wi-Fi hotspot / connectivity' },
  { id: 150, short: 'Autopark', description: 'Auto park / summon' },
  { id: 160, short: 'Sunroof', description: 'Sunroof control' },
  { id: 161, short: 'Sunshade', description: 'Sunshade control' },
  { id: 170, short: 'Climate', description: 'Climate / AC on-off' },
  { id: 171, short: 'Quick Clim.', description: 'Quick cool / quick heat' },
  { id: 180, short: 'Destination', description: 'Send destination to navigation' },
  { id: 190, short: 'Bat.heating', description: 'Battery preheating' },
  { id: 192, short: 'Unlock Plug', description: 'Unlock charging connector' },
  { id: 193, short: 'Toggle Charge', description: 'Start / stop charging' },
  { id: 220, short: 'Sentry', description: 'Sentry mode' },
  { id: 230, short: 'Windows', description: 'Window control' },
  { id: 240, short: 'Skylight', description: 'Skylight control' },
  { id: 270, short: 'Music', description: 'Music control' },
  { id: 280, short: 'Seat Adj.', description: 'Seat adjustment' },
  { id: 290, short: 'Video', description: 'Video / camera' },
  { id: 301, short: 'Seat Heat', description: 'Seat heating' },
  { id: 320, short: 'Weel heat', description: 'Steering wheel heating' },
  { id: 340, short: 'Charge Limit', description: 'Charge limit' },
  { id: 350, short: 'Piloted Park', description: 'Piloted parking / summon' },
  { id: 360, short: 'Prepare Car', description: 'Pre-conditioning (prepare car)' },
  { id: 361, short: 'Prep. Alarm', description: 'Pre-conditioning alarm' },
  { id: 370, short: 'Seat Vent.', description: 'Seat ventilation' },
  { id: 380, short: 'Fuel Heating', description: 'Fuel heating' },
  { id: 390, short: 'FOTA Down.', description: 'FOTA download' },
  { id: 391, short: 'FOTA Install', description: 'FOTA install' },
  { id: 392, short: 'FOTA Plan', description: 'FOTA install appointment' },
  { id: 410, short: 'ON3', description: 'ON3 mode' },
  { id: 430, short: 'BT Key Reset', description: 'Bluetooth key restart' },
  { id: 440, short: 'Mirror Heat', description: 'Rear view mirror heating' },
  { id: 460, short: 'Defrost', description: 'Windshield defrost' },
  { id: 470, short: 'Rear Seats', description: 'Rear seat control' },
  { id: 480, short: 'Healthy Chg.', description: 'Healthy charging mode' },
  { id: 510, short: 'Speed Limit', description: 'Speed limit' }
];

const ABILITY_CATALOG = [
  { id: 1, short: 'Base', description: 'Vehicle base / remote state' },
  { id: 2, short: 'Status Data', description: 'Vehicle status data' },
  { id: 3, short: 'Trunk', description: 'Trunk control' },
  { id: 4, short: 'Autopark', description: 'Auto park / summon' },
  { id: 5, short: 'GPS', description: 'GPS / positioning' },
  { id: 6, short: 'AC On', description: 'Air conditioning on' },
  { id: 7, short: 'Bat.Detail', description: 'Detailed battery telemetry' },
  { id: 8, short: 'AC Cycle', description: 'AC recirculation cycle' },
  { id: 9, short: 'AC Preset', description: 'AC preset / scheduling' },
  { id: 10, short: 'Lock', description: 'Remote lock / unlock' },
  { id: 11, short: 'Find Car', description: 'Find car' },
  { id: 12, short: 'Windows', description: 'Windows (C10 / B10 platform)' },
  { id: 13, short: 'Charging', description: 'Charge related functions' },
  { id: 14, short: 'Seat Heat', description: 'Seat heating / ventilation' },
  { id: 15, short: 'Weel Heat', description: 'Steering wheel heating' },
  { id: 16, short: 'BT Key', description: 'Bluetooth digital key' },
  { id: 17, short: 'Quick Clim.', description: 'Advanced climate (quick cool / heat)' },
  { id: 18, short: 'Defrost', description: 'Windshield defrost' },
  { id: 19, short: 'Rear Heat', description: 'Rear heating' },
  { id: 20, short: 'Windows Alt', description: 'Windows (T03 alternate)' },
  { id: 21, short: 'Front Heat', description: 'Front seat heating' },
  { id: 22, short: 'Rear S.Heat', description: 'Rear seat heating' },
  { id: 23, short: 'Screensaver', description: 'Screen saver' },
  { id: 24, short: 'Trunk Plus', description: 'Trunk special (C10 / B10)' },
  { id: 25, short: 'Timed Chg.', description: 'Cyclic / timed charging' },
  { id: 26, short: 'Weekly Chg.', description: 'Charge repeat weekly' },
  { id: 27, short: 'TPMS', description: 'Tire pressure monitoring' },
  { id: 28, short: 'Defr.Trigger', description: 'Windshield defrost trigger' },
  { id: 29, short: 'Driver Seat', description: 'Driver / copilot distinction' },
  { id: 30, short: 'GPS Share', description: 'GPS sharing' },
  { id: 31, short: 'Mileage', description: 'Mileage and energy data' },
  { id: 32, short: 'Calendar', description: 'Calendar sync' },
  { id: 33, short: 'Code 33', description: 'Reserved ability 33' },
  { id: 34, short: 'Speed Limit', description: 'Speed limit' },
  { id: 35, short: 'Charge Limit', description: 'Charge limit' },
  { id: 36, short: 'Windows T03', description: 'Windows (T03 platform)' },
  { id: 37, short: 'Air Cycle', description: 'Air recirculation toggle' },
  { id: 38, short: 'Prepare Car', description: 'Pre-conditioning (C10 / B10)' },
  { id: 39, short: 'Code 39', description: 'Reserved ability 39' },
  { id: 40, short: 'Fuel Heat', description: 'Fuel heating' },
  { id: 41, short: 'Code 41', description: 'Reserved ability 41' },
  { id: 42, short: 'Driver Vent.', description: 'Driver seat ventilation' },
  { id: 43, short: 'Pass. Vent.', description: 'Passenger seat ventilation' },
  { id: 44, short: 'Code 44', description: 'Reserved ability 44' },
  { id: 45, short: 'Mobile Ctrl', description: 'Mobile phone control' },
  { id: 46, short: 'ON3 Call', description: 'ON3 / straight call' },
  { id: 47, short: 'Chg.Trigger', description: 'Cyclic charge trigger' },
  { id: 48, short: 'Unlock Plug', description: 'Unlock charging gun' },
  { id: 49, short: 'Park Photo', description: 'Parking photo' },
  { id: 50, short: 'Sentry', description: 'Sentinel / dashcam mode' },
  { id: 51, short: 'Weekly Rep.', description: 'Weekly charge repeat trigger' },
  { id: 52, short: 'Navigation', description: 'Navigation / send destination' },
  { id: 53, short: 'BT Key Reset', description: 'Bluetooth key restart' }
];

const MODULE_RIGHT_CATALOG = [
  { id: 100, short: 'Basic', description: 'Basic authorisation (lock / unlock)' },
  { id: 200, short: 'Control', description: 'Vehicle control (climate, charge, quick control)' },
  { id: 300, short: 'Position', description: 'Vehicle positioning (GPS)' },
  { id: 400, short: 'Mileage', description: 'Mileage and energy consumption' }
];

const MODEL_NAMES = {
  t03: 'Leapmotor T03',
  s01: 'Leapmotor S01',
  c01: 'Leapmotor C01',
  c10: 'Leapmotor C10',
  c11: 'Leapmotor C11',
  c16: 'Leapmotor C16',
  b10: 'Leapmotor B10',
  b11: 'Leapmotor B11',
  b05: 'Leapmotor B05',
  b03x: 'Leapmotor B03X'
};

const SEAT_LAYOUTS = {
  0: '5 seats (2 + 3)',
  1: '4 seats (2 + 2)',
  2: '6 seats (2 + 2 + 2)',
  3: '7 seats (2 + 3 + 2)'
};

const DURATION_TYPES = {
  0: 'Permanent',
  1: 'Limited period',
  2: 'Single use'
};

const GRANTED_MARK = '\u2713';
const MISSING_MARK = '\u2717';

function isFilled(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function text(value, fallback) {
  return isFilled(value) ? String(value).trim() : (fallback === undefined ? '-' : fallback);
}

function toNumberList(value) {
  const output = [];
  const push = (candidate) => {
    const parsed = parseInt(String(candidate).trim(), 10);
    if (Number.isFinite(parsed) && output.indexOf(parsed) === -1) output.push(parsed);
  };
  if (Array.isArray(value)) {
    value.forEach(push);
  } else if (isFilled(value)) {
    String(value).split(',').forEach(push);
  }
  return output.sort((a, b) => a - b);
}

function catalogRows(catalog, granted, unknownLabel) {
  const grantedList = toNumberList(granted);
  const known = catalog.map((entry) => ({
    id: entry.id,
    short: entry.short,
    description: entry.description,
    granted: grantedList.indexOf(entry.id) !== -1
  }));
  const knownIds = catalog.map((entry) => entry.id);
  const extra = grantedList
    .filter((id) => knownIds.indexOf(id) === -1)
    .map((id) => ({
      id,
      short: `${unknownLabel} ${id}`,
      description: `Not documented in the Leapmotor API reference (code ${id})`,
      granted: true
    }));
  return known.concat(extra);
}

function rudderLabel(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (raw === 'right' || raw === 'r' || raw === '1' || raw === 'rhd') return 'Right-hand drive (RHD)';
  if (raw === 'left' || raw === 'l' || raw === '0' || raw === 'lhd') return 'Left-hand drive (LHD)';
  if (!raw) return '-';
  return `Unknown (${raw})`;
}

function seatLabel(value) {
  if (!isFilled(value)) return '-';
  const parsed = parseInt(String(value).trim(), 10);
  if (Number.isFinite(parsed) && SEAT_LAYOUTS[parsed]) return `${SEAT_LAYOUTS[parsed]} (layout ${parsed})`;
  if (Number.isFinite(parsed)) return `Layout code ${parsed}`;
  return String(value).trim();
}

function modelLabel(carType) {
  const raw = String(carType || '').trim();
  if (!raw) return '-';
  const key = raw.toLowerCase();
  return MODEL_NAMES[key] ? MODEL_NAMES[key] : raw.toUpperCase();
}

function durationLabel(value) {
  if (!isFilled(value)) return '-';
  const parsed = parseInt(String(value).trim(), 10);
  if (Number.isFinite(parsed) && DURATION_TYPES[parsed] !== undefined) return `${DURATION_TYPES[parsed]} (${parsed})`;
  return String(value).trim();
}

function formatTimestamp(value, timezone) {
  if (!isFilled(value)) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(value).trim();
  const millis = numeric < 1e12 ? numeric * 1000 : numeric;
  try {
    return new Date(millis).toLocaleString('en-GB', timezone ? { timeZone: timezone } : undefined);
  } catch (err) {
    return new Date(millis).toISOString();
  }
}

function buildSnapshot(vehicle, context) {
  const source = vehicle && typeof vehicle === 'object' ? vehicle : {};
  const extra = context && typeof context === 'object' ? context : {};
  const carType = String(source.carType || extra.carType || '').trim();
  const vin = String(source.vin || extra.vin || '').trim().toUpperCase();
  const rights = catalogRows(RIGHT_CATALOG, source.rightList || source.rights, 'Right');
  const abilities = catalogRows(ABILITY_CATALOG, source.abilities || source.abilityList, 'Ability');
  const moduleRights = catalogRows(MODULE_RIGHT_CATALOG, source.moduleRights || source.moduleRightList, 'Module');
  const count = (rows) => rows.filter((row) => row.granted).length;

  return {
    generatedAt: Date.now(),
    generatedAtText: formatTimestamp(Date.now(), extra.timezone),
    vehicle: {
      vin,
      model: modelLabel(carType),
      carType: carType ? carType.toUpperCase() : '-',
      statusPath: String(extra.statusPath || Constants.vehicleStatusPath(carType)).toUpperCase(),
      year: text(source.year),
      name: text(source.nickName || source.carAlias || source.vinNickname || extra.name),
      alias: text(source.carAlias || source.vinNickname),
      plateNumber: text(source.plateNumber),
      colour: text(source.outColor),
      configEdition: text(source.carConfigEdition),
      rudder: rudderLabel(source.rudder),
      seats: seatLabel(source.seatLayout),
      seatLayoutCode: text(source.seatLayout)
    },
    identifiers: {
      vin,
      carId: text(source.carId),
      ownerUserId: text(source.userid || source.userId),
      accountUserId: text(extra.userId),
      deviceId: text(extra.deviceId),
      allocationCode: text(source.allocationCode),
      email: text(source.email || extra.username)
    },
    connection: {
      appVersion: text(extra.appVersion || Constants.DEFAULT_APP_VERSION),
      apiLanguage: text(extra.language || Constants.DEFAULT_LANGUAGE),
      baseUrl: text(extra.baseUrl || Constants.DEFAULT_BASE_URL),
      statusEndpoint: `${Constants.ENDPOINT_VEHICLE_STATUS}${String(extra.statusPath || Constants.vehicleStatusPath(carType)).toLowerCase()}`,
      channel: Constants.DEFAULT_CHANNEL,
      deviceType: Constants.DEFAULT_DEVICE_TYPE,
      source: Constants.DEFAULT_SOURCE,
      encryptionAlgorithm: Constants.DEFAULT_P12_ENC_ALG,
      policyId: Constants.DEFAULT_POLICY_ID
    },
    sharing: {
      shared: source.shareType === undefined && source.shareTime === undefined ? '-' : (extra.shared === true ? 'Shared vehicle' : 'Owned or shared (see share time)'),
      shareType: text(source.shareType),
      shareTime: formatTimestamp(source.shareTime, extra.timezone),
      expireTime: formatTimestamp(source.expireTime, extra.timezone),
      durationType: durationLabel(source.durationType),
      mobileNumber: text(source.mobileNumber)
    },
    rights,
    abilities,
    moduleRights,
    totals: {
      rightsGranted: count(rights),
      rightsTotal: rights.length,
      abilitiesGranted: count(abilities),
      abilitiesTotal: abilities.length,
      moduleRightsGranted: count(moduleRights),
      moduleRightsTotal: moduleRights.length
    }
  };
}

function formatRows(rows) {
  return rows
    .map((row) => `${row.granted ? GRANTED_MARK : MISSING_MARK}  ${String(row.id).padEnd(4, ' ')} ${row.short}`)
    .join('\n');
}

function formatGrantedRows(rows) {
  const granted = rows.filter((row) => row.granted);
  if (granted.length === 0) return '-';
  return granted.map((row) => `${row.id} ${row.short}`).join(', ');
}

function toSettings(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const settings = {
    vehicleModel: `${snapshot.vehicle.model} (${snapshot.vehicle.carType})`,
    vehicleYear: String(snapshot.vehicle.year),
    vehicleName: String(snapshot.vehicle.name),
    vehicleDrive: String(snapshot.vehicle.rudder),
    vehicleSeats: String(snapshot.vehicle.seats),
    vehicleVin: String(snapshot.identifiers.vin || '-'),
    vehicleCarId: String(snapshot.identifiers.carId),
    vehicleUserId: String(snapshot.identifiers.accountUserId),
    vehicleDeviceId: String(snapshot.identifiers.deviceId),
    vehicleAppVersion: String(snapshot.connection.appVersion),
    vehicleApiLanguage: String(snapshot.connection.apiLanguage)
  };
  return settings;
}

module.exports = {
  RIGHT_CATALOG,
  ABILITY_CATALOG,
  MODULE_RIGHT_CATALOG,
  GRANTED_MARK,
  MISSING_MARK,
  toNumberList,
  rudderLabel,
  seatLabel,
  modelLabel,
  formatTimestamp,
  buildSnapshot,
  formatRows,
  formatGrantedRows,
  toSettings
};
