import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { X509Certificate, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function matchingKey(cert, key) {
  return cert.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'der' }));
}

export async function generateDevCertificate({ directory = join(root, '.local', 'tls'), hosts = ['localhost', '127.0.0.1'], openssl = process.env.OPENSSL_PATH } = {}) {
  hosts = [...new Set(hosts)];
  if (!hosts.length || hosts.some(host => !isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(host))) throw new Error('Podaj poprawne adresy IP lub nazwy hostów.');
  if (!openssl) {
    const gitOpenSSL = 'C:/Program Files/Git/usr/bin/openssl.exe';
    openssl = process.platform === 'win32' && await exists(gitOpenSSL) ? gitOpenSSL : 'openssl';
  }
  const run = args => {
    const result = spawnSync(openssl, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    if (result.error || result.status !== 0) throw new Error('Nie udało się uruchomić OpenSSL. Sprawdź OPENSSL_PATH i dostęp do katalogu certyfikatów.');
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const paths = Object.fromEntries(['ca.key', 'ca.pem', 'ca.cer', 'server.key', 'server.pem'].map(name => [name, join(directory, name)]));
  const keyExists = await exists(paths['ca.key']), certExists = await exists(paths['ca.pem']);
  if (keyExists !== certExists) throw new Error('Niekompletna istniejąca CA. Zachowaj pliki i napraw je przed ponowną generacją; CA nie została nadpisana.');
  const stage = join(directory, '.generate-' + randomBytes(8).toString('hex'));
  await mkdir(stage, { mode: 0o700 });
  try {
    if (!keyExists) {
      run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '365', '-subj', '/CN=Warsaw AI Local Development CA', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', join(stage, 'ca.key'), '-out', join(stage, 'ca.pem')]);
    }
    const caCertPath = keyExists ? paths['ca.pem'] : join(stage, 'ca.pem');
    const caKeyPath = keyExists ? paths['ca.key'] : join(stage, 'ca.key');
    const ca = new X509Certificate(await readFile(caCertPath));
    if (!ca.ca || !ca.verify(ca.publicKey) || !matchingKey(ca, await readFile(caKeyPath)) || Date.parse(ca.validTo) <= Date.now() + 86400000) throw new Error('Istniejąca CA jest niepoprawna lub wygasa. Nie nadpisano CA; potrzebna jest świadoma rotacja i ponowna instalacja zaufania.');
    const days = Math.min(365, Math.floor((Date.parse(ca.validTo) - Date.now()) / 86400000));
    const san = hosts.map(host => (isIP(host) ? 'IP:' : 'DNS:') + host).join(',');
    await writeFile(join(stage, 'server.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`, { mode: 0o600 });
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=Warsaw AI Local Server', '-keyout', join(stage, 'server.key'), '-out', join(stage, 'server.csr')]);
    run(['x509', '-req', '-in', join(stage, 'server.csr'), '-CA', caCertPath, '-CAkey', caKeyPath, '-set_serial', '0x' + randomBytes(16).toString('hex'), '-days', String(days), '-sha256', '-extfile', join(stage, 'server.ext'), '-out', join(stage, 'server.pem')]);
    const leaf = new X509Certificate(await readFile(join(stage, 'server.pem')));
    if (!leaf.verify(ca.publicKey) || leaf.ca || !matchingKey(leaf, await readFile(join(stage, 'server.key'))) || hosts.some(host => isIP(host) ? !leaf.checkIP(host) : !leaf.checkHost(host))) throw new Error('Weryfikacja certyfikatu serwera nie powiodła się.');
    if (!keyExists) {
      await rename(join(stage, 'ca.key'), paths['ca.key']);
      await rename(join(stage, 'ca.pem'), paths['ca.pem']);
    }
    await writeFile(paths['ca.cer'], ca.raw);
    await rename(join(stage, 'server.key'), paths['server.key']);
    await rename(join(stage, 'server.pem'), paths['server.pem']);
    return { directory, hosts, fingerprint: ca.fingerprint256, reusedCA: keyExists };
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const hosts = [...new Set(['localhost', '127.0.0.1', ...process.argv.slice(2)])];
    const result = await generateDevCertificate({ hosts });
    console.log(`Gotowy publiczny certyfikat do instalacji: ${join(result.directory, 'ca.cer')}\nCA SHA-256: ${result.fingerprint}\nHosty: ${result.hosts.join(', ')}\n${result.reusedCA ? 'Zachowano istniejącą CA.' : 'Utworzono nową lokalną CA.'}\nKlucze prywatne pozostają lokalnie; nie wysyłaj ich na telefon.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
