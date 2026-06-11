import { buildProvisioningGenericRequest } from "../src/requestBuilder";
import {
  listSignerIdentities,
  signGenericRequestWithContext,
  SigningContext,
} from "../src/signing";
import { VRSCTEST_SYSTEM_ID } from "../src/constants";

const TEST_REQUEST_ID = "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j";
const TEST_PARENT_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq";
const TEST_SIGNATURE = Buffer.from("rpc-signature").toString("base64");

describe("signGenericRequestWithContext", () => {
  it("uses local verusd signdata when no signing WIF is configured", async () => {
    const built = buildProvisioningGenericRequest({
      parentId: TEST_PARENT_ID,
      signingIdentityId: TEST_PARENT_ID,
      requestId: TEST_REQUEST_ID,
      webhookBaseUrl: "http://localhost:3010",
      createdAt: 1700000000,
    });
    const signData = jest.fn(async () => ({
      result: { signature: TEST_SIGNATURE },
    }));
    const context: SigningContext = {
      signingIdInput: TEST_PARENT_ID,
      signingIdentityAddress: TEST_PARENT_ID,
      signingFqn: "sampleparent@",
      identityResult: {
        status: "active",
        fullyqualifiedname: "sampleparent@",
        identity: {
          identityaddress: TEST_PARENT_ID,
          minimumsignatures: 1,
          primaryaddresses: [],
        },
      },
    };

    await signGenericRequestWithContext(
      { interface: { signData } } as any,
      built.request,
      context,
    );

    expect(signData).toHaveBeenCalledWith({
      address: TEST_PARENT_ID,
      datahash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(built.request.signature?.systemID.toAddress()).toBe(VRSCTEST_SYSTEM_ID);
    expect(built.request.signature?.identityID.toAddress()).toBe(TEST_PARENT_ID);
    expect(built.request.signature?.signatureAsVch.toString("base64")).toBe(
      TEST_SIGNATURE,
    );
  });
});

describe("listSignerIdentities", () => {
  it("only lists active single-signature local identities", async () => {
    const request = jest.fn(async () => ({
      result: [
        {
          status: "active",
          fullyqualifiedname: "signer.VRSCTEST@",
          identity: {
            name: "signer",
            identityaddress: "iSigner",
            primaryaddresses: ["RSigner"],
            minimumsignatures: 1,
          },
        },
        {
          status: "active",
          fullyqualifiedname: "multi.VRSCTEST@",
          identity: {
            name: "multi",
            identityaddress: "iMulti",
            primaryaddresses: ["RMulti"],
            minimumsignatures: 2,
          },
        },
        {
          status: "revoked",
          fullyqualifiedname: "revoked.VRSCTEST@",
          identity: {
            name: "revoked",
            identityaddress: "iRevoked",
            primaryaddresses: ["RRevoked"],
            minimumsignatures: 1,
          },
        },
      ],
    }));

    await expect(
      listSignerIdentities(
        { interface: { request } } as any,
        {
          uiPort: 3010,
          webhookBaseUrl: "http://localhost:3010",
          rpcHost: "127.0.0.1",
          rpcPort: 18843,
        },
      ),
    ).resolves.toMatchObject([
      {
        iAddress: "iSigner",
        fullyQualifiedName: "signer.VRSCTEST@",
      },
    ]);
  });
});
