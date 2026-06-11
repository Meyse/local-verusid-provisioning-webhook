import * as fs from "fs/promises";
import * as path from "path";
import { REQUEST_STORE_FILE } from "./constants";

export type ProvisioningRecord = {
  challengeId: string;
  parentId: string;
  parentFqn: string;
  parentName: string;
  systemId: string;
  webhookBaseUrl: string;
  webhookUrl: string;
  responseUri?: string;
  deeplink: string;
  qrGeneratedAt: number;
  updatedAt: number;
  status:
    | "qr_generated"
    | "submitted"
    | "committing"
    | "waiting_commit_confirmation"
    | "registering"
    | "waiting_identity"
    | "ready"
    | "failed";
  signingId?: string;
  walletSigningAddress?: string;
  requestedName?: string;
  requestedFqn?: string;
  requestedIdentityAddress?: string;
  rawProvisioningRequest?: unknown;
  lastResponseState?: string;
  genericResponse?: {
    receivedAt: number;
    verified: boolean;
    requestId?: string;
    signerIdentityId?: string;
    signerSystemId?: string;
    createdAt?: number;
    handledBy?: number;
    rawResponseHex: string;
    responseJson: unknown;
  };
  genericResponseError?: string;
  automation?: {
    state:
      | "not_started"
      | "commit_submitted"
      | "waiting_commit_confirmation"
      | "registration_submitted"
      | "waiting_identity"
      | "complete"
      | "failed";
    commitmentControlAddress?: string;
    commitmentTxid?: string;
    commitmentConfirmations?: number;
    commitmentSubmittedAt?: number;
    namereservation?: {
      version?: number;
      name: string;
      salt: string;
      referral?: string;
      parent?: string;
      nameid?: string;
    };
    registrationTxid?: string;
    registrationSubmittedAt?: number;
    lastAttemptAt?: number;
    lastError?: string;
  };
  lastChainCheck?: {
    checkedAt: number;
    state: "pending" | "complete";
    identityAddress?: string;
    primaryAddresses?: string[];
    message?: string;
  };
};

type StoreFile = {
  records: ProvisioningRecord[];
};

export class RequestStore {
  constructor(private readonly filePath = path.resolve(process.cwd(), REQUEST_STORE_FILE)) {}

  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async readAll(): Promise<ProvisioningRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      return Array.isArray(parsed.records) ? parsed.records : [];
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(records: ProvisioningRecord[]): Promise<void> {
    await this.ensureDataDir();
    const payload: StoreFile = { records };
    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async get(challengeId: string): Promise<ProvisioningRecord | undefined> {
    const records = await this.readAll();
    return records.find((record) => record.challengeId === challengeId);
  }

  async upsert(record: ProvisioningRecord): Promise<ProvisioningRecord> {
    const records = await this.readAll();
    const index = records.findIndex((entry) => entry.challengeId === record.challengeId);
    if (index === -1) records.unshift(record);
    else records[index] = record;
    await this.writeAll(records);
    return record;
  }
}
