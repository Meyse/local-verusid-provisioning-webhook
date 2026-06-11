import { randomBytes } from "crypto";
import { BN } from "bn.js";
import {
  AuthenticationRequestDetails,
  AuthenticationRequestOrdinalVDXFObject,
  CompactIAddressObject,
  ProvisionIdentityDetails,
  ProvisionIdentityDetailsOrdinalVDXFObject,
  RequestURI,
  ResponseURI,
  VerifiableSignatureData,
  toIAddress,
} from "verus-typescript-primitives";
import { primitives } from "verusid-ts-client";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { normalizeWebhookBaseUrl } from "./names";

export type BuildProvisioningRequestParams = {
  parentId: string;
  signingIdentityId: string;
  requestId?: string;
  webhookBaseUrl: string;
  responseUri?: string;
  createdAt?: number;
};

export type BuiltProvisioningRequest = {
  request: primitives.GenericRequest;
  requestId: string;
  webhookBaseUrl: string;
  webhookUrl: string;
  responseUri?: string;
};

export function generateRequestId(): string {
  const random = randomBytes(16).toString("hex");
  return toIAddress(`verus-mobile-provisioning.${Date.now()}.${random}`);
}

export function buildProvisioningGenericRequest(
  params: BuildProvisioningRequestParams,
): BuiltProvisioningRequest {
  const requestId = params.requestId || generateRequestId();
  const webhookBaseUrl = normalizeWebhookBaseUrl(params.webhookBaseUrl);
  const webhookUrl = `${webhookBaseUrl}/provision`;
  const requestID = CompactIAddressObject.fromAddress(requestId);

  const authDetails = new AuthenticationRequestDetails({
    requestID,
  });

  const provisionDetails = new ProvisionIdentityDetails({
    uri: RequestURI.fromUriString(webhookUrl),
    systemID: CompactIAddressObject.fromAddress(VRSCTEST_SYSTEM_ID),
    parentID: CompactIAddressObject.fromAddress(params.parentId),
  });

  const request = new primitives.GenericRequest({
    requestID,
    createdAt: new BN(params.createdAt ?? Math.floor(Date.now() / 1000), 10),
    details: [
      new AuthenticationRequestOrdinalVDXFObject({ data: authDetails }),
      new ProvisionIdentityDetailsOrdinalVDXFObject({ data: provisionDetails }),
    ],
    signature: new VerifiableSignatureData({
      systemID: CompactIAddressObject.fromAddress(VRSCTEST_SYSTEM_ID),
      identityID: CompactIAddressObject.fromAddress(params.signingIdentityId),
    }),
    responseURIs: params.responseUri
      ? [ResponseURI.fromUriString(params.responseUri, ResponseURI.TYPE_POST)]
      : undefined,
    flags: primitives.GenericRequest.FLAG_IS_TESTNET,
  });

  request.setIsTestnet();
  request.setSigned();
  request.setFlags();

  return {
    request,
    requestId,
    webhookBaseUrl,
    webhookUrl,
    responseUri: params.responseUri,
  };
}
