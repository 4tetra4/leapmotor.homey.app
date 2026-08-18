'use strict';

const LeapmotorException = require('./leapmotorException');

let forge = null;
try {
  forge = require('node-forge');
} catch (err) {
  forge = null;
}

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

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (plainKeyBags[forge.pki.oids.keyBag] || [])[0];

  if (!keyBag || !keyBag.key) {
    throw new LeapmotorException('The account PKCS#12 does not contain a private key.', { authError: true });
  }

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
