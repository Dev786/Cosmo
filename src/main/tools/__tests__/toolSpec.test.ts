import { z } from 'zod';
import { objectSchema, buildToolSpecs } from '../toolSpec';
import type { Tool } from '../types';

describe('objectSchema — zod → JSON Schema', () => {
  it('maps primitives and marks only non-optional fields required', () => {
    const schema = z.object({
      query: z.string(),
      count: z.number().int().positive().optional(),
      loud: z.boolean().default(false),
    });
    expect(objectSchema(schema)).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number' },
        loud: { type: 'boolean' },
      },
      required: ['query'],   // optional + default fields drop out of required
    });
  });

  it('omits `required` entirely when every field is optional', () => {
    const schema = z.object({ a: z.string().optional(), b: z.number().optional() });
    expect(objectSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    });
  });

  it('handles an empty object', () => {
    expect(objectSchema(z.object({}))).toEqual({ type: 'object', properties: {} });
  });

  it('descends into nested objects, enums and arrays', () => {
    const schema = z.object({
      mode: z.enum(['fast', 'slow']),
      tags: z.array(z.string()),
      nested: z.object({ x: z.number() }),
    });
    expect(objectSchema(schema)).toEqual({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'] },
        tags: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
      },
      required: ['mode', 'tags', 'nested'],
    });
  });

  it('peels default/nullable wrappers to the underlying type', () => {
    const schema = z.object({ n: z.number().nullable(), s: z.string().default('hi') });
    const out = objectSchema(schema) as { properties: Record<string, unknown>; required?: string[] };
    expect(out.properties.n).toEqual({ type: 'number' });
    expect(out.properties.s).toEqual({ type: 'string' });
    // nullable is still "present" (required); default makes it optional.
    expect(out.required).toEqual(['n']);
  });
});

describe('buildToolSpecs', () => {
  it('produces one OpenAI tool spec per tool', () => {
    const tools = [{
      name: 'search.web',
      description: 'Search the web',
      schema: z.object({ query: z.string() }),
      availableOffline: false,
      execute: async () => ({ ok: true as const, summary: 'ok' }),
    }] as unknown as Tool[];

    expect(buildToolSpecs(tools)).toEqual([{
      name: 'search.web',
      description: 'Search the web',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }]);
  });
});
