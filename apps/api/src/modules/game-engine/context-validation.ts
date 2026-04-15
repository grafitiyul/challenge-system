import { BadRequestException } from '@nestjs/common';

// =============================================================================
// Context schema types
// =============================================================================
// A GameAction may declare `contextSchemaJson` describing the dimensions that a
// participant must/can provide when submitting. contextJson on UserActionLog
// conforms to this schema. Validation is centralized here — there is no
// hardcoded knowledge of specific dimensions (no "meal" etc.) in the codebase.
// =============================================================================

export type ContextDimensionType = 'select' | 'text' | 'number' | 'time';

export interface ContextDimensionOption {
  value: string;
  label: string;
  deprecated?: boolean;
}

export interface ContextDimension {
  key: string;
  label: string;
  type: ContextDimensionType;
  required?: boolean;
  /** For type='select' only. */
  options?: ContextDimensionOption[];
  /** For type='number' only. Inclusive bounds. */
  min?: number;
  max?: number;
}

export interface ContextSchema {
  dimensions: ContextDimension[];
}

/**
 * Validate a contextJson payload against a contextSchemaJson.
 *
 * - Missing `schemaJson` → only permits null/empty `contextJson`.
 * - Required dimensions must be present and non-empty.
 * - `select` values must match a non-deprecated option's `value`.
 * - `number` values must parse and respect min/max.
 * - `time` values must match HH:MM (24h).
 * - Unknown keys are rejected (prevents typos silently landing in history).
 *
 * Throws BadRequestException (HTTP 422 semantics) on any violation.
 */
export function validateContext(
  schemaJson: unknown,
  contextJson: unknown,
): Record<string, unknown> | null {
  const schema = parseSchema(schemaJson);
  const ctx = parseContext(contextJson);

  if (!schema) {
    if (ctx !== null && Object.keys(ctx).length > 0) {
      throw new BadRequestException(
        'Action does not accept context fields, but contextJson was provided.',
      );
    }
    return null;
  }

  // Unknown-key check.
  if (ctx) {
    const allowed = new Set(schema.dimensions.map((d) => d.key));
    for (const key of Object.keys(ctx)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(`Unknown context key: "${key}".`);
      }
    }
  }

  const out: Record<string, unknown> = {};

  for (const dim of schema.dimensions) {
    const raw = ctx ? ctx[dim.key] : undefined;
    const provided = raw !== undefined && raw !== null && raw !== '';

    if (!provided) {
      if (dim.required) {
        throw new BadRequestException(`Missing required context field: "${dim.key}".`);
      }
      continue;
    }

    switch (dim.type) {
      case 'select': {
        if (typeof raw !== 'string') {
          throw new BadRequestException(`Context "${dim.key}" must be a string.`);
        }
        const opt = (dim.options ?? []).find((o) => o.value === raw);
        if (!opt) {
          throw new BadRequestException(
            `Context "${dim.key}" has invalid value "${raw}". Allowed: ${(dim.options ?? [])
              .map((o) => o.value)
              .join(', ')}.`,
          );
        }
        if (opt.deprecated) {
          throw new BadRequestException(
            `Context "${dim.key}" value "${raw}" is deprecated and may no longer be selected.`,
          );
        }
        out[dim.key] = raw;
        break;
      }
      case 'text': {
        if (typeof raw !== 'string') {
          throw new BadRequestException(`Context "${dim.key}" must be a string.`);
        }
        if (raw.length > 500) {
          throw new BadRequestException(`Context "${dim.key}" exceeds 500 characters.`);
        }
        out[dim.key] = raw;
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        if (!Number.isFinite(n)) {
          throw new BadRequestException(`Context "${dim.key}" must be a number.`);
        }
        if (dim.min !== undefined && n < dim.min) {
          throw new BadRequestException(`Context "${dim.key}" must be ≥ ${dim.min}.`);
        }
        if (dim.max !== undefined && n > dim.max) {
          throw new BadRequestException(`Context "${dim.key}" must be ≤ ${dim.max}.`);
        }
        out[dim.key] = n;
        break;
      }
      case 'time': {
        if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
          throw new BadRequestException(
            `Context "${dim.key}" must be a time in HH:MM format (24h).`,
          );
        }
        out[dim.key] = raw;
        break;
      }
      default:
        throw new BadRequestException(`Unknown dimension type "${(dim as ContextDimension).type}".`);
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function parseSchema(raw: unknown): ContextSchema | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    throw new BadRequestException('contextSchemaJson is malformed (not an object).');
  }
  const dims = (raw as { dimensions?: unknown }).dimensions;
  if (dims === undefined) return null;
  if (!Array.isArray(dims)) {
    throw new BadRequestException('contextSchemaJson.dimensions must be an array.');
  }
  for (const d of dims) {
    if (!d || typeof d !== 'object') {
      throw new BadRequestException('contextSchemaJson.dimensions[] entries must be objects.');
    }
    const dd = d as Record<string, unknown>;
    if (typeof dd.key !== 'string' || !dd.key) {
      throw new BadRequestException('Dimension.key is required.');
    }
    if (typeof dd.type !== 'string') {
      throw new BadRequestException(`Dimension "${dd.key}" missing type.`);
    }
    if (!['select', 'text', 'number', 'time'].includes(dd.type)) {
      throw new BadRequestException(`Dimension "${dd.key}" has invalid type "${dd.type}".`);
    }
  }
  return { dimensions: dims as ContextDimension[] };
}

function parseContext(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('contextJson must be an object.');
  }
  return raw as Record<string, unknown>;
}
