import { VerusIdInterface } from "verusid-ts-client";
import { AppConfig } from "./config";
import { ValidationError, getErrorMessage } from "./errors";
import { withoutTrailingAt } from "./names";
import { ProvisioningRecord, RequestStore } from "./store";
import { getIdentity, requireIdentity } from "./verus";

type RpcResult<T> = {
  result?: T;
  error?: {
    message?: string;
    code?: number;
  };
};

type CommitmentResult = {
  txid: string;
  namereservation: {
    version?: number;
    name: string;
    salt: string;
    referral?: string;
    parent?: string;
    nameid?: string;
  };
};

type VdxfIdResult = {
  vdxfid: string;
};

type TransactionResult = {
  confirmations?: number;
};

type RegistrationJson = {
  txid: string;
  namereservation: {
    version: number;
    name: string;
    salt: string;
    referral: string;
    parent: string;
    nameid: string;
  };
  identity: {
    name: string;
    parent: string;
    primaryaddresses: string[];
    minimumsignatures: number;
  };
};

function now(): number {
  return Math.floor(Date.now() / 1000);
}

async function rpc<T>(
  verusId: VerusIdInterface,
  cmd: string,
  params: unknown[],
): Promise<T> {
  const response = (await verusId.interface.request({
    cmd,
    getParams: () => params,
  } as any)) as unknown as RpcResult<T>;

  if (response.error) {
    throw new Error(response.error.message || `${cmd} failed.`);
  }

  return response.result as T;
}

function automationCandidate(record: ProvisioningRecord): boolean {
  return Boolean(
    record.rawProvisioningRequest &&
      record.requestedName &&
      record.requestedFqn &&
      record.walletSigningAddress &&
      record.status !== "ready" &&
      record.status !== "failed",
  );
}

function withAutomationAttempt(record: ProvisioningRecord): ProvisioningRecord {
  return {
    ...record,
    automation: {
      state: "not_started",
      ...record.automation,
      lastAttemptAt: now(),
      lastError: undefined,
    },
  };
}

async function failAutomation(
  store: RequestStore,
  record: ProvisioningRecord,
  error: unknown,
): Promise<ProvisioningRecord> {
  const failedRecord: ProvisioningRecord = {
    ...record,
    status: "failed",
    updatedAt: now(),
    lastResponseState: "FAILED",
    automation: {
      state: "failed",
      ...record.automation,
      lastAttemptAt: now(),
      lastError: getErrorMessage(error),
    },
  };

  await store.upsert(failedRecord);
  return failedRecord;
}

async function resolveRequestedIdentityAddress(
  verusId: VerusIdInterface,
  record: ProvisioningRecord,
): Promise<string> {
  if (record.requestedIdentityAddress) return record.requestedIdentityAddress;
  if (!record.requestedFqn) throw new ValidationError("Requested FQN is missing.");

  const result = await rpc<VdxfIdResult>(verusId, "getvdxfid", [
    record.requestedFqn,
  ]);
  if (!result?.vdxfid) {
    throw new Error(`getvdxfid returned no ID for ${record.requestedFqn}.`);
  }
  return result.vdxfid;
}

async function getExistingIdentityState(
  verusId: VerusIdInterface,
  record: ProvisioningRecord,
): Promise<"missing" | "owned" | "taken"> {
  const identity =
    (record.requestedFqn ? await getIdentity(verusId, record.requestedFqn) : null) ||
    (record.requestedIdentityAddress
      ? await getIdentity(verusId, record.requestedIdentityAddress)
      : null);

  if (!identity?.identity) return "missing";
  const primaryAddresses = identity.identity.primaryaddresses ?? [];
  return primaryAddresses.includes(record.walletSigningAddress || "")
    ? "owned"
    : "taken";
}

async function resolveCommitmentControlAddress(
  verusId: VerusIdInterface,
  config: AppConfig,
  record: ProvisioningRecord,
): Promise<string> {
  if (config.commitmentControlAddress) return config.commitmentControlAddress;

  const parent = await requireIdentity(verusId, record.parentId);
  const primaryAddress = parent.identity?.primaryaddresses?.[0];
  if (!primaryAddress) {
    throw new Error(
      "No COMMITMENT_CONTROL_ADDRESS configured and parent identity has no primary address.",
    );
  }

  return primaryAddress;
}

async function submitCommitment(
  verusId: VerusIdInterface,
  config: AppConfig,
  record: ProvisioningRecord,
): Promise<ProvisioningRecord> {
  if (!record.requestedName) throw new ValidationError("Requested name is missing.");

  const controlAddress = await resolveCommitmentControlAddress(
    verusId,
    config,
    record,
  );
  const commitment = await rpc<CommitmentResult>(
    verusId,
    "registernamecommitment",
    [record.requestedName, controlAddress, "", withoutTrailingAt(record.parentFqn)],
  );

  if (!commitment?.txid || !commitment.namereservation?.salt) {
    throw new Error("registernamecommitment returned an incomplete result.");
  }

  return {
    ...record,
    status: "waiting_commit_confirmation",
    updatedAt: now(),
    automation: {
      ...record.automation,
      state: "commit_submitted",
      commitmentControlAddress: controlAddress,
      commitmentTxid: commitment.txid,
      commitmentConfirmations: 0,
      commitmentSubmittedAt: now(),
      namereservation: commitment.namereservation,
      lastAttemptAt: now(),
      lastError: undefined,
    },
  };
}

