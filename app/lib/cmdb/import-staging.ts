export type PreviewRow = Record<string, unknown>;

export type ImportFormat = "csv" | "json" | "txt" | "auto" | string;

export type StagingRelationshipDraft = {
  source: string;
  target: string;
  source_relationship_type?: string;
  normalized_relationship_type?: string;
};

export type StagingCiDraft = {
  id: string;
  source_identifier: string;
  source_name: string;
  source_native_key: string;
  source_record_id: string;
  source_row_number?: number;
  parser_version: string;
  name?: string;
  host_name?: string;
  fqdn?: string;
  className?: string;
  ci_class?: string;
  ip_address?: string;
  mac_address?: string;
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  operating_system?: string;
  os_version?: string;
  environment?: string;
  owned_by?: string;
  owner?: string;
  support_group?: string;
  location?: string;
  business_application?: string;
  application_service?: string;
  entry_point?: string;
  port?: string;
  protocol?: string;
  source?: string;
  team_identifier?: string;
  raw_row_json: PreviewRow;
  normalized_row_json: PreviewRow;
};

export type StructuredStagingPayload = {
  parserVersion: string;
  cis: StagingCiDraft[];
  relationships: StagingRelationshipDraft[];
};

export type PreviewResult = {
  rows: PreviewRow[];
  error: string;
};

export const CSV_PARSER_VERSION = "keystone-browser-csv-v1";
const IDENTITY_FIELDS = ["source_native_key", "source_record_id", "source_identifier", "id", "name", "host_name", "fqdn"];

export function parseCsv(text: string): PreviewRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index++;
      row.push(cell.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);

  const [headers = [], ...records] = rows;
  return records.map((record, rowIndex) => {
    const parsed = Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, record[index] ?? ""]));
    return { ...parsed, source_row_number: rowIndex + 2 };
  });
}

export function rowsFromJson(value: unknown): PreviewRow[] {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      item && typeof item === "object" ? { ...(item as PreviewRow), source_row_number: index + 1 } : { value: item, source_row_number: index + 1 },
    );
  }
  if (!value || typeof value !== "object") return [{ value, source_row_number: 1 }];
  const object = value as Record<string, unknown>;
  for (const key of ["result", "data", "items", "records", "components", "value", "cis"]) {
    if (Array.isArray(object[key])) return rowsFromJson(object[key]);
  }
  return [{ ...object, source_row_number: 1 }];
}

export function previewFromText(text: string, formatHint: ImportFormat = ""): PreviewResult {
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], error: "" };
  try {
    if (formatHint.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return { rows: rowsFromJson(JSON.parse(trimmed)), error: "" };
    }
    return { rows: parseCsv(trimmed), error: "" };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : "The payload could not be parsed.",
    };
  }
}

export function buildStructuredStagingPayload(rows: PreviewRow[], sourceName: string): StructuredStagingPayload {
  const cis = rows.map((row, index) => normalizeStagingCi(row, sourceName, index));
  return {
    parserVersion: CSV_PARSER_VERSION,
    cis,
    relationships: inferRelationships(cis),
  };
}

export function buildStructuredStagingPayloadFromText(text: string, formatHint: ImportFormat, sourceName: string): StructuredStagingPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (formatHint.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const object = parsed as Record<string, unknown>;
      const ciRows = Array.isArray(object.cis) ? object.cis as PreviewRow[] : rowsFromJson(parsed);
      const cis = ciRows.map((row, index) => normalizeStagingCi(row, sourceName, index));
      const explicitRelationships = Array.isArray(object.relationships)
        ? normalizeExplicitRelationships(object.relationships as PreviewRow[], new Set(cis.map(ci => ci.source_identifier)))
        : [];
      return {
        parserVersion: CSV_PARSER_VERSION,
        cis,
        relationships: explicitRelationships.length ? explicitRelationships : inferRelationships(cis),
      };
    }
  }

  return buildStructuredStagingPayload(previewFromText(text, formatHint).rows, sourceName);
}

