'use strict';

class LeapmotorException extends Error {

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