import { primitives, VerusIdInterface } from "verusid-ts-client";
import { buildDryRunCommands } from "../src/dryRun";
import { buildChildFqn } from "../src/names";
import {
  acceptProvisioningSubmission,
  getProvisionedIdentityStatus,
  signProvisioningResponse,
  validateProvisioningRequestForRecord,
  verifyWalletProvisioningRequest,
} from "../src/provisioning";
import { ProvisioningRecord } from "../src/store";
import { VRSCTEST_SYSTEM_ID } from "../src/constants";

const FIXTURE_WALLET_ADDRESS = "RNTuomVo7HNrUZH7v9R5LvPkaQPVjtpCn7";
const FIXTURE_SUBID_ADDRESS = "iBaQ8KtypGWpFQNNZBizT4e6f69KaCrriB";

const baseRecord: ProvisioningRecord = {
  challengeId: "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j",
  parentId: "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq",
  parentFqn: "sampleparent.VRSCTEST@",
  parentName: "sampleparent",
  systemId: VRSCTEST_SYSTEM_ID,
  webhookBaseUrl: "http://localhost:3010",
  webhookUrl: "http://localhost:3010/provision",
  deeplink: "verus://1/example",
  qrGeneratedAt: 1700000000,
  updatedAt: 1700000000,
  status: "qr_generated",
};

