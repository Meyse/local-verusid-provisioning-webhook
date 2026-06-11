import * as path from "path";
import express = require("express");
import * as QRCode from "qrcode";
import { advanceProvisioningAutomation } from "./automation";
import { AppConfig, getConfig } from "./config";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { ConfigError } from "./errors";
import { ValidationError, getErrorMessage } from "./errors";
import { parseGenericResponsePayload } from "./genericResponse";
import { normalizeWebhookBaseUrl, withTrailingAt } from "./names";
import {
  acceptProvisioningSubmission,
  getProvisionedIdentityStatus,
  signProvisioningResponse,
} from "./provisioning";
import { buildProvisioningGenericRequest } from "./requestBuilder";
import { loadSigningContext, signGenericRequestWithContext } from "./signing";
import { ProvisioningRecord, RequestStore } from "./store";
import {
  createVerusId,
  listParentIdentities,
  requireIdentity,
} from "./verus";

type GenerateQrPayload = {
  parentId?: string;
  webhookBaseUrl?: string;
  responseUri?: string;
};

type StoredProvisioningRecord = ProvisioningRecord & {
  dryRun?: unknown;
};

function statusForError(error: unknown): number {
  if (error instanceof ValidationError || error instanceof ConfigError) return 400;
  return 500;
}

function jsonError(res: express.Response, error: unknown): void {
  const status = statusForError(error);
  if (status === 500) console.error(error);
  res.status(status).json({ error: getErrorMessage(error) });
}

function canonicalParentFqn(parentIdentity: any, listedParentFqn?: string): string {
  const rawFqn =
    parentIdentity.fullyqualifiedname ||
    listedParentFqn ||
    parentIdentity.identity?.name ||
    parentIdentity.identity?.identityaddress;

  return withTrailingAt(String(rawFqn));
}

function defaultResponseUri(webhookBaseUrl: string): string {
  return `${normalizeWebhookBaseUrl(webhookBaseUrl)}/generic-response`;
}

