/**
 * Colony Registry schema types and validation.
 *
 * The registry is a static, manually-curated directory of known Colony
 * instances. It lives at `web/colony-registry.json` (committed source) and is
 * published at `<deployed-url>/data/colony-registry.json` by the build.
 *
 * Colony instances self-register by opening a PR to add their entry.
 */

export interface ColonyRegistryDataEndpoints {
  /** URL to this instance's activity.json data file. */
  activityJson: string;
  /** URL to this instance's governance-history.json data file. */
  governanceHistoryJson: string;
  /**
   * URL to this instance's CHAOSS metrics snapshot (data/metrics/snapshot.json).
   * Optional — older Colony deployments may not publish this endpoint.
   */
  chaossMetricsJson?: string;
}

export interface ColonyRegistryEntry {
  /**
   * Human-readable name for this instance, typically the GitHub repo slug
   * (e.g. "hivemoot/colony").
   */
  name: string;
  /**
   * Base URL of this Colony instance's dashboard (no trailing slash).
   * Example: "https://hivemoot.github.io/colony"
   */
  instanceUrl: string;
  /** Data endpoint URLs for this instance. */
  dataEndpoints: ColonyRegistryDataEndpoints;
  /**
   * URL to this instance's RFC 8615 well-known federation stub
   * (`/.well-known/colony-instance.json`). Optional but recommended.
   */
  federationStubUrl?: string;
  /**
   * Colony instance schema version (from `colony-instance.json`).
   * Used to gate cross-Colony metric compatibility checks.
   */
  schemaVersion: string;
  /** ISO 8601 date string when this entry was first added to the registry. */
  registeredAt: string;
  /** Optional human-readable description of this Colony deployment. */
  description?: string;
}

export interface ColonyRegistry {
  /** Registry format version — currently "1". */
  schemaVersion: string;
  /** ISO 8601 timestamp of the last registry update. */
  updatedAt: string;
  /** List of registered Colony instances. */
  entries: ColonyRegistryEntry[];
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isIsoDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Accept full ISO datetime or date-only strings
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !isNaN(Date.parse(value));
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a single registry entry.
 * Returns a list of errors; an empty list means the entry is valid.
 */
export function validateRegistryEntry(
  entry: unknown,
  index: number
): ValidationResult {
  const errors: string[] = [];
  const prefix = `entries[${index}]`;

  if (typeof entry !== 'object' || entry === null) {
    return { valid: false, errors: [`${prefix}: must be an object`] };
  }

  const e = entry as Record<string, unknown>;

  if (typeof e.name !== 'string' || !e.name.trim()) {
    errors.push(`${prefix}.name: required non-empty string`);
  }

  if (!isHttpsUrl(e.instanceUrl)) {
    errors.push(
      `${prefix}.instanceUrl: required https:// URL (got ${JSON.stringify(e.instanceUrl)})`
    );
  }

  if (typeof e.schemaVersion !== 'string' || !e.schemaVersion.trim()) {
    errors.push(`${prefix}.schemaVersion: required non-empty string`);
  }

  if (!isIsoDateString(e.registeredAt)) {
    errors.push(
      `${prefix}.registeredAt: required ISO date string (got ${JSON.stringify(e.registeredAt)})`
    );
  }

  // Validate dataEndpoints
  if (typeof e.dataEndpoints !== 'object' || e.dataEndpoints === null) {
    errors.push(`${prefix}.dataEndpoints: required object`);
  } else {
    const de = e.dataEndpoints as Record<string, unknown>;
    if (!isHttpsUrl(de.activityJson)) {
      errors.push(
        `${prefix}.dataEndpoints.activityJson: required https:// URL`
      );
    }
    if (!isHttpsUrl(de.governanceHistoryJson)) {
      errors.push(
        `${prefix}.dataEndpoints.governanceHistoryJson: required https:// URL`
      );
    }
    if (
      de.chaossMetricsJson !== undefined &&
      !isHttpsUrl(de.chaossMetricsJson)
    ) {
      errors.push(
        `${prefix}.dataEndpoints.chaossMetricsJson: when present, must be an https:// URL`
      );
    }
  }

  // Optional fields with type checks
  if (e.federationStubUrl !== undefined && !isHttpsUrl(e.federationStubUrl)) {
    errors.push(
      `${prefix}.federationStubUrl: when present, must be an https:// URL`
    );
  }

  if (e.description !== undefined && typeof e.description !== 'string') {
    errors.push(`${prefix}.description: when present, must be a string`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse and validate a ColonyRegistry object.
 *
 * Validates per-entry fields, and also checks that `name` and `instanceUrl`
 * are unique across all entries — duplicate values indicate a data error or
 * a duplicate registration attempt.
 *
 * Returns errors for any structural, type, or uniqueness violation.
 */
export function validateRegistry(raw: unknown): {
  registry: ColonyRegistry | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { registry: null, errors: ['registry: must be an object'] };
  }

  const r = raw as Record<string, unknown>;

  if (typeof r.schemaVersion !== 'string' || !r.schemaVersion.trim()) {
    errors.push('schemaVersion: required non-empty string');
  }

  if (!isIsoDateString(r.updatedAt)) {
    errors.push(
      `updatedAt: required ISO date string (got ${JSON.stringify(r.updatedAt)})`
    );
  }

  if (!Array.isArray(r.entries)) {
    errors.push('entries: must be an array');
  } else {
    for (let i = 0; i < r.entries.length; i++) {
      const result = validateRegistryEntry(r.entries[i], i);
      errors.push(...result.errors);
    }

    // Uniqueness validation: name and instanceUrl must be unique across entries
    const names = r.entries.map(
      (e: unknown) => (e as Record<string, unknown>).name as string | undefined
    );
    const urls = r.entries.map(
      (e: unknown) =>
        (e as Record<string, unknown>).instanceUrl as string | undefined
    );

    const dupName = names.find(
      (n, i) => n !== undefined && names.indexOf(n) !== i
    );
    if (dupName !== undefined) {
      errors.push(`entries: duplicate name "${dupName}"`);
    }

    const dupUrl = urls.find(
      (u, i) => u !== undefined && urls.indexOf(u) !== i
    );
    if (dupUrl !== undefined) {
      errors.push(`entries: duplicate instanceUrl "${dupUrl}"`);
    }
  }

  if (errors.length > 0) {
    return { registry: null, errors };
  }

  return { registry: raw as ColonyRegistry, errors: [] };
}
