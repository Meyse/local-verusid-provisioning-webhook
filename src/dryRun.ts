import { AppConfig } from "./config";
import { ProvisioningRecord } from "./store";
import { withoutTrailingAt } from "./names";

export type DryRunCommands = {
  commitmentCommand: string;
  registrationCommand: string;
  notes: string[];
};

function shellQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildDryRunCommands(
  record: ProvisioningRecord,
  config: AppConfig,
): DryRunCommands {
  const requestedName = record.requestedName || "<requested-name>";
  const parentArg = withoutTrailingAt(record.parentFqn);
  const controlAddress =
    record.automation?.commitmentControlAddress ||
    config.commitmentControlAddress ||
    "$COMMITMENT_CONTROL_ADDRESS";
  const walletAddress = record.walletSigningAddress || "<mobile-wallet-signing-address>";
  const namereservation = record.automation?.namereservation;

  const commitmentCommand = [
    "./verus",
    "-chain=VRSCTEST",
    "registernamecommitment",
    shellQuote(requestedName),
    shellQuote(controlAddress),
    shellQuote(""),
    shellQuote(parentArg),
  ].join(" ");

  const registrationJson = {
    txid: record.automation?.commitmentTxid || "<commitment-txid>",
    namereservation: {
      version: namereservation?.version || 1,
      name: namereservation?.name || requestedName,
      salt: namereservation?.salt || "<salt-from-commitment>",
      referral: namereservation?.referral || "",
      parent: namereservation?.parent || record.parentId,
      nameid:
        namereservation?.nameid ||
        record.requestedIdentityAddress ||
        "<subid-i-address-from-commitment>",
    },
    identity: {
      name: requestedName,
      parent: record.parentId,
      primaryaddresses: [walletAddress],
      minimumsignatures: 1,
    },
  };

  return {
    commitmentCommand,
    registrationCommand: `./verus -chain=VRSCTEST registeridentity '${JSON.stringify(
      registrationJson,
      null,
      2,
    )}'`,
    notes: [
      "The commitment control address must be controlled by the local provisioning wallet; if none is configured, the selected parent's first primary address is used.",
      "The mobile wallet address is used as the SubID primary address in registeridentity.",
      "Wait for one confirmation after registernamecommitment before running registeridentity.",
      "Keep parent in both namereservation and identity; omitting it targets the wrong namespace.",
    ],
  };
}
