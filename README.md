# Local VerusID Provisioning Webhook

Local VRSCTEST provisioning tool for testing Verus Mobile choose-name VerusID
flows.

It generates signed GenericRequest QR codes, serves the provisioning webhook
that Verus Mobile posts to, verifies wallet provisioning signatures, and can
submit the VRSCTEST `registernamecommitment` and `registeridentity` RPC calls
through your local `verusd`.

## Safety

This is a local development tool, not a hosted service. Run it only against
VRSCTEST. The app can submit real VRSCTEST transactions from the configured
local wallet and stores request history on disk.

By default the dashboard binds to `127.0.0.1`. If you need to test with a
physical phone, prefer a trusted tunnel that forwards to localhost. Only set
`UI_HOST` to `0.0.0.0` on a trusted LAN, and do not expose the dashboard or
webhook to the public internet without adding your own access controls.

The local request store is `data/provisioning-requests.json`. It can contain
wallet addresses, VerusID names, request IDs, QR deeplinks, signatures, salts,
and txids. The `data/` directory is ignored by Git.

Never commit `config.js`, private keys, WIFs, wallet files, RPC credentials, or
runtime request data.

## Prerequisites

- Node.js 20+
- Yarn 1.x
- A local `verusd` configured for VRSCTEST
- RPC credentials for that node
- A local single-signature VRSCTEST identity that can sign provisioning
  requests
- A local VRSCTEST currency namespace to use as the SubID parent

## Setup

```bash
yarn install
cp config.example.js config.js
```

Edit `config.js` for your local environment.

`RPC_USER`, `RPC_PASSWORD`, `RPC_HOST`, and `RPC_PORT` can be omitted if your
local VRSCTEST conf is at:

```text
~/Library/Application Support/Komodo/vrsctest/vrsctest.conf
```

Set `VRSCTEST_CONF_PATH` if your conf file lives somewhere else.

`PROVISIONING_SIGNING_ID` is optional. If set, the dashboard preselects it as
the signer VerusID. The signer signs the QR and provisioning responses; it does
not need to be the same identity as the parent namespace.

`VERUS_SIGNING_WIF` is optional. If omitted, local `verusd` signs via RPC, which
requires the selected signer to exist in your local wallet.

`COMMITMENT_CONTROL_ADDRESS` is optional. If omitted, the selected parent
currency namespace's first primary address is used for the name commitment
transaction.

`UI_HOST` defaults to `127.0.0.1`. Use `0.0.0.0` only when you intentionally
want another device on a trusted network to reach the dashboard directly.

## Run

```bash
yarn dev
```

Open:

```text
http://localhost:3010
```

## Flow

1. Select the signer VerusID.
2. Select a parent currency namespace, for example `sampleparent@`. If the
   signer is also a valid parent currency namespace, the dashboard selects it by
   default while still allowing another valid parent to be chosen.
3. Generate the provisioning QR. By default, the QR includes the dashboard URL
   as a redirect URI so Verus Mobile can return there after link-and-login
   completes.
4. Scan or open the QR in Verus Mobile.
5. Enter a child name, for example `samplechild`.
6. The webhook verifies the wallet signature and starts automatic registration.
7. The backend submits `registernamecommitment` and returns signed
   `PENDINGAPPROVAL`.
8. A background worker waits for one confirmation, then submits
   `registeridentity` with the mobile wallet R-address as the SubID owner.
9. The status endpoint returns signed `COMPLETE` once `getidentity` shows the
   created ID and its primary address matches the mobile wallet address.
10. After the ready notification is opened and the ID is linked, Verus Mobile
   opens the configured redirect URI.

Each provisioning request shows compact status summaries by default. Expand a
request to inspect and copy technical details such as full txids, request IDs,
wallet addresses, redirect URI, and the last recorded automation state.

For a physical phone, set `WEBHOOK_BASE_URL` to a LAN or trusted tunnel URL
instead of `http://localhost:3010`.

## Scripts

```bash
yarn build
yarn test
yarn start
```

`yarn dev` builds TypeScript and starts the local server.

## License

MIT
