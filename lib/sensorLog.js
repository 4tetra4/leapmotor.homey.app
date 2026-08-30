'use strict';
const fs = require('fs');
const path = require('path');

const USERDATA = '/userdata';
const STORE_ENABLED = 'sensorLogEnabled';
const STORE_FILE = 'sensorLogFile';
const STORE_COLUMNS = 'sensorLogColumns';
const MAX_BYTES = 1048576;
const NAME_PREFIX = 'Leapmotor_sensor_data_';
const NAME_RE = /^Leapmotor_sensor_data_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}\.csv$/;
const LEGACY_NAME_RE = /^slog-[a-z0-9]+-[a-f0-9]+\.csv$/;
const CLAIMED_NAMES = new Set();
const COLUMNS = [
  { id: 'odometer', label: 'Odometer', def: true },
  { id: 'speed', label: 'Speed', def: true },
  { id: 'soc', label: 'Precise SOC', def: true },
  { id: 'chargingPower', label: 'Charging power', def: true },
  { id: 'cable', label: 'Cable connected', def: false },
  { id: 'cabinTemp', label: 'Cabin temperature', def: true },
  { id: 'batteryTemp', label: 'Battery temperature', def: true },
  { id: 'heating', label: 'Heating', def: false },
  { id: 'ac', label: 'AC', def: false },
  { id: 'locked', label: 'Vehicle locked', def: false },
  { id: 'gear', label: 'Gear status', def: false },
  { id: 'location', label: 'Longitude/Latitude', def: false },
  { id: 'tires', label: 'Tire pressures', def: true }
];

function isKnownName(name) {
  if (typeof name !== 'string') return false;
  return NAME_RE.test(name) || LEGACY_NAME_RE.test(name);
}

function pad2(value) {
  const text = String(value);
  return text.length < 2 ? '0' + text : text;
}

function stampParts(date, timeZone) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).formatToParts(date);
      const map = {};
      for (let i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
      const hour = map.hour === '24' ? '00' : map.hour;
      if (map.year && map.month && map.day && hour && map.minute && map.second) {
        return [map.year, map.month, map.day, hour, map.minute, map.second];
      }
    } catch (err) {
    }
  }
  return [
    String(date.getUTCFullYear()),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds())
  ];
}

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) {
    const kb = bytes / 1024;
    return (kb >= 10 ? String(Math.round(kb)) : String(Math.round(kb * 10) / 10)) + ' KB';
  }
  return (Math.round((bytes / 1048576) * 100) / 100) + ' MB';
}

function csvNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(Math.round(value * 1000) / 1000);
}

function csvCoord(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(Math.round(value * 1000000) / 1000000);
}

