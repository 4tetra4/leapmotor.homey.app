'use strict';


class LeapmotorException extends Error {
  /**
   * @param {string} message
   * @param {object} [options]
   * @param {string|number|null} [options.code]      API result code
   * @param {number|null} [options.httpStatus]       HTTP status code
   * @param {boolean} [options.authError]            token/credentials problem
   * @param {boolean} [options.retryable]            transient (network) problem
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'LeapmotorException';
    this.code = options.code === undefined ? null : options.code;
    this.httpStatus = options.httpStatus === undefined ? null : options.httpStatus;
    this.authError = options.authError === true;
    this.retryable = options.retryable === true;
    if (Error.captureStackTrace) Error.captureStackTrace(this, LeapmotorException);
  }
}

module.exports = LeapmotorException;