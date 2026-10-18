# Local HTTPS for phone geolocation

Phone geolocation requires a trusted secure origin. Generate a local development CA and a separate server certificate with `npm run cert:local -- 192.168.1.222` (replace the IP if this computer's LAN address changes). Requires OpenSSL; Windows uses the OpenSSL bundled with Git when available, or set `OPENSSL_PATH` to its executable. This does not install trust on any device. Certificates and private keys stay in ignored `.local/tls/`; never share `ca.key` or `server.key`.

Set the ignored local `.env`, then restart `npm run dev`:

```dotenv
HOST=192.168.1.222
PORT=5173
HTTPS_PORT=5174
TLS_CERT_FILE=.local/tls/server.pem
TLS_KEY_FILE=.local/tls/server.key
TLS_CA_FILE=.local/tls/ca.cer
```

On the phone in the same Wi-Fi network, download the **public CA certificate** from `http://192.168.1.222:5173/dev-ca.cer`. Compare its SHA-256 fingerprint with the generator's output before installing. On iPhone, install the downloaded profile in Settings → General → VPN & Device Management, then enable **Warsaw AI Local Development CA** under General → About → Certificate Trust Settings ([Apple instructions](https://support.apple.com/en-us/102390)). On Android, install the downloaded file as a **CA certificate** under Security & privacy → More security settings → Encryption & credentials; wording varies by manufacturer ([Google instructions](https://support.google.com/pixelphone/answer/2844832?hl=en)). Then open **`https://192.168.1.222:5174`** and allow location in the browser. Merely bypassing a certificate warning does not establish a trusted origin.

HTTP and HTTPS share one backend process, assistant state and live-transit tracker. The CA download exposes only the public certificate. HTTPS is opt-in and invalid/missing TLS files stop startup with a clear error. Re-running the generator preserves the CA (phone trust remains valid) and renews the server certificate for the supplied IPs plus localhost/127.0.0.1. It refuses to replace an incomplete, invalid or expired CA: rotate it deliberately and reinstall trust if needed. Remove this development CA from the phone when no longer needed. This local server has no public-deployment authentication; keep it on the trusted LAN.
