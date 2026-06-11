import { BN } from "bn.js";
import {
  AuthenticationResponseDetails,
  AuthenticationResponseOrdinalVDXFObject,
  CompactIAddressObject,
  GenericResponse,
  VerifiableSignatureData,
} from "verus-typescript-primitives";
import { parseGenericResponsePayload } from "../src/genericResponse";
import { VRSCTEST_SYSTEM_ID } from "../src/constants";

const TEST_REQUEST_ID = "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j";
const TEST_SIGNER_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq";

describe("parseGenericResponsePayload", () => {
  it("extracts the auth request ID and signer metadata", () => {
    const response = new GenericResponse({
      createdAt: new BN(1700000010, 10),
      handledBy: 1,
      details: [
        new AuthenticationResponseOrdinalVDXFObject({
          data: new AuthenticationResponseDetails({
            requestID: CompactIAddressObject.fromAddress(TEST_REQUEST_ID),
          }),
        }),
      ],
      signature: new VerifiableSignatureData({
        systemID: CompactIAddressObject.fromAddress(VRSCTEST_SYSTEM_ID),
        identityID: CompactIAddressObject.fromAddress(TEST_SIGNER_ID),
      }),
    });

    const payload = response.toBuffer();
    const { receipt } = parseGenericResponsePayload(payload);

    expect(receipt.requestId).toBe(TEST_REQUEST_ID);
    expect(receipt.signerIdentityId).toBe(TEST_SIGNER_ID);
    expect(receipt.signerSystemId).toBe(VRSCTEST_SYSTEM_ID);
    expect(receipt.createdAt).toBe(1700000010);
    expect(receipt.handledBy).toBe(1);
    expect(receipt.rawResponseHex).toBe(payload.toString("hex"));
  });
});
