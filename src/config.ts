import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEFAULT_RPC_HOST,
  DEFAULT_RPC_PORT,
  DEFAULT_UI_HOST,
  DEFAULT_UI_PORT,
  DEFAULT_WEBHOOK_BASE_URL,
} from "./constants";
import { ConfigError } from "./errors";

export type AppConfig = {
  uiHost?: string;
  uiPort: number;
  webhookBaseUrl: string;
  rpcHost: string;
  rpcPort: number;
  rpcUser?: string;
  rpcPassword?: string;
  provisioningSigningId?: string;
  verusSigningWif?: string;
  commitmentControlAddress?: string;
};

type LocalConfig = Record<string, unknown>;

type VerusConf = {
  rpchost?: string;
  rpcport?: string;
  rpcuser?: string;
  rpcpassword?: string;
};

function loadLocalConfig(): LocalConfig {
  const configPath = path.resolve(process.cwd(), "config.js");
  if (!fs.existsSync(configPath)) return {};

  // config.js is intentionally local-only and ignored by git.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require(configPath);
  return loaded && typeof loaded === "object" ? loaded : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown, fallback: number, fieldName: string): number {
  const raw = value == null || value === "" ? fallback : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function pick(local: LocalConfig, envName: string): unknown {
  return process.env[envName] ?? local[envName];
}

export function parseVerusConfContent(content: string): VerusConf {
  const parsed: VerusConf = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim().toLowerCase();
    const value = line.slice(equalsIndex + 1).trim();

    if (
      key === "rpchost" ||
      key === "rpcport" ||
      key === "rpcuser" ||
      key === "rpcpassword"
    ) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function getDefaultVrsctestConfPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Komodo",
    "vrsctest",
    "vrsctest.conf",
  );
}

function loadVrsctestConf(local: LocalConfig): VerusConf {
  const confPath =
    optionalString(pick(local, "VRSCTEST_CONF_PATH")) || getDefaultVrsctestConfPath();

  if (!fs.existsSync(confPath)) return {};
  return parseVerusConfContent(fs.readFileSync(confPath, "utf8"));
}

export function getConfig(): AppConfig {
  const local = loadLocalConfig();
  const verusConf = loadVrsctestConf(local);

  return {
    uiHost: optionalString(pick(local, "UI_HOST")) ?? DEFAULT_UI_HOST,
    uiPort: numberValue(pick(local, "UI_PORT"), DEFAULT_UI_PORT, "UI_PORT"),
    webhookBaseUrl:
      optionalString(pick(local, "WEBHOOK_BASE_URL")) ?? DEFAULT_WEBHOOK_BASE_URL,
    rpcHost:
      optionalString(pick(local, "RPC_HOST")) ??
      optionalString(verusConf.rpchost) ??
      DEFAULT_RPC_HOST,
    rpcPort: numberValue(
      pick(local, "RPC_PORT") ?? verusConf.rpcport,
      DEFAULT_RPC_PORT,
      "RPC_PORT",
    ),
    rpcUser: optionalString(pick(local, "RPC_USER")) ?? optionalString(verusConf.rpcuser),
    rpcPassword:
      optionalString(pick(local, "RPC_PASSWORD")) ??
      optionalString(verusConf.rpcpassword),
    provisioningSigningId: optionalString(pick(local, "PROVISIONING_SIGNING_ID")),
    verusSigningWif: optionalString(pick(local, "VERUS_SIGNING_WIF")),
    commitmentControlAddress: optionalString(
      pick(local, "COMMITMENT_CONTROL_ADDRESS"),
    ),
  };
}

export function requireRpcConfig(config: AppConfig): Required<Pick<AppConfig, "rpcUser" | "rpcPassword">> {
  if (!config.rpcUser) throw new ConfigError("RPC_USER is required.");
  if (!config.rpcPassword) throw new ConfigError("RPC_PASSWORD is required.");
  return {
    rpcUser: config.rpcUser,
    rpcPassword: config.rpcPassword,
  };
}

export function requireSigningConfig(
  config: AppConfig,
  signingIdOverride?: string,
): Pick<AppConfig, "verusSigningWif"> & { provisioningSigningId: string } {
  const provisioningSigningId = signingIdOverride || config.provisioningSigningId;
  if (!provisioningSigningId) {
    throw new ConfigError(
      "PROVISIONING_SIGNING_ID is required when no parent signing ID is provided.",
    );
  }
  return {
    provisioningSigningId,
    verusSigningWif: config.verusSigningWif,
  };
}
