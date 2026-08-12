'use strict';
const DIVISOR = 1.609344;
const PRESSURE_CAPABILITIES = [
  'leapmotor_tire_pressure_front_left',
  'leapmotor_tire_pressure_front_right',
  'leapmotor_tire_pressure_rear_left',
  'leapmotor_tire_pressure_rear_right',
  'leapmotor_tire_pressure_average'
];
function isImperial(settings) {
  return settings && settings.distanceUnit === 'mi';
}
function isImperialFlag(flag) {
  return flag === true || flag === 'mi';
}
function kmToMiles(km) {
  if (typeof km !== 'number' || !Number.isFinite(km)) return km;
  return km / DIVISOR;
}
function milesToKm(mi) {
  if (typeof mi !== 'number' || !Number.isFinite(mi)) return mi;
  return mi * DIVISOR;
}
function kmhToMph(kmh) {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh)) return kmh;
  return kmh / DIVISOR;
}
function mphToKmh(mph) {
  if (typeof mph !== 'number' || !Number.isFinite(mph)) return mph;
  return mph * DIVISOR;
}
function toDisplay(capability, metricValue, imperial) {
  if (typeof metricValue !== 'number' || !Number.isFinite(metricValue)) return metricValue;
  if (capability === 'measure_range' || capability === 'leapmotor_odometer' || capability === 'leapmotor_speed') {
    return imperial ? metricValue / DIVISOR : metricValue;
  }
  return metricValue;
}
function toMetric(capability, displayValue, imperial) {
  if (typeof displayValue !== 'number' || !Number.isFinite(displayValue)) return displayValue;
  if (capability === 'measure_range' || capability === 'leapmotor_odometer' || capability === 'leapmotor_speed') {
    return imperial ? displayValue * DIVISOR : displayValue;
  }
  return displayValue;
}
function displaySpeedToKmh(displaySpeed, imperial) {
  if (typeof displaySpeed !== 'number' || !Number.isFinite(displaySpeed)) return displaySpeed;
  return imperial ? displaySpeed * DIVISOR : displaySpeed;
}
function getCapabilityOptions(capability, imperial) {
  if (capability === 'measure_range' || capability === 'leapmotor_odometer') {
    return { units: { en: imperial ? 'mi' : 'km' }, decimals: imperial ? 0 : 2 };
  }
  if (capability === 'leapmotor_speed') {
    return { units: { en: imperial ? 'mph' : 'km/h' }, decimals: imperial ? 0 : 2 };
  }
  if (PRESSURE_CAPABILITIES.indexOf(capability) !== -1) {
    return { units: { en: 'bar' }, decimals: 2 };
  }
  return null;
}
function getConvertibleCapabilities() {
  return ['measure_range', 'leapmotor_odometer', 'leapmotor_speed'];
}
function getStaticCapabilities() {
  return PRESSURE_CAPABILITIES.slice();
}
module.exports = {
  DIVISOR,
  isImperial,
  isImperialFlag,
  kmToMiles,
  milesToKm,
  kmhToMph,
  mphToKmh,
  toDisplay,
  toMetric,
  displaySpeedToKmh,
  getCapabilityOptions,
  getConvertibleCapabilities,
  getStaticCapabilities
};
