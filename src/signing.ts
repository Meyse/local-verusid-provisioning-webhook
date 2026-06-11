import { ECPair, networks } from "@bitgo/utxo-lib";
import { CompactIAddressObject } from "verus-typescript-primitives";
import { VerusIdInterface } from "verusid-ts-client";
import { AppConfig, requireSigningConfig } from "./config";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { ConfigError } from "./errors";
import {
  getCurrentHeight,
  requireIdentity,
  IdentityResult,
  listLocalIdentities,
  LocalIdentity,
} from "./verus";
import { withTrailingAt } from "./names";

export type SigningContext = {
  signingIdInput: string;
  signingIdentityAddress: string;
  signingFqn: string;
  signingWif?: string;
  signingPrimaryAddress?: string;
  identityResult: IdentityResult;
  currentHeight?: number;
};

export type SignerIdentity = LocalIdentity;

function primaryAddressFromWif(wif: string): string {
  const addressFromWif = ECPair.fromWIF(wif, networks.verus).getAddress();
  if (typeof addressFromWif !== "string" || addressFromWif.length === 0) {
    throw new ConfigError("VERUS_SIGNING_WIF did not resolve to a primary address.");
  }
  return addressFromWif;
}

function signableIdentity(
  identity: Pick<LocalIdentity, "minimumSignatures" | "primaryAddresses">,
  signingPrimaryAddress?: string,
): boolean {
  if (identity.minimumSignatures !== 1) return false;
  return signingPrimaryAddress
    ? identity.primaryAddresses.includes(signingPrimaryAddress)
    : true;
}

function signerIdentityFromResult(
  identityResult: IdentityResult,
  fallbackId: string,
): SignerIdentity {
  const identity = identityResult.identity;
  const identityAddress = identity?.identityaddress;
  if (!identityAddress) {
    throw new ConfigError("The signing VerusID did not resolve to an i-address.");
  }

  const fullyQualifiedName = withTrailingAt(
    identityResult.fullyqualifiedname || identity?.name || fallbackId,
  );

  return {
    name: identity?.name || fullyQualifiedName,
    iAddress: identityAddress,
    fullyQualifiedName,
    status: identityResult.status,
    parent: identity?.parent,
    systemId: identity?.systemid,
    primaryAddresses: identity?.primaryaddresses ?? [],
    minimumSignatures: identity?.minimumsignatures,
  };
}

function uniqueSigners(signers: SignerIdentity[]): SignerIdentity[] {
  const seen = new Set<string>();
  return signers.filter((signer) => {
    if (seen.has(signer.iAddress)) return false;
    seen.add(signer.iAddress);
    return true;
  });
}

export async function listSignerIdentities(
  verusId: VerusIdInterface,
  config: AppConfig,
): Promise<SignerIdentity[]> {
  const signingPrimaryAddress = config.verusSigningWif
    ? primaryAddressFromWif(config.verusSigningWif)
    : undefined;
  const localSigners = (await listLocalIdentities(verusId)).filter((identity) =>
    signableIdentity(identity, signingPrimaryAddress),
  );

  if (!config.provisioningSigningId) return localSigners;

  const configuredIdentity = signerIdentityFromResult(
    await requireIdentity(verusId, config.provisioningSigningId),
    config.provisioningSigningId,
  );
  if (!signableIdentity(configuredIdentity, signingPrimaryAddress)) {
    throw new ConfigError(
      "Configured PROVISIONING_SIGNING_ID is not a single-signature VerusID controlled by this service.",
    );
  }
  if (
    !signingPrimaryAddress &&
    !localSigners.some((signer) => signer.iAddress === configuredIdentity.iAddress)
  ) {
    throw new ConfigError(
      "Configured PROVISIONING_SIGNING_ID is not an active single-signature identity in the local wallet.",
    );
  }

  return uniqueSigners([configuredIdentity, ...localSigners]);
}

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
    const addressFromWif = primaryAddressFromWif(signingConfig.verusSigningWif);
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
