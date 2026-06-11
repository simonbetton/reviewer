import { TextGenerationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);
type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

/**
 * OpenAI/Codex strict structured output rejects object schemas where a key in
 * `properties` is absent from `required`. Return dotted property paths for any
 * violations so callers can fail before spawning a provider CLI.
 */
export function findJsonSchemaMissingRequiredPropertyPaths(schema: unknown): ReadonlyArray<string> {
  const missing: string[] = [];

  const visitSchemaMap = (value: unknown, path: ReadonlyArray<string>) => {
    if (!isJsonObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key]);
    }
  };

  const visitCombinators = (value: unknown, path: ReadonlyArray<string>) => {
    if (!Array.isArray(value)) return;
    value.forEach((child) => visit(child, path));
  };

  const visit = (value: unknown, path: ReadonlyArray<string>) => {
    if (!isJsonObject(value)) return;

    const properties = isJsonObject(value.properties) ? value.properties : null;
    if (properties) {
      const required = Array.isArray(value.required)
        ? new Set(value.required.filter((entry): entry is string => typeof entry === "string"))
        : new Set<string>();

      for (const [key, child] of Object.entries(properties)) {
        const childPath = [...path, key];
        if (!required.has(key)) {
          missing.push(childPath.join("."));
        }
        visit(child, childPath);
      }
    }

    if ("items" in value) {
      visit(value.items, [...path, "items"]);
    }

    visitCombinators(value.anyOf, path);
    visitCombinators(value.oneOf, path);
    visitCombinators(value.allOf, path);
    visitSchemaMap(value.$defs, [...path, "$defs"]);
    visitSchemaMap(value.definitions, [...path, "definitions"]);
  };

  visit(schema, []);
  return missing;
}

/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

/** Normalise a raw PR title to a single line with a sensible fallback. */
export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 47).trimEnd()}...`;
}

/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

/**
 * Normalize an unknown error from a CLI text generation process into a
 * typed `TextGenerationError`. Parameterized by CLI name so both Codex
 * and Claude (and future providers) can share the same logic.
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