function optionalHttpUri(value: unknown, fieldName: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a URL string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    throw new ValidationError(`${fieldName} must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`${fieldName} must use http or https.`);
  }

  return trimmed;
}

function visibleRecord(record: StoredProvisioningRecord): ProvisioningRecord {
  const { dryRun: _dryRun, ...visible } = record;
  return visible;
}

export function createApp(
  config: AppConfig = getConfig(),
  store: RequestStore = new RequestStore(),
) {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.resolve(process.cwd(), "views"));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.get("/", (_req, res) => {
    res.render("index", {
      webhookBaseUrl: config.webhookBaseUrl,
      responseUri: defaultResponseUri(config.webhookBaseUrl),
      systemId: VRSCTEST_SYSTEM_ID,
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      webhookBaseUrl: config.webhookBaseUrl,
      systemId: VRSCTEST_SYSTEM_ID,
      hasRpcCredentials: Boolean(config.rpcUser && config.rpcPassword),
      hasSigningWif: Boolean(config.verusSigningWif),
      hasSigningId: Boolean(config.provisioningSigningId),
      usesSelectedParentAsSigner: !Boolean(config.provisioningSigningId),
      autoRegistration: true,
      commitmentControlAddress: config.commitmentControlAddress || "",
    });
  });

  app.get("/api/parents", async (_req, res) => {
    try {
      const verusId = createVerusId(config);
      res.json({ parents: await listParentIdentities(verusId) });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post("/api/generate-provisioning-qr", async (req, res) => {
    try {
      const payload = req.body as GenerateQrPayload;
      if (!payload.parentId || typeof payload.parentId !== "string") {
        throw new ValidationError("parentId is required.");
      }

      const verusId = createVerusId(config);
      const parentIdentity = await requireIdentity(verusId, payload.parentId);
      const localParents = await listParentIdentities(verusId);

      const parentId = parentIdentity.identity!.identityaddress!;
      const listedParent = localParents.find(
        (parent) =>
          parent.iAddress === parentId ||
          parent.iAddress === payload.parentId ||
          parent.fullyQualifiedName === payload.parentId,
      );
      const parentFqn = canonicalParentFqn(
        parentIdentity,
        listedParent?.fullyQualifiedName,
      );
      const signingContext = await loadSigningContext(verusId, config, parentId);
      const webhookBaseUrl = payload.webhookBaseUrl || config.webhookBaseUrl;
      const responseUri =
        payload.responseUri === undefined
          ? defaultResponseUri(webhookBaseUrl)
          : optionalHttpUri(payload.responseUri, "responseUri");

      const built = buildProvisioningGenericRequest({
        parentId,
        webhookBaseUrl,
        responseUri,
        signingIdentityId: signingContext.signingIdentityAddress,
      });

      await signGenericRequestWithContext(verusId, built.request, signingContext);

      const deeplink = built.request.toWalletDeeplinkUri();
      const qrDataUrl = await QRCode.toDataURL(deeplink, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 6,
      });

      const record: ProvisioningRecord = {
        challengeId: built.requestId,
        parentId,
        parentFqn,
        parentName: parentIdentity.identity!.name || parentFqn,
        systemId: VRSCTEST_SYSTEM_ID,
        webhookBaseUrl: built.webhookBaseUrl,
        webhookUrl: built.webhookUrl,
        responseUri: built.responseUri,
        deeplink,
        qrGeneratedAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        status: "qr_generated",
        signingId: signingContext.signingIdentityAddress,
      };

      await store.upsert(record);

      res.json({
        deeplink,
        qrDataUrl,
        requestId: built.requestId,
        parent: {
          name: record.parentName,
          iAddress: record.parentId,
          fullyQualifiedName: record.parentFqn,
        },
        webhookUrl: built.webhookUrl,
        responseUri: built.responseUri,
      });
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.post(
    "/generic-response",
    express.raw({ type: "application/octet-stream", limit: "2mb" }),
    async (req, res) => {
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new ValidationError("Generic response body must be a binary payload.");
        }

        const { response, receipt } = parseGenericResponsePayload(req.body);
        if (!receipt.requestId) {
          throw new ValidationError("Generic response did not include an auth request ID.");
        }

        const record = await store.get(receipt.requestId);
        if (!record) {
          throw new ValidationError(`Unknown generic response request ${receipt.requestId}.`);
        }

        const now = Math.floor(Date.now() / 1000);
        const verusId = createVerusId(config);
        const verified = await verusId.verifyGenericResponse(
          response,
          undefined,
          VRSCTEST_SYSTEM_ID,
        );
        const nextRecord: ProvisioningRecord = {
          ...record,
          updatedAt: now,
          genericResponse: {
            ...receipt,
            receivedAt: now,
            verified,
          },
          genericResponseError: verified
            ? undefined
            : "Generic response signature verification failed.",
        };

        await store.upsert(nextRecord);

        if (!verified) {
          throw new ValidationError("Generic response signature verification failed.");
        }

        res.json({
          ok: true,
          requestId: receipt.requestId,
          signerIdentityId: receipt.signerIdentityId,
          verified,
        });
      } catch (error) {
        jsonError(res, error);
      }
    },
  );

  app.post("/provision", async (req, res) => {
    try {
      const challengeId = req.body?.challenge?.challenge_id;
      if (!challengeId || typeof challengeId !== "string") {
        throw new ValidationError("Provisioning request challenge_id is required.");
      }

      const record = await store.get(challengeId);
      if (!record) throw new ValidationError(`Unknown challenge_id ${challengeId}.`);

      const verusId = createVerusId(config);
      const { response } = await acceptProvisioningSubmission({
        verusId,
        config,
        store,
        record,
        body: req.body,
      });

      res.json(response);
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/provision/status/:challengeId", async (req, res) => {
    try {
      const storedRecord = await store.get(req.params.challengeId);
      if (!storedRecord) {
        throw new ValidationError(`Unknown challenge_id ${req.params.challengeId}.`);
      }
      if (!storedRecord.rawProvisioningRequest) {
        throw new ValidationError("Wallet submission has not been received yet.");
      }

      const verusId = createVerusId(config);
      const record = await advanceProvisioningAutomation({
        verusId,
        config,
        store,
        record: storedRecord,
      });

      if (record.status === "failed") {
        const response = await signProvisioningResponse({
          verusId,
          config,
          record,
          requestBody: record.rawProvisioningRequest,
          state: "failed",
        });
        res.json(response);
        return;
      }

      const chainStatus = await getProvisionedIdentityStatus(verusId, record);
      const nextRecord: ProvisioningRecord = {
        ...record,
        status: chainStatus.state === "complete" ? "ready" : record.status,
        updatedAt: Math.floor(Date.now() / 1000),
        lastResponseState:
          chainStatus.state === "complete"
            ? "COMPLETE"
            : "PENDINGAPPROVAL",
        lastChainCheck: {
          checkedAt: Math.floor(Date.now() / 1000),
          ...chainStatus,
        },
      };

      await store.upsert(nextRecord);

      const response = await signProvisioningResponse({
        verusId,
        config,
        record: nextRecord,
        requestBody: nextRecord.rawProvisioningRequest,
        state: chainStatus.state,
      });

      res.json(response);
    } catch (error) {
      jsonError(res, error);
    }
  });

  app.get("/api/requests", async (_req, res) => {
    try {
      const records = await store.readAll();
      res.json({ requests: records.map(visibleRecord) });
    } catch (error) {
      jsonError(res, error);
    }
  });

  return app;
}