function normalizeStagingCi(row: PreviewRow, sourceName: string, index: number): StagingCiDraft {
  const normalized = normalizeKeys(row);
  const nativeKey = firstValue(normalized, IDENTITY_FIELDS) || `row-${index + 1}`;
  const name = stringValue(normalized.name) || stringValue(normalized.host_name) || stringValue(normalized.fqdn) || nativeKey;
  const proposedClass = stringValue(normalized.className) || stringValue(normalized.ci_class) || proposedClassFromOs(normalized);

  return {
    id: nativeKey,
    source_identifier: nativeKey,
    source_name: sourceName,
    source_native_key: nativeKey,
    source_record_id: stringValue(normalized.source_record_id) || nativeKey,
    source_row_number: numberValue(normalized.source_row_number) || index + 1,
    parser_version: CSV_PARSER_VERSION,
    name,
    host_name: stringValue(normalized.host_name),
    fqdn: stringValue(normalized.fqdn),
    className: proposedClass,
    ci_class: proposedClass,
    ip_address: stringValue(normalized.ip_address) || stringValue(normalized.ip),
    mac_address: stringValue(normalized.mac_address),
    serial_number: stringValue(normalized.serial_number),
    manufacturer: stringValue(normalized.manufacturer),
    model: stringValue(normalized.model),
    operating_system: stringValue(normalized.operating_system) || stringValue(normalized.os),
    os_version: stringValue(normalized.os_version),
    environment: stringValue(normalized.environment),
    owned_by: stringValue(normalized.owned_by),
    owner: stringValue(normalized.owned_by) || stringValue(normalized.owner),
    support_group: stringValue(normalized.support_group),
    location: stringValue(normalized.location),
    business_application: stringValue(normalized.business_application),
    application_service: stringValue(normalized.application_service),
    entry_point: stringValue(normalized.entry_point) || stringValue(normalized.url),
    port: stringValue(normalized.port),
    protocol: stringValue(normalized.protocol),
    source: stringValue(normalized.source) || sourceName,
    team_identifier: stringValue(normalized.team_identifier),
    raw_row_json: row,
    normalized_row_json: normalized,
  };
}

function normalizeKeys(row: PreviewRow): PreviewRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replaceAll(" ", "_"), value]));
}

function inferRelationships(cis: StagingCiDraft[]): StagingRelationshipDraft[] {
  const byKey = new Set(cis.map(ci => ci.source_identifier));
  const relationships: StagingRelationshipDraft[] = [];
  const seen = new Set<string>();

  for (const ci of cis) {
    const normalized = ci.normalized_row_json;
    addRelationship(relationships, seen, byKey, stringValue(normalized.upstream_dependency), ci.source_identifier, "upstream_dependency");
    addRelationship(relationships, seen, byKey, ci.source_identifier, stringValue(normalized.downstream_dependency), "downstream_dependency");
    addRelationship(relationships, seen, byKey, stringValue(normalized.parent), ci.source_identifier, "parent");
    addRelationship(relationships, seen, byKey, stringValue(normalized.source_ci), stringValue(normalized.target_ci), "source_ci_target_ci");
  }

  return relationships;
}

function normalizeExplicitRelationships(rows: PreviewRow[], byKey: Set<string>): StagingRelationshipDraft[] {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const normalized = normalizeKeys(row);
    const source = stringValue(normalized.source) || stringValue(normalized.parent) || stringValue(normalized.from);
    const target = stringValue(normalized.target) || stringValue(normalized.child) || stringValue(normalized.to);
    if (!source || !target || !byKey.has(source) || !byKey.has(target) || source === target) return [];
    const key = `${source}|${target}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      source,
      target,
      source_relationship_type: stringValue(normalized.source_relationship_type) || stringValue(normalized.type) || "explicit",
      normalized_relationship_type: stringValue(normalized.normalized_relationship_type) || "Depends on::Used by",
    }];
  });
}

function addRelationship(relationships: StagingRelationshipDraft[], seen: Set<string>, byKey: Set<string>, source: string, target: string, type: string) {
  if (!source || !target || !byKey.has(source) || !byKey.has(target) || source === target) return;
  const key = `${source}|${target}`;
  if (seen.has(key)) return;
  seen.add(key);
  relationships.push({
    source,
    target,
    source_relationship_type: type,
    normalized_relationship_type: "Depends on::Used by",
  });
}

function proposedClassFromOs(row: PreviewRow) {
  const os = `${stringValue(row.operating_system)} ${stringValue(row.os)}`.toLowerCase();
  if (os.includes("linux")) return "cmdb_ci_linux_server";
  if (os.includes("windows")) return "cmdb_ci_win_server";
  return "cmdb_ci_server";
}

function firstValue(row: PreviewRow, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(row[key]);
    if (value) return value;
  }
  return "";
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
