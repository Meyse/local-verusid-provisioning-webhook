import { advanceProvisioningAutomation } from "../src/automation";
import { VRSCTEST_SYSTEM_ID } from "../src/constants";
import { ProvisioningRecord } from "../src/store";

const FIXTURE_WALLET_ADDRESS = "RNTuomVo7HNrUZH7v9R5LvPkaQPVjtpCn7";
const FIXTURE_SUBID_ADDRESS = "iBaQ8KtypGWpFQNNZBizT4e6f69KaCrriB";

const baseSubmittedRecord: ProvisioningRecord = {
  challengeId: "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j",
  parentId: "iParentId",
  parentFqn: "sampleparent.VRSCTEST@",
  parentName: "sampleparent",
  systemId: VRSCTEST_SYSTEM_ID,
  webhookBaseUrl: "http://localhost:3010",
  webhookUrl: "http://localhost:3010/provision",
  deeplink: "verus://1/example",
  qrGeneratedAt: 1700000000,
  updatedAt: 1700000000,
  status: "submitted",
  walletSigningAddress: FIXTURE_WALLET_ADDRESS,
  requestedName: "samplechild",
  requestedFqn: "samplechild.sampleparent.VRSCTEST@",
  rawProvisioningRequest: {
    signing_address: FIXTURE_WALLET_ADDRESS,
    challenge: {
      challenge_id: "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j",
      system_id: VRSCTEST_SYSTEM_ID,
      parent: "iParentId",
      name: "samplechild",
    },
  },
};

function makeStore() {
  return {
    upsert: jest.fn(async (record: ProvisioningRecord) => record),
    readAll: jest.fn(async () => []),
  };
}

function makeVerusId(request: jest.Mock) {
  return {
    interface: {
      request,
      getIdentity: jest.fn(async (identity: string) => {
        if (identity === "iParentId") {
          return {
            result: {
              status: "active",
              identity: {
                identityaddress: "iParentId",
                primaryaddresses: ["RLocalParentAddress"],
                minimumsignatures: 1,
              },
            },
          };
        }

        return { error: { code: -5, message: "Identity not found" } };
      }),
    },
  };
}

describe("advanceProvisioningAutomation", () => {
  it("submits a name commitment for a signed wallet request", async () => {
    const request = jest.fn(async ({ cmd }: any) => {
      if (cmd === "getvdxfid") return { result: { vdxfid: FIXTURE_SUBID_ADDRESS } };
      if (cmd === "registernamecommitment") {
        return {
          result: {
            txid: "commit-txid",
            namereservation: {
              version: 1,
              name: "samplechild",
              salt: "salt",
              referral: "",
              parent: "iParentId",
              nameid: FIXTURE_SUBID_ADDRESS,
            },
          },
        };
      }
      throw new Error(`Unexpected RPC ${cmd}`);
    });
    const store = makeStore();

    const result = await advanceProvisioningAutomation({
      verusId: makeVerusId(request) as any,
      config: {
        uiPort: 3010,
        webhookBaseUrl: "http://localhost:3010",
        rpcHost: "127.0.0.1",
        rpcPort: 18843,
      },
      store: store as any,
      record: baseSubmittedRecord,
    });

    expect(result).toMatchObject({
      status: "waiting_commit_confirmation",
      requestedIdentityAddress: FIXTURE_SUBID_ADDRESS,
      automation: {
        commitmentControlAddress: "RLocalParentAddress",
        commitmentTxid: "commit-txid",
        state: "commit_submitted",
      },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: "registernamecommitment",
      }),
    );
  });

  it("registers the SubID after the commitment has one confirmation", async () => {
    const request = jest.fn(async ({ cmd, getParams }: any) => {
      if (cmd === "gettransaction") return { result: { confirmations: 1 } };
      if (cmd === "registeridentity") {
        const [registration] = getParams();
        expect(registration).toMatchObject({
          txid: "commit-txid",
          namereservation: {
            parent: "iParentId",
            nameid: FIXTURE_SUBID_ADDRESS,
          },
          identity: {
            name: "samplechild",
            parent: "iParentId",
            primaryaddresses: [FIXTURE_WALLET_ADDRESS],
          },
        });
        return { result: "register-txid" };
      }
      throw new Error(`Unexpected RPC ${cmd}`);
    });
    const store = makeStore();

    const result = await advanceProvisioningAutomation({
      verusId: makeVerusId(request) as any,
      config: {
        uiPort: 3010,
        webhookBaseUrl: "http://localhost:3010",
        rpcHost: "127.0.0.1",
        rpcPort: 18843,
      },
      store: store as any,
      record: {
        ...baseSubmittedRecord,
        requestedIdentityAddress: FIXTURE_SUBID_ADDRESS,
        status: "waiting_commit_confirmation",
        automation: {
          state: "commit_submitted",
          commitmentTxid: "commit-txid",
          commitmentConfirmations: 0,
          namereservation: {
            version: 1,
            name: "samplechild",
            salt: "salt",
            referral: "",
            parent: "iParentId",
            nameid: FIXTURE_SUBID_ADDRESS,
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "waiting_identity",
      automation: {
        registrationTxid: "register-txid",
        state: "registration_submitted",
      },
    });
  });
});
