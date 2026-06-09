import type { z } from 'zod';
import type { ToolSpec } from '../ai/providers/types';
import type { Tool } from './types';

// Minimal zod → JSON Schema for the subset our tools actually use (object, string,
// number, boolean, with optional/default/nullable wrappers — see the tools/ folder).
// We hand-roll it instead of pulling in `zod-to-json-schema` (one more dep in the
// Electron main bundle) because the surface is this small. Anything unrecognised
// degrades to a permissive `{}` so OpenAI still accepts the tool, just unconstrained.

// zod v3 stamps the kind on `_def.typeName` (e.g. 'ZodString', 'ZodOptional').
type ZDef = { typeName?: string; innerType?: z.ZodTypeAny; type?: z.ZodTypeAny; values?: readonly string[] };
const defOf = (s: z.ZodTypeAny): ZDef => (s as unknown as { _def: ZDef })._def;

const WRAPPERS = new Set(['ZodOptional', 'ZodDefault', 'ZodNullable']);

/** Peel optional/default/nullable wrappers to reach the underlying type. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  let d = defOf(s);
  while (d.typeName && WRAPPERS.has(d.typeName) && d.innerType) {
    s = d.innerType;
    d = defOf(s);
  }
  return s;
}

/** A field is omittable from `required` if its outermost wrapper is optional/default. */
function isOptional(schema: z.ZodTypeAny): boolean {
  const tn = defOf(schema).typeName;
  return tn === 'ZodOptional' || tn === 'ZodDefault';
}

function leafSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const s = unwrap(schema);
  const d = defOf(s);
  switch (d.typeName) {
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'string', enum: [...(d.values ?? [])] };
    case 'ZodArray': return { type: 'array', items: d.type ? leafSchema(d.type) : {} };
    case 'ZodObject': return objectSchema(s);
    default: return {}; // unknown → unconstrained, still valid JSON Schema
  }
}

/** Convert a `z.object({...})` schema into a JSON Schema object node. */
export function objectSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape) return { type: 'object', properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    properties[key] = leafSchema(field);
    if (!isOptional(field)) required.push(key);
  }
  return required.length
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

/** Build the OpenAI-style tool specs from the registry's tools. */
export function buildToolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: objectSchema(t.schema as unknown as z.ZodTypeAny),
  }));
}
