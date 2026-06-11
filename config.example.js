module.exports = {
  // The dashboard binds to localhost by default. Use "0.0.0.0" only on a
  // trusted LAN or behind a trusted tunnel when testing with a physical phone.
  UI_HOST: "127.0.0.1",
  UI_PORT: 3010,
  WEBHOOK_BASE_URL: "http://localhost:3010",

  RPC_HOST: "127.0.0.1",
  RPC_PORT: 18843,
  // Optional: if omitted, the app reads these from:
  // ~/Library/Application Support/Komodo/vrsctest/vrsctest.conf
  RPC_USER: "your-rpc-user",
  RPC_PASSWORD: "your-rpc-password",
  VRSCTEST_CONF_PATH: "/Users/you/Library/Application Support/Komodo/vrsctest/vrsctest.conf",

  // Optional. If set, the dashboard preselects this signer VerusID. The signer
  // signs the QR and provisioning responses and may differ from the parent
  // currency namespace.
  PROVISIONING_SIGNING_ID: "",
  // Optional. If omitted, local verusd signs via RPC. Set this only if you want
  // offline WIF signing instead of RPC signing.
  VERUS_SIGNING_WIF: "",

  // Optional address controlled by your local provisioning wallet. Used for the
  // name commitment transaction, not as the final SubID owner. If omitted, the
  // selected parent currency namespace's first primary address is used.
  COMMITMENT_CONTROL_ADDRESS: ""
};
