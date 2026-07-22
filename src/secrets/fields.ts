import { loadProviders, BASE_PROVIDERS, type ProviderCatalogEntry } from '../ingest/providers.js';
import { getSecret } from './keychain.js';

/**
 * The secrets the system needs, grouped for the import form. Keys are Keychain
 * account names ("<provider>.<field>"). This list is DERIVED from the active
 * providers (loadProviders) rather than hardcoded, so it always matches what
 * the user actually selected in onboarding — including extra accounts.
 */

export interface SecretField {
  key: string;
  label: string;
  optional?: boolean;
}

export interface SecretGroup {
  title: string;
  fields: SecretField[];
}

/** Look up field descriptors (labels/hints) for a provider instance's base. */
function catalogFor(instanceId: string): ProviderCatalogEntry | undefined {
  if (BASE_PROVIDERS[instanceId]) return BASE_PROVIDERS[instanceId];
  // Derived instance (leumi2): strip a trailing number to find the base.
  const base = instanceId.replace(/\d+$/, '');
  return BASE_PROVIDERS[base];
}

/** The always-present optional group: the advisor's Anthropic API key. */
const ANTHROPIC_GROUP: SecretGroup = {
  title: 'Anthropic (לסוכן — אופציונלי)',
  fields: [{ key: 'anthropic.apiKey', label: 'API Key', optional: true }],
};

/** Build the form groups from the currently active providers. */
export function secretGroups(): SecretGroup[] {
  const providers = loadProviders();
  const groups: SecretGroup[] = [];
  for (const [id, provider] of Object.entries(providers)) {
    const catalog = catalogFor(id);
    const fields: SecretField[] = provider.credentialFields.map((name) => {
      const desc = catalog?.fields.find((f) => f.name === name);
      return { key: `${id}.${name}`, label: desc?.label ?? name };
    });
    groups.push({ title: provider.displayName, fields });
  }
  groups.push(ANTHROPIC_GROUP);
  return groups;
}

/** Flat list of every secret field across all active providers. */
export function allSecretFields(): SecretField[] {
  return secretGroups().flatMap((g) => g.fields);
}

/** True once at least one non-optional secret exists (used by the wizard). */
export function hasAnySecret(): boolean {
  return allSecretFields().some((f) => !f.optional && getSecret(f.key) !== null);
}