function csvText(value) {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvYesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

function defaultColumns() {
  const out = {};
  for (let i = 0; i < COLUMNS.length; i++) out[COLUMNS[i].id] = COLUMNS[i].def === true;
  return out;
}

function sanitiseColumns(input) {
  const base = defaultColumns();
  if (!input || typeof input !== 'object') return base;
  for (let i = 0; i < COLUMNS.length; i++) {
    const id = COLUMNS[i].id;
    if (Object.prototype.hasOwnProperty.call(input, id)) base[id] = input[id] === true;
  }
  if (input.gear === undefined && input.parked === true) base.gear = true;
  return base;
}

function columnKey(cols) {
  let key = '';
  for (let i = 0; i < COLUMNS.length; i++) key += cols[COLUMNS[i].id] ? '1' : '0';
  return key;
}

function headerFor(cols) {
  const parts = ['Date/Time'];
  if (cols.odometer) parts.push('Odometer (km)');
  if (cols.speed) parts.push('Speed (km/h)');
  if (cols.soc) parts.push('Precise SOC (%)');
  if (cols.chargingPower) parts.push('Charging power (kW)');
  if (cols.cable) parts.push('Cable connected');
  if (cols.cabinTemp) parts.push('Cabin temperature (\u00b0C)');
  if (cols.batteryTemp) parts.push('Battery temperature (\u00b0C)');
  if (cols.heating) parts.push('Heating');
  if (cols.ac) parts.push('AC');
  if (cols.locked) parts.push('Vehicle locked');
  if (cols.gear) parts.push('Gear status');
  if (cols.location) {
    parts.push('Longitude');
    parts.push('Latitude');
  }
  if (cols.tires) {
    parts.push('Tire pressure FL (bar)');
    parts.push('Tire pressure FR (bar)');
    parts.push('Tire pressure RL (bar)');
    parts.push('Tire pressure RR (bar)');
  }
  return '\uFEFF' + parts.join(',') + '\n';
}

function cableText(src) {
  const plug = src.leapmotor_plug_type;
  if (plug === 'ccs') return 'CCS';
  if (plug === 'type2') return 'Type2';
  if (plug === 'no') return 'Unplugged';
  return csvYesNo(src.leapmotor_plugged);
}

function heatingValue(src) {
  if (typeof src.leapmotor_cabin_heating === 'boolean') return src.leapmotor_cabin_heating;
  if (typeof src.leapmotor_fast_heating === 'boolean') return src.leapmotor_fast_heating;
  if (typeof src.leapmotor_heating === 'boolean') return src.leapmotor_heating;
  return null;
}

function gearText(src) {
  const named = src.leapmotor_gear;
  if (named === 'park') return 'Park';
  if (named === 'drive') return 'Drive';
  if (named === 'neutral') return 'Neutral';
  if (named === 'reverse') return 'Reverse';
  const gear = src.__gearStatus;
  if (gear === 0) return 'Park';
  if (gear === 1) return 'Reverse';
  if (gear === 2) return 'Neutral';
  if (gear === 3) return 'Drive';
  return '';
}

function rowFor(cols, src, timestamp) {
  const parts = [csvText(timestamp)];
  if (cols.odometer) parts.push(csvNumber(src.leapmotor_odometer));
  if (cols.speed) parts.push(csvNumber(src.leapmotor_speed));
  if (cols.soc) {
    const soc = src.leapmotor_soc !== undefined && src.leapmotor_soc !== null ? src.leapmotor_soc : src.measure_battery;
    parts.push(csvNumber(soc));
  }
  if (cols.chargingPower) parts.push(csvNumber(src.leapmotor_charging_power_kw));
  if (cols.cable) parts.push(csvText(cableText(src)));
  if (cols.cabinTemp) parts.push(csvNumber(src.measure_temperature));
  if (cols.batteryTemp) parts.push(csvNumber(src.leapmotor_battery_temperature));
  if (cols.heating) parts.push(csvYesNo(heatingValue(src)));
  if (cols.ac) parts.push(csvYesNo(src.leapmotor_ac));
  if (cols.locked) parts.push(csvYesNo(src.leapmotor_locked));
  if (cols.gear) parts.push(csvText(gearText(src)));
  if (cols.location) {
    parts.push(csvCoord(src.leapmotor_longitude));
    parts.push(csvCoord(src.leapmotor_latitude));
  }
  if (cols.tires) {
    parts.push(csvNumber(src.leapmotor_tire_pressure_front_left));
    parts.push(csvNumber(src.leapmotor_tire_pressure_front_right));
    parts.push(csvNumber(src.leapmotor_tire_pressure_rear_left));
    parts.push(csvNumber(src.leapmotor_tire_pressure_rear_right));
  }
  return parts.join(',') + '\n';
}

class SensorLog {
  constructor(device) {
    this.device = device;
    this._name = null;
    this._cols = null;
  }

  isEnabled() {
    return this.device.getStoreValue(STORE_ENABLED) === true;
  }

  columns() {
    if (this._cols) return this._cols;
    this._cols = sanitiseColumns(this.device.getStoreValue(STORE_COLUMNS));
    return this._cols;
  }

  columnList() {
    const cols = this.columns();
    const list = [];
    for (let i = 0; i < COLUMNS.length; i++) {
      list.push({ id: COLUMNS[i].id, label: COLUMNS[i].label, enabled: cols[COLUMNS[i].id] === true });
    }
    return list;
  }

  async setEnabled(enabled) {
    const on = enabled === true;
    await this.device.setStoreValue(STORE_ENABLED, on);
    if (on) this._ensureFile();
  }

  async setColumns(input) {
    const next = sanitiseColumns(input);
    const prevKey = columnKey(this.columns());
    const nextKey = columnKey(next);
    this._cols = next;
    await this.device.setStoreValue(STORE_COLUMNS, next);
    if (prevKey !== nextKey && this._stat().exists) await this.clear();
    if (this.isEnabled()) this._ensureFile();
  }

  _timeZone() {
    try {
      return this.device.homey.clock.getTimezone();
    } catch (err) {
      return undefined;
    }
  }

  _formatName(when) {
    const parts = stampParts(when, this._timeZone());
    return NAME_PREFIX + parts.slice(0, 3).join('-') + '_' + parts.slice(3).join('-') + '.csv';
  }

  _newFileName(when) {
    let stamp = when instanceof Date && Number.isFinite(when.getTime()) ? when : new Date();
    let name = this._formatName(stamp);
    let guard = 0;
    while ((CLAIMED_NAMES.has(name) || fs.existsSync(path.join(USERDATA, name))) && guard < 3600) {
      stamp = new Date(stamp.getTime() + 1000);
      name = this._formatName(stamp);
      guard += 1;
    }
    CLAIMED_NAMES.add(name);
    return name;
  }

  _migrateLegacyName(stored) {
    if (typeof stored !== 'string' || !LEGACY_NAME_RE.test(stored)) return null;
    const legacyPath = path.join(USERDATA, stored);
    let when = null;
    try {
      const st = fs.statSync(legacyPath);
      const raw = st && Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
      when = new Date(raw);
    } catch (err) {
      when = null;
    }
    if (!when || !Number.isFinite(when.getTime())) when = new Date();
    const next = this._newFileName(when);
    try {
      fs.renameSync(legacyPath, path.join(USERDATA, next));
    } catch (err) {
      this._name = stored;
      return stored;
    }
    this._name = next;
    this.device.setStoreValue(STORE_FILE, next).catch(() => {});
    return next;
  }

  fileName() {
    if (this._name && isKnownName(this._name)) return this._name;
    const stored = this.device.getStoreValue(STORE_FILE);
    if (typeof stored === 'string' && NAME_RE.test(stored)) {
      this._name = stored;
      CLAIMED_NAMES.add(stored);
      return stored;
    }
    const migrated = this._migrateLegacyName(stored);
    if (migrated) return migrated;
    const created = this._newFileName(new Date());
    this._name = created;
    this.device.setStoreValue(STORE_FILE, created).catch(() => {});
    return created;
  }

  filePath() {
    return path.join(USERDATA, this.fileName());
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(USERDATA)) fs.mkdirSync(USERDATA);
    } catch (err) {
    }
  }

  _ensureFile() {
    this._ensureDir();
    const fp = this.filePath();
    try {
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, headerFor(this.columns()), { encoding: 'utf8' });
    } catch (err) {
    }
    return fp;
  }

  _stat() {
    const stored = this._name || this.device.getStoreValue(STORE_FILE);
    if (!isKnownName(stored)) {
      return { exists: false, size: 0, rows: 0, full: false };
    }
    try {
      const st = fs.statSync(path.join(USERDATA, stored));
      const size = st && st.size ? st.size : 0;
      const headerLen = headerFor(this.columns()).length;
      const dataBytes = size > headerLen ? size - headerLen : 0;
      const rows = dataBytes > 0 ? Math.max(1, Math.round(dataBytes / 90)) : 0;
      return { exists: true, size, rows, full: size >= MAX_BYTES };
    } catch (err) {
      return { exists: false, size: 0, rows: 0, full: false };
    }
  }

  getState() {
    const stat = this._stat();
    const stored = this._name || this.device.getStoreValue(STORE_FILE);
    return {
      enabled: this.isEnabled(),
      filename: isKnownName(stored) ? stored : null,
      exists: stat.exists,
      size: stat.size,
      sizeText: formatBytes(stat.size),
      rows: stat.rows,
      full: stat.full,
      maxBytes: MAX_BYTES,
      maxText: formatBytes(MAX_BYTES),
      columns: this.columnList()
    };
  }

  _stamp(when) {
    const date = when instanceof Date && Number.isFinite(when.getTime()) ? when : new Date();
    const parts = stampParts(date, this._timeZone());
    return parts.slice(0, 3).join('-') + ' ' + parts.slice(3).join(':');
  }

  record(rawStatus, values) {
    if (this.device.getStoreValue(STORE_ENABLED) !== true) return;
    const src = values && typeof values === 'object' ? values : {};
    const reported = Number(src.__reportTime);
    const when = Number.isFinite(reported) && reported > 0 ? new Date(reported) : new Date();
    this.append(src, this._stamp(when));
  }

  append(values, timestamp) {
    if (this.device.getStoreValue(STORE_ENABLED) !== true) return;
    const src = values && typeof values === 'object' ? values : {};
    const cols = this.columns();
    let fp;
    try {
      fp = this._ensureFile();
      const st = fs.statSync(fp);
      if (st && st.size >= MAX_BYTES) return;
    } catch (err) {
      return;
    }
    try {
      fs.appendFileSync(fp, rowFor(cols, src, timestamp), { encoding: 'utf8' });
    } catch (err) {
    }
  }

  async clear() {
    const stored = this._name || this.device.getStoreValue(STORE_FILE);
    this._name = null;
    if (isKnownName(stored)) {
      try {
        fs.unlinkSync(path.join(USERDATA, stored));
      } catch (err) {
      }
    }
    try {
      await this.device.unsetStoreValue(STORE_FILE);
    } catch (err) {
      try {
        await this.device.setStoreValue(STORE_FILE, null);
      } catch (err2) {
      }
    }
  }

  removeFile() {
    const stored = this._name || this.device.getStoreValue(STORE_FILE);
    this._name = null;
    if (!isKnownName(stored)) return;
    try {
      fs.unlinkSync(path.join(USERDATA, stored));
    } catch (err) {
    }
  }

  readChunk(offset, length) {
    const stored = this._name || this.device.getStoreValue(STORE_FILE);
    if (!isKnownName(stored)) {
      return { ok: true, chunk: '', offset: 0, next: 0, done: true, size: 0 };
    }
    const fp = path.join(USERDATA, stored);
    const start = Math.max(0, Number(offset) || 0);
    const want = Math.min(Math.max(Number(length) || 8192, 1), 12288);
    let fd;
    try {
      const st = fs.statSync(fp);
      const size = st && st.size ? st.size : 0;
      if (start >= size) {
        return { ok: true, chunk: '', offset: start, next: size, done: true, size };
      }
      const len = Math.min(want, size - start);
      const buf = Buffer.allocUnsafe(len);
      fd = fs.openSync(fp, 'r');
      const n = fs.readSync(fd, buf, 0, len, start);
      const next = start + n;
      return {
        ok: true,
        chunk: buf.toString('utf8', 0, n),
        offset: start,
        next,
        done: next >= size,
        size
      };
    } catch (err) {
      return { ok: false, error: err.message, chunk: '', offset: start, next: start, done: true, size: 0 };
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch (err) {
        }
      }
    }
  }
}

module.exports = SensorLog;
