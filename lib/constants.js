'use strict';


const CAR_TYPE_STATUS_PATH = {
  b03x: 'c10',
  b05: 'c10',
  b10: 'c10',
  b11: 'c10',
};

function vehicleStatusPath(carType) {
  const segment = String(carType || '').trim().toLowerCase();
  if (!segment) return 'c10';
  return CAR_TYPE_STATUS_PATH[segment] || segment;
}

module.exports = {
  DEFAULT_BASE_URL: 'https://appgateway.leapmotor-international.de',
  PINNED_HOSTS: {
    'appgateway.leapmotor-international.de': [
      'gVb+SZ2GBCAhSDc1IA2Ra6jc+O4UrAEZWUmZG6FnQvU=',
    ],
  },
  DEFAULT_APP_VERSION: '1.12.3',
  DEFAULT_SOURCE: 'leapmotor',
  DEFAULT_CHANNEL: '1',
  DEFAULT_LANGUAGE: 'en-GB',
  DEFAULT_DEVICE_TYPE: '1',
  DEFAULT_P12_ENC_ALG: '1',
  DEFAULT_POLICY_ID: '20260204',
  DEFAULT_OPERPWD_AES_KEY: 'f1cf0c025baec0e2',
  DEFAULT_OPERPWD_AES_IV: '6b6a1fe94e133fd7',

  CONTENT_TYPE_FORM: 'application/x-www-form-urlencoded; charset=UTF-8',

  ENDPOINT_LOGIN: '/carownerservice/oversea/acct/v1/login',
  ENDPOINT_TOKEN_REFRESH: '/carownerservice/oversea/acct/v1/token/refresh',
  ENDPOINT_VEHICLE_LIST: '/carownerservice/oversea/vehicle/v1/list',
  ENDPOINT_VEHICLE_STATUS: '/carownerservice/oversea/vehicle/v1/status/get/',
  ENDPOINT_MESSAGE_UNREAD: '/carownerservice/oversea/message/v1/unread/count',
  ENDPOINT_CERT_SYNC: '/carownerservice/oversea/vehicle/v1/cert/sync',
  ENDPOINT_OPERPWD_VERIFY: '/carownerservice/oversea/vehicle/v1/operPwd/verify',
  ENDPOINT_REMOTE_CTL: '/carownerservice/oversea/vehicle/v1/app/remote/ctl',
  ENDPOINT_REMOTE_CTL_RESULT: '/carownerservice/oversea/vehicle/v1/app/remote/ctl/result/query',

  VEHICLE_STATUS_SEGMENTS: ['c10', 'c11', 'c16', 'c01', 't03', 's01'],
  DEFAULT_VEHICLE_STATUS_SEGMENT: 'c10',
  CAR_TYPE_STATUS_PATH,
  vehicleStatusPath,

  DEFAULT_TIMEOUT_MS: 30000,
  DEFAULT_REMOTE_POLL_TIMEOUT_MS: 60000,
  DEFAULT_REMOTE_POLL_INTERVAL_MS: 2000,
  VEHICLE_LIST_CACHE_MS: 5 * 60 * 1000,

  DEFAULT_POLL_MINUTES: 5,
  DEFAULT_POLL_MINUTES_NIGHT: 30,
  DEFAULT_DAY_START: '07:00',
  DEFAULT_NIGHT_START: '23:00',

  UNAVAILABLE_AFTER_FAILURES: 3,
};
