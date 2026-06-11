import { VerusIdInterface } from "verusid-ts-client";
import { AppConfig, requireRpcConfig } from "./config";
import { VRSCTEST_SYSTEM_ID } from "./constants";
import { ValidationError } from "./errors";

export type ParentIdentity = {
  name: string;
  iAddress: string;
  fullyQualifiedName: string;
  status?: string;
  parent?: string;
  systemId?: string;
};

export type IdentityResult = {
  fullyqualifiedname?: string;
  status?: string;
  identity?: {
    name?: string;
    identityaddress?: string;
    parent?: string;
    systemid?: string;
    primaryaddresses?: string[];
    minimumsignatures?: number;
  };
};

export function createVerusId(config: AppConfig): VerusIdInterface {
  const { rpcUser, rpcPassword } = requireRpcConfig(config);
  return new VerusIdInterface(
    VRSCTEST_SYSTEM_ID,
    `http://${config.rpcHost}:${config.rpcPort}`,
    {
      auth: {
        username: rpcUser,
        password: rpcPassword,
      },
    } as any,
  );
}

export async function getCurrentHeight(verusId: VerusIdInterface): Promise<number> {
  const infoRes = await verusId.interface.getInfo();
  if (infoRes.error) throw new Error(infoRes.error.message);

  const height = infoRes.result?.longestchain ?? infoRes.result?.blocks;
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("getinfo returned no usable chain height.");
  }
  return height;
}

export async function getIdentity(
  verusId: VerusIdInterface,
  identity: string,
): Promise<IdentityResult | null> {
  const result = await verusId.interface.getIdentity(identity);
  if (result.error) return null;
  return result.result ?? null;
}

export async function requireIdentity(
  verusId: VerusIdInterface,
  identity: string,
): Promise<IdentityResult> {
  const result = await verusId.interface.getIdentity(identity);
  if (result.error) {
    throw new ValidationError(result.error.message || `Identity ${identity} not found.`);
  }
  if (!result.result?.identity?.identityaddress) {
    throw new ValidationError(`Identity ${identity} did not include an identity address.`);
  }
  return result.result;
}

export async function listParentIdentities(
  verusId: VerusIdInterface,
): Promise<ParentIdentity[]> {
  const result = await verusId.interface.request({
    cmd: "listidentities",
    getParams: () => [],
  } as any);

  if (result.error) {
    throw new Error(result.error.message || "listidentities failed.");
  }

  const entries = Array.isArray(result.result) ? result.result : [];

  return entries
    .filter((entry: any) => entry?.identity?.name && entry?.identity?.identityaddress)
    .map((entry: any) => ({
      name: String(entry.identity.name),
      iAddress: String(entry.identity.identityaddress),
      fullyQualifiedName:
        typeof entry.fullyqualifiedname === "string"
          ? entry.fullyqualifiedname
          : `${entry.identity.name}@`,
      status: entry.status,
      parent: entry.identity.parent,
      systemId: entry.identity.systemid,
    }))
    .filter((identity) => identity.status == null || identity.status === "active")
    .sort((a, b) => a.fullyQualifiedName.localeCompare(b.fullyQualifiedName));
}