describe("provisioning helpers", () => {
  it("computes child FQN from a chosen name and parent FQN", () => {
    expect(buildChildFqn("samplechild", "sampleparent@")).toBe(
      "samplechild.sampleparent@",
    );
    expect(buildChildFqn("samplechild", "sampleparent.VRSCTEST@")).toBe(
      "samplechild.sampleparent.VRSCTEST@",
    );
    expect(buildChildFqn("samplechild.extra", "sampleparent@")).toBe(
      "samplechild.sampleparent@",
    );
  });

  it("validates challenge metadata against the generated QR record", () => {
    expect(() =>
      validateProvisioningRequestForRecord(
        {
          signing_address: "RWalletAddress",
          challenge: {
            challenge_id: baseRecord.challengeId,
            system_id: VRSCTEST_SYSTEM_ID,
            parent: baseRecord.parentId,
            name: "samplechild",
          },
        },
        baseRecord,
      ),
    ).not.toThrow();

    expect(() =>
      validateProvisioningRequestForRecord(
        {
          signing_address: "RWalletAddress",
          challenge: {
            challenge_id: baseRecord.challengeId,
            system_id: VRSCTEST_SYSTEM_ID,
            parent: "iWrongParent11111111111111111111111111",
            name: "samplechild",
          },
        },
        baseRecord,
      ),
    ).toThrow("parent");
  });

  it("rejects unsigned wallet provisioning submissions", async () => {
    await expect(
      verifyWalletProvisioningRequest({
        signing_address: "RWalletAddress",
        challenge: {},
      }),
    ).resolves.toBe(false);
  });

  it("generates documented SubID dry-run commands", () => {
    const record: ProvisioningRecord = {
      ...baseRecord,
      requestedName: "samplechild",
      requestedFqn: "samplechild.sampleparent.VRSCTEST@",
      walletSigningAddress: FIXTURE_WALLET_ADDRESS,
    };

    const commands = buildDryRunCommands(record, {
      uiPort: 3010,
      webhookBaseUrl: "http://localhost:3010",
      rpcHost: "127.0.0.1",
      rpcPort: 18843,
      commitmentControlAddress: "RLocalCommitmentAddress",
    });

    expect(commands.commitmentCommand).toContain(
      'registernamecommitment "samplechild" "RLocalCommitmentAddress" "" "sampleparent.VRSCTEST"',
    );
    expect(commands.registrationCommand).toContain('"parent": "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"');
    expect(commands.registrationCommand).toContain('"primaryaddresses": [');
    expect(commands.registrationCommand).toContain(FIXTURE_WALLET_ADDRESS);
  });

  it("marks chain status complete only when the wallet address controls the ID", async () => {
    const record: ProvisioningRecord = {
      ...baseRecord,
      requestedFqn: "samplechild.sampleparent.VRSCTEST@",
      walletSigningAddress: FIXTURE_WALLET_ADDRESS,
    };
    const mockVerusId = {
      interface: {
        getIdentity: async () => ({
          result: {
            fullyqualifiedname: "samplechild.sampleparent.VRSCTEST@",
            identity: {
              identityaddress: FIXTURE_SUBID_ADDRESS,
              primaryaddresses: [FIXTURE_WALLET_ADDRESS],
            },
          },
        }),
      },
    };

    await expect(getProvisionedIdentityStatus(mockVerusId as any, record)).resolves.toMatchObject({
      state: "complete",
      identityAddress: FIXTURE_SUBID_ADDRESS,
    });
  });

  it("serializes signed provisioning responses with automation txids", async () => {
    const record: ProvisioningRecord = {
      ...baseRecord,
      requestedName: "reviewchild",
      requestedFqn: "reviewchild.sampleparent.VRSCTEST@",
      requestedIdentityAddress: FIXTURE_SUBID_ADDRESS,
      walletSigningAddress: FIXTURE_WALLET_ADDRESS,
      rawProvisioningRequest: {
        signing_address: FIXTURE_WALLET_ADDRESS,
        signature: { signature: "fixture-signature" },
        challenge: {
          challenge_id: baseRecord.challengeId,
          created_at: 1700000001,
          system_id: VRSCTEST_SYSTEM_ID,
          parent: baseRecord.parentId,
          name: "reviewchild",
        },
      },
      automation: {
        state: "commit_submitted",
        commitmentTxid:
          "fcc1884721b0007b3e05b6812690274917c36bff5fb6bdb64e13bb23a7adda7c",
      },
    };
    const signedHashes: string[] = [];
    const response = await signProvisioningResponse({
      verusId: {
        interface: {
          signData: async ({ datahash }: { datahash: string }) => {
            signedHashes.push(datahash);
            return {
              result: { signature: Buffer.from("response-signature").toString("base64") },
            };
          },
        },
      } as any,
      config: {
        uiPort: 3010,
        webhookBaseUrl: "http://localhost:3010",
        rpcHost: "127.0.0.1",
        rpcPort: 18843,
      },
      record,
      requestBody: record.rawProvisioningRequest,
      state: "pending",
      signingContext: {
        signingIdInput: record.parentId,
        signingIdentityAddress: record.parentId,
        signingFqn: "sampleparent@",
        identityResult: {
          status: "active",
          identity: {
            identityaddress: record.parentId,
            primaryaddresses: [],
            minimumsignatures: 1,
          },
        },
      },
    });

    expect(JSON.stringify(response)).toContain(
      primitives.IDENTITY_NAME_COMMITMENT_TXID.vdxfid,
    );
    expect(JSON.stringify(response)).toContain(record.automation!.commitmentTxid);

    const wireResponse = new primitives.LoginConsentProvisioningResponse(
      response as any,
    );
    expect(signedHashes).toEqual([
      wireResponse.decision.toSha256().toString("hex"),
    ]);
    expect((response as any).decision.result.parent).toBeUndefined();
  });

  it("canonicalizes legacy shortened parent FQNs before responding", async () => {
    jest
      .spyOn(VerusIdInterface, "verifyVerusIdProvisioningRequest")
      .mockResolvedValueOnce(true as any);

    const store = {
      upsert: jest.fn(async (record: ProvisioningRecord) => record),
    };
    const record: ProvisioningRecord = {
      ...baseRecord,
      parentFqn: "sampleparent@",
      signingId: baseRecord.parentId,
    };
    const body = {
      signing_address: FIXTURE_WALLET_ADDRESS,
      signature: { signature: "fixture-signature" },
      challenge: {
        challenge_id: baseRecord.challengeId,
        created_at: 1700000001,
        system_id: VRSCTEST_SYSTEM_ID,
        parent: baseRecord.parentId,
        name: "samplechild",
      },
    };

    const result = await acceptProvisioningSubmission({
      verusId: {
        interface: {
          getIdentity: jest.fn(async (identity: string) => {
            if (identity === baseRecord.parentId) {
              return {
                result: {
                  fullyqualifiedname: "sampleparent.VRSCTEST@",
                  identity: {
                    identityaddress: baseRecord.parentId,
                    primaryaddresses: [],
                    minimumsignatures: 1,
                  },
                },
              };
            }
            return { error: { code: -5, message: "Identity not found" } };
          }),
          request: jest.fn(async ({ cmd }: any) => {
            if (cmd === "getvdxfid") {
              return { result: { vdxfid: FIXTURE_SUBID_ADDRESS } };
            }
            if (cmd === "registernamecommitment") {
              return {
                result: {
                  txid: "commit-txid",
                  namereservation: {
                    version: 1,
                    name: "samplechild",
                    salt: "salt",
                    referral: "",
                    parent: baseRecord.parentId,
                    nameid: FIXTURE_SUBID_ADDRESS,
                  },
                },
              };
            }
            throw new Error(`Unexpected RPC ${cmd}`);
          }),
          signData: jest.fn(async () => ({
            result: { signature: Buffer.from("response-signature").toString("base64") },
          })),
        },
      } as any,
      config: {
        uiPort: 3010,
        webhookBaseUrl: "http://localhost:3010",
        rpcHost: "127.0.0.1",
        rpcPort: 18843,
        commitmentControlAddress: "RLocalCommitmentAddress",
      },
      store: store as any,
      record,
      body,
    });

    expect(result.record.parentFqn).toBe("sampleparent.VRSCTEST@");
    expect(result.record.requestedFqn).toBe("samplechild.sampleparent.VRSCTEST@");
    expect((result.response as any).decision.result.fully_qualified_name).toBe(
      "samplechild.sampleparent.VRSCTEST@",
    );
  });
});
