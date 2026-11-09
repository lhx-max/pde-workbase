# Local MF protocol fixture TLS

The certificate and private key in this directory are **public test fixtures**, not credentials. They identify only `localhost` / `127.0.0.1`, and must never be used for deployment or added to system/browser trust stores.

The shared E2E runtime starts an owned Node HTTPS service and gives only its child tools-dev runtime this certificate through `NODE_EXTRA_CA_CERTS`. It creates a separate `0600` cookie file containing a clearly fake marker under the owned runtime scratch directory. Production MF HTTPS verification remains enabled. No real MF account or model is contacted.

Generated with OpenSSL (`req -x509 -newkey rsa:2048 -nodes`, SAN `DNS:localhost,IP:127.0.0.1`, CA basic constraint, ten-year test validity). Regenerate these test-only assets together if they expire; never copy a real private key here.

The fixture implements only the pinned SDK paths exercised by the tests. Unknown protocol requests are recorded and return 404, not fabricated generic success. SSE completion is explicitly controlled by tests, and WebSocket subscriptions traverse the real listener/proxy. Browser HTTP and WebSocket traffic is intercepted before navigation: non-loopback requests are blocked and attached as evidence.
