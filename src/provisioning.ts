import { primitives, VerusIdInterface } from "verusid-ts-client";
import { toIAddress } from "verus-typescript-primitives";
import { advanceProvisioningAutomation } from "./automation";
import { AppConfig } from "./config";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { ValidationError } from "./errors";
import { buildChildFqn, normalizeRequestedChildName, withTrailingAt } from "./names";
import { SigningContext, loadSigningContext, signDataHashWithRpc } from "./signing";
import { ProvisioningRecord, RequestStore } from "./store";
import { getIdentity, IdentityResult } from "./verus";

export type ChainStatus = {
  state: "pending" | "complete";
  identityAddress?: string;
  primaryAddresses?: string[];
  message?: string;
};

export function validateProvisioningRequestForRecord(
  request: any,
  record: ProvisioningRecord,
): void {
  const challenge = request.challenge;
  if (!challenge) throw new ValidationError("Provisioning request is missing challenge.");
  if (challenge.challenge_id !== record.challengeId) {
    throw new ValidationError("Provisioning challenge ID does not match generated request.");
  }
  if (challenge.system_id !== VRSCTEST_SYSTEM_ID) {
    throw new ValidationError("Provisioning request system_id does not match VRSCTEST.");
  }
  if (challenge.parent !== record.parentId) {
    throw new ValidationError("Provisioning request parent does not match generated request.");
  }
  if (!challenge.name || typeof challenge.name !== "string") {
    throw new ValidationError("Provisioning request name is required.");
  }
  if (!request.signing_address || typeof request.signing_address !== "string") {
    throw new ValidationError("Provisioning request signing_address is required.");
  }
}

export async function verifyWalletProvisioningRequest(request: any): Promise<boolean> {
  if (!request.signature?.signature) return false;
  return Boolean(
    await VerusIdInterface.verifyVerusIdProvisioningRequest(
      request,
      request.signing_address,
    ),
  );
}

export async function getProvisionedIdentityStatus(
  verusId: VerusIdInterface,
  record: ProvisioningRecord,
): Promise<ChainStatus> {
  if (!record.requestedFqn || !record.walletSigningAddress) {
    return {
      state: "pending",
      message: "Wallet submission has not been received yet.",
    };
  }

  const identity =
    (await getIdentity(verusId, record.requestedFqn)) ||
    (await getIdentity(verusId, toIAddress(record.requestedFqn)));

  if (!identity?.identity) {
    return {
      state: "pending",
      message: "Identity is not visible on VRSCTEST yet.",
    };
  }

  const primaryAddresses = identity.identity.primaryaddresses ?? [];
  const ownsIdentity = primaryAddresses.includes(record.walletSigningAddress);

  return {
    state: ownsIdentity ? "complete" : "pending",
    identityAddress: identity.identity.identityaddress,
    primaryAddresses,
    message: ownsIdentity
      ? "Identity exists and primary address matches wallet."
      : "Identity exists but primary address does not match wallet.",
  };
}

function makeResult(params: {
  state: string;
  record: ProvisioningRecord;
  infoUri: string;
}): any {
  const provisioningTxids = [];
  if (params.record.automation?.commitmentTxid) {
    provisioningTxids.push(
      new primitives.ProvisioningTxid(
        params.record.automation.commitmentTxid,
        primitives.IDENTITY_NAME_COMMITMENT_TXID.vdxfid,
      ),
    );
  }
  if (params.record.automation?.registrationTxid) {
    provisioningTxids.push(
      new primitives.ProvisioningTxid(
        params.record.automation.registrationTxid,
        primitives.IDENTITY_REGISTRATION_TXID.vdxfid,
      ),
    );
  }
  const failed = params.state ===
    primitives.LOGIN_CONSENT_PROVISIONING_RESULT_STATE_FAILED.vdxfid;

  return new primitives.LoginConsentProvisioningResult({
    state: params.state,
    error_key: failed ? provisioningErrorKey(params.record) : undefined,
    error_desc: failed ? params.record.automation?.lastError : undefined,
    identity_address: params.record.requestedIdentityAddress,
    system_id: VRSCTEST_SYSTEM_ID,
    fully_qualified_name: params.record.requestedFqn,
    info_uri: params.infoUri,
    provisioning_txids: provisioningTxids.length > 0 ? provisioningTxids : undefined,
  });
}

async function resolveCanonicalParentFqn(
  verusId: VerusIdInterface,
  record: ProvisioningRecord,
): Promise<string> {
  const parent = await getIdentity(verusId, record.parentId);
  return parent?.fullyqualifiedname
    ? withTrailingAt(parent.fullyqualifiedname)
    : record.parentFqn;
}

