import {
  AuthenticationResponseOrdinalVDXFObject,
  GenericResponse,
} from "verus-typescript-primitives";

export type GenericResponseReceipt = {
  requestId?: string;
  signerIdentityId?: string;
  signerSystemId?: string;
  createdAt?: number;
  handledBy?: number;
  rawResponseHex: string;
  responseJson: unknown;
};

function maybeToIAddress(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value.toIAddress === "function") return value.toIAddress();
  if (typeof value.toAddress === "function") return value.toAddress();
  return undefined;
}

export function parseGenericResponsePayload(payload: Buffer): {
  response: GenericResponse;
  receipt: GenericResponseReceipt;
} {
  const response = new GenericResponse();
  response.fromBuffer(payload, 0);

  const authDetail = response.details.find(
    (detail) => detail instanceof AuthenticationResponseOrdinalVDXFObject,
  ) as AuthenticationResponseOrdinalVDXFObject | undefined;

  return {
    response,
    receipt: {
      requestId: maybeToIAddress(authDetail?.data?.requestID),
      signerIdentityId: maybeToIAddress(response.signature?.identityID),
      signerSystemId: maybeToIAddress(response.signature?.systemID),
      createdAt: response.createdAt
        ? Number.parseInt(response.createdAt.toString(), 10)
        : undefined,
      handledBy: response.handledBy,
      rawResponseHex: payload.toString("hex"),
      responseJson: response.toJson(),
    },
  };
}
