export function withTrailingAt(fqn: string): string {
  const trimmed = fqn.trim();
  return trimmed.endsWith("@") ? trimmed : `${trimmed}@`;
}

export function withoutTrailingAt(fqn: string): string {
  return fqn.trim().replace(/@+$/g, "");
}

export function buildChildFqn(childName: string, parentFqn: string): string {
  const name = normalizeRequestedChildName(childName);
  if (!name) throw new Error("Requested name is required.");
  return `${name}.${withTrailingAt(parentFqn)}`;
}

export function normalizeRequestedChildName(childName: string): string {
  return childName.trim().replace(/@+$/g, "").split(".")[0];
}

export function normalizeWebhookBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/g, "");
}