async function getCommitmentConfirmations(
  verusId: VerusIdInterface,
  txid: string,
): Promise<number> {
  try {
    const tx = await rpc<TransactionResult>(verusId, "gettransaction", [txid]);
    return Math.max(0, tx.confirmations || 0);
  } catch (_error) {
    return 0;
  }
}

function buildRegistrationJson(record: ProvisioningRecord): RegistrationJson {
  const automation = record.automation;
  const namereservation = automation?.namereservation;

  if (!record.requestedName) throw new ValidationError("Requested name is missing.");
  if (!record.walletSigningAddress) {
    throw new ValidationError("Wallet signing address is missing.");
  }
  if (!record.requestedIdentityAddress) {
    throw new ValidationError("Requested identity address is missing.");
  }
  if (!automation?.commitmentTxid || !namereservation?.salt) {
    throw new ValidationError("Name commitment is missing.");
  }

  return {
    txid: automation.commitmentTxid,
    namereservation: {
      version: namereservation.version || 1,
      name: namereservation.name || record.requestedName,
      salt: namereservation.salt,
      referral: namereservation.referral || "",
      parent: namereservation.parent || record.parentId,
      nameid: namereservation.nameid || record.requestedIdentityAddress,
    },
    identity: {
      name: record.requestedName,
      parent: record.parentId,
      primaryaddresses: [record.walletSigningAddress],
      minimumsignatures: 1,
    },
  };
}

async function submitRegistration(
  verusId: VerusIdInterface,
  record: ProvisioningRecord,
): Promise<ProvisioningRecord> {
  const registrationTxid = await rpc<string>(verusId, "registeridentity", [
    buildRegistrationJson(record),
  ]);

  if (!registrationTxid) {
    throw new Error("registeridentity returned no transaction ID.");
  }

  return {
    ...record,
    status: "waiting_identity",
    updatedAt: now(),
    automation: {
      ...record.automation,
      state: "registration_submitted",
      registrationTxid,
      registrationSubmittedAt: now(),
      lastAttemptAt: now(),
      lastError: undefined,
    },
  };
}

export async function advanceProvisioningAutomation(params: {
  verusId: VerusIdInterface;
  config: AppConfig;
  store: RequestStore;
  record: ProvisioningRecord;
}): Promise<ProvisioningRecord> {
  if (!automationCandidate(params.record)) return params.record;

  let record = withAutomationAttempt(params.record);

  try {
    const requestedIdentityAddress = await resolveRequestedIdentityAddress(
      params.verusId,
      record,
    );
    if (record.requestedIdentityAddress !== requestedIdentityAddress) {
      record = {
        ...record,
        requestedIdentityAddress,
        updatedAt: now(),
      };
      await params.store.upsert(record);
    }

    const identityState = await getExistingIdentityState(params.verusId, record);
    if (identityState === "owned") {
      const completeRecord: ProvisioningRecord = {
        ...record,
        status: "ready",
        updatedAt: now(),
        lastResponseState: "COMPLETE",
        automation: {
          ...record.automation,
          state: "complete",
          lastAttemptAt: now(),
          lastError: undefined,
        },
      };
      await params.store.upsert(completeRecord);
      return completeRecord;
    }
    if (identityState === "taken") {
      throw new Error(`${record.requestedFqn} is already registered to another address.`);
    }

    if (
      record.automation?.state === "not_started" ||
      !record.automation?.commitmentTxid
    ) {
      const committedRecord = await submitCommitment(
        params.verusId,
        params.config,
        record,
      );
      await params.store.upsert(committedRecord);
      return committedRecord;
    }

    if (
      record.automation.state === "commit_submitted" ||
      record.automation.state === "waiting_commit_confirmation"
    ) {
      const confirmations = await getCommitmentConfirmations(
        params.verusId,
        record.automation.commitmentTxid,
      );
      record = {
        ...record,
        status: confirmations > 0 ? "registering" : "waiting_commit_confirmation",
        updatedAt: now(),
        automation: {
          ...record.automation,
          state:
            confirmations > 0
              ? "waiting_commit_confirmation"
              : "waiting_commit_confirmation",
          commitmentConfirmations: confirmations,
          lastAttemptAt: now(),
          lastError: undefined,
        },
      };
      await params.store.upsert(record);

      if (confirmations < 1) return record;

      const registrationRecord = await submitRegistration(params.verusId, record);
      await params.store.upsert(registrationRecord);
      return registrationRecord;
    }

    if (
      record.automation.state === "registration_submitted" ||
      record.automation.state === "waiting_identity"
    ) {
      const waitingRecord: ProvisioningRecord = {
        ...record,
        status: "waiting_identity",
        updatedAt: now(),
        automation: {
          ...record.automation,
          state: "waiting_identity",
          lastAttemptAt: now(),
          lastError: undefined,
        },
      };
      await params.store.upsert(waitingRecord);
      return waitingRecord;
    }

    return record;
  } catch (error) {
    return failAutomation(params.store, record, error);
  }
}

export async function advanceAllProvisioningAutomation(params: {
  verusId: VerusIdInterface;
  config: AppConfig;
  store: RequestStore;
}): Promise<void> {
  const records = await params.store.readAll();

  for (const record of records) {
    await advanceProvisioningAutomation({
      ...params,
      record,
    });
  }
}
