import { ECPair, networks } from "@bitgo/utxo-lib";
import { CompactIAddressObject } from "verus-typescript-primitives";
import { VerusIdInterface } from "verusid-ts-client";
import { AppConfig, requireSigningConfig } from "./config";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { ConfigError } from "./errors";
import { getCurrentHeight, requireIdentity, IdentityResult } from "./verus";

export type SigningContext = {
  signingIdInput: string;
  signingIdentityAddress: string;
  signingFqn: string;
  signingWif?: string;
  signingPrimaryAddress?: string;
  identityResult: IdentityResult;
  currentHeight?: number;
};

export async function loadSigningContext(
  verusId: VerusIdInterface,
  config: AppConfig,
  signingIdOverride?: string,
): Promise<SigningContext> {
  const signingConfig = requireSigningConfig(config, signingIdOverride);
  const identityResult = await requireIdentity(
    verusId,
    signingConfig.provisioningSigningId,
  );

  let signingPrimaryAddress: string | undefined;

  if (signingConfig.verusSigningWif) {
    const addressFromWif = ECPair.fromWIF(
      signingConfig.verusSigningWif,
      networks.verus,
    ).getAddress();
    if (typeof addressFromWif !== "string" || addressFromWif.length === 0) {
      throw new ConfigError("VERUS_SIGNING_WIF did not resolve to a primary address.");
    }
    signingPrimaryAddress = addressFromWif;

    const primaryAddresses = identityResult.identity?.primaryaddresses ?? [];
    if (!primaryAddresses.includes(addressFromWif)) {
      throw new ConfigError(
        "VERUS_SIGNING_WIF does not control a primary address of the signing VerusID.",
      );
    }
  }

  if (identityResult.identity?.minimumsignatures !== 1) {
    throw new ConfigError("The signing VerusID must be a single-signature identity.");
  }

  const signingIdentityAddress = identityResult.identity?.identityaddress;
  if (!signingIdentityAddress) {
    throw new ConfigError("The signing VerusID did not resolve to an i-address.");
  }

  return {
    signingIdInput: signingConfig.provisioningSigningId,
    signingIdentityAddress,
    signingFqn: identityResult.fullyqualifiedname || signingConfig.provisioningSigningId,
    signingWif: signingConfig.verusSigningWif,
    signingPrimaryAddress,
    identityResult,
    currentHeight: signingConfig.verusSigningWif
      ? await getCurrentHeight(verusId)
      : undefined,
  };
}

export async function signDataHashWithRpc(
  verusId: VerusIdInterface,
  signingId: string,
  dataHash: Buffer,
): Promise<string> {
  const sigRes = await verusId.interface.signData({
    address: signingId,
    datahash: dataHash.toString("hex"),
  });

  const signature = sigRes?.result?.signature;
  if (typeof signature === "string" && signature.length > 0) {
    return signature;
  }

  const rpcError = sigRes?.error;
  if (rpcError) {
    throw new ConfigError(
      `RPC signData failed for "${signingId}": ${rpcError.message || JSON.stringify(rpcError)}`,
    );
  }

  throw new ConfigError(
    `RPC signData returned no signature for "${signingId}". Make sure local verusd controls this identity.`,
  );
}

export async function signGenericRequestWithContext(
  verusId: VerusIdInterface,
  request: any,
  context: SigningContext,
): Promise<void> {
  if (!request.signature) {
    throw new Error("GenericRequest is missing signature metadata.");
  }

  request.signature.systemID = CompactIAddressObject.fromAddress(VRSCTEST_SYSTEM_ID);
  request.signature.identityID = CompactIAddressObject.fromAddress(
    context.signingIdentityAddress,
  );
  request.setSigned();

  if (context.signingWif) {
    await verusId.signGenericRequest(
      request,
      context.signingWif,
      context.identityResult as any,
      context.currentHeight,
    );
    return;
  }

  const signature = await signDataHashWithRpc(
    verusId,
    context.signingIdentityAddress,
    request.getRawDataSha256(false),
  );
  request.signature.signatureAsVch = Buffer.from(signature, "base64");
}
