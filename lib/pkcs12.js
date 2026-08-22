'use strict';

const LeapmotorException = require('./leapmotorException');

let forge = null;
try {
  forge = require('node-forge/lib/forge');
  require('node-forge/lib/asn1');
  require('node-forge/lib/oids');
  require('node-forge/lib/pkcs12');
  require('node-forge/lib/pki');
  require('node-forge/lib/util');
} catch (err) {
  forge = null;
}

const oids = forge ? forge.pki.oids : {};
const PKCS8_SHROUDED_KEY_BAG = oids.pkcs8ShroudedKeyBag;
const KEY_BAG = oids.keyBag;
const CERT_BAG = oids.certBag;

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

  const shroudedBags = PKCS8_SHROUDED_KEY_BAG ? p12.getBags({ bagType: PKCS8_SHROUDED_KEY_BAG }) : {};
  const plainBags = KEY_BAG ? p12.getBags({ bagType: KEY_BAG }) : {};
  const keyBag = (PKCS8_SHROUDED_KEY_BAG ? shroudedBags[PKCS8_SHROUDED_KEY_BAG] : null
    || (KEY_BAG ? plainBags[KEY_BAG] : null)
    || [])[0];

  if (!keyBag || !keyBag.key) {
    throw new LeapmotorException('The account PKCS#12 does not contain a private key.', { authError: true });
  }

  const certBags = CERT_BAG ? (p12.getBags({ bagType: CERT_BAG })[CERT_BAG] || []) : [];
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
