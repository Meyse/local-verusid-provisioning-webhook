import { parseVerusConfContent, requireSigningConfig } from "../src/config";

describe("parseVerusConfContent", () => {
  it("loads RPC fields from vrsctest.conf content", () => {
    expect(
      parseVerusConfContent(`
        # comment
        rpchost=127.0.0.1
        rpcport=18843
        rpcuser=user-value
        rpcpassword=password-value
        ignored=value
      `),
    ).toEqual({
      rpchost: "127.0.0.1",
      rpcport: "18843",
      rpcuser: "user-value",
      rpcpassword: "password-value",
    });
  });
});

describe("requireSigningConfig", () => {
  it("uses a per-request signing ID when PROVISIONING_SIGNING_ID is omitted", () => {
    expect(
      requireSigningConfig(
        {
          uiPort: 3010,
          webhookBaseUrl: "http://localhost:3010",
          rpcHost: "127.0.0.1",
          rpcPort: 18843,
          provisioningSigningId: undefined,
        },
        "iParentSigner",
      ),
    ).toEqual({
      provisioningSigningId: "iParentSigner",
      verusSigningWif: undefined,
    });
  });
});
