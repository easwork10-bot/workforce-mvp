const { createPrivateKey, createPublicKey, randomBytes, sign, verify } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

function decodeBase64Key(environmentName, encoded) {
  const normalized = encoded.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error(`${environmentName} must contain valid base64-encoded PEM key material.`);
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new Error(`${environmentName} must contain valid base64-encoded PEM key material.`);
  }

  return decoded.toString('utf8');
}

async function readLegacyKeyPair() {
  const directories = [...new Set([
    path.resolve(process.cwd(), 'secrets'),
    path.resolve(__dirname, '../../secrets'),
    path.resolve(__dirname, '../../../secrets'),
  ])];
  const discovered = [];

  for (const directory of directories) {
    const privatePath = path.join(directory, 'jwt_private_key.pem');
    const publicPath = path.join(directory, 'jwt_public_key.pem');
    let privateKeyPem;
    let publicKeyPem;

    try {
      privateKeyPem = await readFile(privatePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Unable to read the legacy JWT private key at ${privatePath}.`);
      }
    }

    try {
      publicKeyPem = await readFile(publicPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Unable to read the legacy JWT public key at ${publicPath}.`);
      }
    }

    if (privateKeyPem === undefined && publicKeyPem === undefined) continue;
    if (privateKeyPem === undefined || publicKeyPem === undefined) {
      throw new Error(`The legacy JWT key pair in ${directory} is incomplete.`);
    }
    discovered.push({ privateKeyPem, publicKeyPem });
  }

  if (discovered.length === 0) {
    throw new Error(
      'JWT keys are not configured. Set both JWT_PRIVATE_KEY_FILE and JWT_PUBLIC_KEY_FILE, or both JWT_PRIVATE_KEY_B64 and JWT_PUBLIC_KEY_B64.'
    );
  }
  if (discovered.length > 1) {
    throw new Error('Multiple legacy JWT key pairs were found; configure one explicit key source.');
  }

  return discovered[0];
}

async function readJwtKeyMaterial(environment = process.env) {
  const privateFile = environment.JWT_PRIVATE_KEY_FILE;
  const publicFile = environment.JWT_PUBLIC_KEY_FILE;
  const privateB64 = environment.JWT_PRIVATE_KEY_B64;
  const publicB64 = environment.JWT_PUBLIC_KEY_B64;
  const hasFileConfiguration = Boolean(privateFile?.trim() || publicFile?.trim());
  const hasBase64Configuration = Boolean(privateB64?.trim() || publicB64?.trim());

  if (hasFileConfiguration && hasBase64Configuration) {
    throw new Error('Configure JWT keys using either file paths or base64 variables, not both.');
  }

  if (hasFileConfiguration) {
    if (!privateFile?.trim() || !publicFile?.trim()) {
      throw new Error('JWT_PRIVATE_KEY_FILE and JWT_PUBLIC_KEY_FILE must both be configured.');
    }

    try {
      const [privateKeyPem, publicKeyPem] = await Promise.all([
        readFile(privateFile, 'utf8'),
        readFile(publicFile, 'utf8'),
      ]);
      return { privateKeyPem, publicKeyPem };
    } catch {
      throw new Error('Unable to read the configured JWT key files.');
    }
  }

  if (hasBase64Configuration) {
    if (!privateB64?.trim() || !publicB64?.trim()) {
      throw new Error('JWT_PRIVATE_KEY_B64 and JWT_PUBLIC_KEY_B64 must both be configured.');
    }
    return {
      privateKeyPem: decodeBase64Key('JWT_PRIVATE_KEY_B64', privateB64),
      publicKeyPem: decodeBase64Key('JWT_PUBLIC_KEY_B64', publicB64),
    };
  }

  return readLegacyKeyPair();
}

async function loadJwtKeyMaterial(environment = process.env) {
  const material = await readJwtKeyMaterial(environment);
  let privateKey;
  let publicKey;

  try {
    privateKey = createPrivateKey(material.privateKeyPem);
    publicKey = createPublicKey(material.publicKeyPem);
    if (
      privateKey.asymmetricKeyType !== 'rsa' ||
      publicKey.asymmetricKeyType !== 'rsa' ||
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error('invalid key type or size');
    }
  } catch {
    throw new Error('JWT keys must be valid RSA PKCS#8/SPKI keys with at least 2048-bit modulus.');
  }

  const challenge = randomBytes(32);
  const signature = sign('RSA-SHA256', challenge, privateKey);
  if (!verify('RSA-SHA256', challenge, publicKey, signature)) {
    throw new Error('JWT private and public keys do not form a matching RS256 key pair.');
  }

  return material;
}

module.exports = { loadJwtKeyMaterial };
