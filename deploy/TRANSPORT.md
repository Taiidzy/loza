# Network modes

Loza supports two intentional transport modes.

## Home LAN (HTTP)

Set `BACKEND_BIND_ADDRESS=0.0.0.0` in `.env` and connect clients to a
private address such as `http://192.168.1.10:4242` or `http://loza.local:4242`.
HTTP is accepted by the apps only for loopback, private/link-local IP ranges,
IPv6 local ranges, and `.local` names. Do not expose this port to the Internet.

## Public server (HTTPS)

Set `BACKEND_BIND_ADDRESS=127.0.0.1` and `TRUST_PROXY_HEADERS=true` in `.env`, start the Compose stack, and
place a TLS reverse proxy in front of it. A host-Nginx template is available in
`deploy/nginx/loza.conf.example`; replace its hostname, obtain a trusted
certificate, and expose only ports 80 and 443. Clients must use an explicit
`https://` URL for a public server.

The proxy template forwards WebSocket upgrade headers for `/ws/status`.
