import {
  AuthenticationRequestOrdinalVDXFObject,
  ProvisionIdentityDetailsOrdinalVDXFObject,
  ResponseURI,
} from "verus-typescript-primitives";
import { primitives } from "verusid-ts-client";
import { buildProvisioningGenericRequest } from "../src/requestBuilder";
import { VRSCTEST_SYSTEM_ID } from "../src/constants";

const TEST_REQUEST_ID = "iPsFBfFoCcxtuZNzE8yxPQhXVn4dmytf8j";
const TEST_PARENT_ID = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq";

describe("buildProvisioningGenericRequest", () => {
  it("builds auth + provisioning details in mobile-compatible order", () => {
    const built = buildProvisioningGenericRequest({
      parentId: TEST_PARENT_ID,
      signingIdentityId: VRSCTEST_SYSTEM_ID,
      requestId: TEST_REQUEST_ID,
      webhookBaseUrl: "http://localhost:3010/",
      createdAt: 1700000000,
    });

    expect(built.request.requestID?.toAddress()).toBe(TEST_REQUEST_ID);
    expect(built.request.isTestnet()).toBe(true);
    expect(built.request.details).toHaveLength(2);
    expect(built.request.details[0]).toBeInstanceOf(
      AuthenticationRequestOrdinalVDXFObject,
    );
    expect(built.request.details[1]).toBeInstanceOf(
      ProvisionIdentityDetailsOrdinalVDXFObject,
    );

    const authDetail = built.request.details[0] as AuthenticationRequestOrdinalVDXFObject;
    const provisionDetail = built.request.details[1] as ProvisionIdentityDetailsOrdinalVDXFObject;

    expect(authDetail.data.requestID?.toAddress()).toBe(TEST_REQUEST_ID);
    expect(provisionDetail.data.systemID?.toAddress()).toBe(VRSCTEST_SYSTEM_ID);
    expect(provisionDetail.data.parentID?.toAddress()).toBe(TEST_PARENT_ID);
    expect(provisionDetail.data.identityID).toBeUndefined();
    expect(provisionDetail.data.uri?.getUriString()).toBe("http://localhost:3010/provision");
  });

  it("includes an optional POST response URI in the signed QR payload", () => {
    const built = buildProvisioningGenericRequest({
      parentId: TEST_PARENT_ID,
      signingIdentityId: VRSCTEST_SYSTEM_ID,
      requestId: TEST_REQUEST_ID,
      webhookBaseUrl: "http://localhost:3010/",
      responseUri: "http://localhost:3010/generic-response",
      createdAt: 1700000000,
    });

    expect(built.responseUri).toBe("http://localhost:3010/generic-response");
    expect(built.request.hasResponseURIs()).toBe(true);
    expect(built.request.responseURIs).toHaveLength(1);
    expect(built.request.responseURIs?.[0].getUriString()).toBe(
      "http://localhost:3010/generic-response",
    );
    expect(built.request.responseURIs?.[0].type.toString()).toBe(
      ResponseURI.TYPE_POST.toString(),
    );

    const roundTrip = primitives.GenericRequest.fromWalletDeeplinkUri(
      built.request.toWalletDeeplinkUri(),
    );
    expect(roundTrip.responseURIs?.[0].getUriString()).toBe(
      "http://localhost:3010/generic-response",
    );
    expect(roundTrip.responseURIs?.[0].type.toString()).toBe(
      ResponseURI.TYPE_POST.toString(),
    );
  });
});