function provisioningErrorKey(record: ProvisioningRecord): string {
  if (!record.automation?.commitmentTxid) {
    return primitives.LOGIN_CONSENT_PROVISIONING_ERROR_KEY_COMMIT_FAILED.vdxfid;
  }
  if (!record.automation?.registrationTxid) {
    return primitives.LOGIN_CONSENT_PROVISIONING_ERROR_KEY_CREATION_FAILED.vdxfid;
  }
  return primitives.LOGIN_CONSENT_PROVISIONING_ERROR_KEY_UNKNOWN.vdxfid;
}

export async function signProvisioningResponse(params: {
  verusId: VerusIdInterface;
  config: AppConfig;
  record: ProvisioningRecord;
  requestBody: unknown;
  state: "pending" | "complete" | "failed";
  signingContext?: SigningContext;
}): Promise<Record<string, unknown>> {
  if (!params.record.requestedFqn) {
    throw new ValidationError("Cannot sign response before requested FQN is known.");
  }

  const context =
    params.signingContext ||
    (await loadSigningContext(
      params.verusId,
      params.config,
      params.record.signingId,
    ));
  const request = new primitives.LoginConsentProvisioningRequest(
    params.requestBody as any,
  );
  const responseState =
    params.state === "complete"
      ? primitives.LOGIN_CONSENT_PROVISIONING_RESULT_STATE_COMPLETE.vdxfid
      : params.state === "failed"
        ? primitives.LOGIN_CONSENT_PROVISIONING_RESULT_STATE_FAILED.vdxfid
      : primitives.LOGIN_CONSENT_PROVISIONING_RESULT_STATE_PENDINGAPPROVAL.vdxfid;

  const decision = new primitives.LoginConsentProvisioningDecision({
    decision_id: params.record.challengeId,
    created_at: Math.floor(Date.now() / 1000),
    request,
    result: makeResult({
      state: responseState,
      record: params.record,
      infoUri: `${params.record.webhookBaseUrl}/provision/status/${params.record.challengeId}`,
    }),
  });

  const response = new primitives.LoginConsentProvisioningResponse({
    system_id: VRSCTEST_SYSTEM_ID,
    signing_id: context.signingIdentityAddress,
    decision,
  });

  if (context.signingWif) {
    await params.verusId.signVerusIdProvisioningResponse(
      response,
      context.signingWif,
      context.identityResult as any,
      context.currentHeight,
    );
  } else {
    const signature = await signDataHashWithRpc(
      params.verusId,
      context.signingIdentityAddress,
      response.decision.toSha256(),
    );
    response.signature = new primitives.VerusIDSignature(
      { signature },
      primitives.LOGIN_CONSENT_RESPONSE_SIG_VDXF_KEY,
    );
  }

  return JSON.parse(JSON.stringify(response.toJson()));
}

export async function acceptProvisioningSubmission(params: {
  verusId: VerusIdInterface;
  config: AppConfig;
  store: RequestStore;
  record: ProvisioningRecord;
  body: unknown;
}): Promise<{ record: ProvisioningRecord; response: Record<string, unknown> }> {
  const request = new primitives.LoginConsentProvisioningRequest(params.body as any);
  validateProvisioningRequestForRecord(request, params.record);

  const verified = await verifyWalletProvisioningRequest(request);
  if (!verified) throw new ValidationError("Wallet provisioning request signature is invalid.");

  const requestedName = normalizeRequestedChildName(request.challenge.name as string);
  const parentFqn = await resolveCanonicalParentFqn(params.verusId, params.record);
  const requestedFqn = buildChildFqn(requestedName, parentFqn);
  const updatedRecord: ProvisioningRecord = {
    ...params.record,
    parentFqn,
    status: "submitted",
    updatedAt: Math.floor(Date.now() / 1000),
    walletSigningAddress: request.signing_address,
    requestedName,
    requestedFqn,
    rawProvisioningRequest: params.body,
    lastResponseState:
      primitives.LOGIN_CONSENT_PROVISIONING_RESULT_STATE_PENDINGAPPROVAL.vdxfid,
  };

  await params.store.upsert(updatedRecord);
  const automatedRecord = await advanceProvisioningAutomation({
    verusId: params.verusId,
    config: params.config,
    store: params.store,
    record: updatedRecord,
  });

  const response = await signProvisioningResponse({
    verusId: params.verusId,
    config: params.config,
    record: automatedRecord,
    requestBody: params.body,
    state:
      automatedRecord.status === "ready"
        ? "complete"
        : automatedRecord.status === "failed"
          ? "failed"
          : "pending",
  });

  return {
    record: automatedRecord,
    response,
  };
}

export function identityResultPrimaryAddresses(identity: IdentityResult | null): string[] {
  return identity?.identity?.primaryaddresses ?? [];
}
