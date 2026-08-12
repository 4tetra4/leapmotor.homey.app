'use strict';

/**
 * PKCS#12 -> PEM conversion for the per-account client certificate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (bug fix)
 * ---------------------------------------------------------------------------
 * The original app handed the raw PKCS#12 blob straight to Node's TLS stack
 * (`{ pfx, passphrase }`). Homey Pro (2023) runs Node 18, which is linked
 * against OpenSSL 3. OpenSSL 3 moved RC2-40-CBC / 40-bit RC4 (the algorithms
 * Leapmotor's gateway uses to protect the account P12) into the *legacy*
 * provider, which is NOT loaded by default. The result is a hard failure:
 *
 *     error:0308010C:digital envelope routines::unsupported
 *     error:11800071:PKCS12 routines::mac verify failure
 *
 * ...on every authenticated request, i.e. the app could never get past login
 * on a modern Homey.
 *
 * We therefore parse the PKCS#12 in pure JavaScript with `node-forge` and hand
 * Node plain PEM (`cert` + `key`) instead. The PEM is cached in the device
 * store so the (relatively expensive) parse only happens once per login.
 *
 * If node-forge is unavailable for some reason we fall back to the native
 * `pfx` path so the app still works on runtimes with the legacy provider.
 */

const LeapmotorException = require('./leapmotorException');

let forge = null;
try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  forge = require('node-forge');
} catch (err) {
  forge = null;
}

/**
 * @param {string} base64Cert base64 encoded PKCS#12 blob
 * @param {string} password   derived P12 password
 * @returns {{cert: string, key: string}} PEM strings
 */
function p12ToPem(base64Cert, password) {
  if (!base64Cert) {
    throw new LeapmotorException('Login response did not contain an account certificate (base64Cert).', {
      authError: true,
    });
  }
  if (!forge) {
    throw new LeapmotorException('node-forge is not installed; cannot convert the account certificate.');
  }

  let p12;
  try {
    const der = forge.util.decode64(String(base64Cert).replace(/\s+/g, ''));
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    throw new LeapmotorException(`Unable to decode the account PKCS#12 certificate: ${err.message}`, {
      authError: true,
    });
  }

  // --- private key -------------------------------------------------------
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (plainKeyBags[forge.pki.oids.keyBag] || [])[0];

  if (!keyBag || !keyBag.key) {
    throw new LeapmotorException('The account PKCS#12 does not contain a private key.', { authError: true });
  }

  // --- certificate chain -------------------------------------------------
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (certBags.length === 0) {
    throw new LeapmotorException('The account PKCS#12 does not contain a certificate.', { authError: true });
  }

  const certPem = certBags
    .filter((bag) => bag && bag.cert)
    .map((bag) => forge.pki.certificateToPem(bag.cert))
    .join('');

  return {
    cert: certPem,
    key: forge.pki.privateKeyToPem(keyBag.key),
  };
}

module.exports = {
  available: Boolean(forge),
  p12ToPem,
};
