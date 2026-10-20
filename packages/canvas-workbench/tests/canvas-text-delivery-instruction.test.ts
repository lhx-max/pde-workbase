import { expect, it } from 'vitest';
import type { ArtifactTextOptions } from '@bezier/contracts';
import { basicNodeCopy } from '../src/locales/basic-node';
import { overrideCanvasTextDeliveryInstruction } from '../src/platform/canvas-text-delivery-instruction';

const instruction = 'Deliver the complete final text through the host-authorized delivery mechanism.\nRead all attached references first.';
function fixture(locale: 'en' | 'zh-CN', options: ArtifactTextOptions = {}) {
  const preamble = basicNodeCopy(locale).prompts.textGeneration('', '', {}).split('\n\n')[0]!;
  const snapshot = {
    text: `  Existing text\n\n${preamble}\n不要调用工具 / without explanations or tool calls.\n  `,
    prompt: `  Quote these literal words, do not remove them:\n${preamble}\n不要调用工具 / without explanations or tool calls.  `,
    options: { templatePrompt: `A quoted template instruction:\n\n${preamble}\n不要调用工具 / without explanations or tool calls.`, ...options },
    attachments: [{ name: 'Reference', path: 'inputs/reference.txt' }],
  };
  const prompt = basicNodeCopy(locale).prompts.textGeneration(snapshot.prompt.trim(), snapshot.text, snapshot.options);
  return { snapshot, prompt, preamble, source: JSON.stringify(snapshot) };
}

it.each(['en', 'zh-CN'] as const)('overrides only the canonical generated preamble in %s', locale => {
  const { source, prompt, snapshot, preamble } = fixture(locale);
  const actual = overrideCanvasTextDeliveryInstruction(prompt, source, instruction);
  const boundary = prompt.indexOf('\n\n');
  expect(actual).toBe(instruction + prompt.slice(boundary));
  expect(actual.slice(instruction.length)).toBe(prompt.slice(boundary));
  expect(actual).toContain(snapshot.text);
  expect(actual).toContain(snapshot.prompt.trim());
  expect(actual).toContain(snapshot.options.templatePrompt);
  // The three user/template copies survive; only the generated first copy changes.
  expect(actual.split(preamble)).toHaveLength(4);
});

it.each(['en', 'zh-CN'] as const)('recognizes every canonical length and empty optional content in %s', locale => {
  for (const length of [undefined, 'auto', 'short', 'medium', 'long'] as const) {
    const snapshot = { text: '', prompt: '  Generate this  ', options: { length }, attachments: [] };
    const prompt = basicNodeCopy(locale).prompts.textGeneration(snapshot.prompt.trim(), snapshot.text, snapshot.options);
    expect(overrideCanvasTextDeliveryInstruction(prompt, JSON.stringify(snapshot), instruction)).toBe(instruction + prompt.slice(prompt.indexOf('\n\n')));
  }
});

it.each(['en', 'zh-CN'] as const)('leaves custom, augmented, or edited prompts unchanged in %s', locale => {
  const { prompt, source, preamble } = fixture(locale);
  for (const custom of [`Custom request:\n${prompt}`, `${prompt}\nExtra host content`, prompt.replace('\n\n', '\n'), `${preamble}\n\nArbitrary user-authored body`, prompt + ' ']) {
    expect(overrideCanvasTextDeliveryInstruction(custom, source, instruction)).toBe(custom);
  }
});

it.each(['en', 'zh-CN'] as const)('leaves mismatched snapshots and already-overridden prompts unchanged in %s', locale => {
  const { prompt, snapshot, source } = fixture(locale);
  for (const changed of [{ ...snapshot, text: snapshot.text + 'changed' }, { ...snapshot, prompt: 'different request' }, { ...snapshot, options: { ...snapshot.options, length: 'long' } }]) {
    expect(overrideCanvasTextDeliveryInstruction(prompt, JSON.stringify(changed), instruction)).toBe(prompt);
  }
  const overridden = overrideCanvasTextDeliveryInstruction(prompt, source, instruction);
  expect(overrideCanvasTextDeliveryInstruction(overridden, source, 'Another instruction')).toBe(overridden);
});

it('does not accept invalid option values just because the renderer would coerce them to the same template', () => {
  const prompt = basicNodeCopy('en').prompts.textGeneration('Request', '', {});
  for (const options of [undefined, null, [], false, 0, { length: 'unknown' }, { length: null }, { templatePrompt: null }, { templatePrompt: false }, { templatePrompt: 0 }, { templateId: null }, { templateTitle: 42 }]) {
    const source = JSON.stringify({ text: '', prompt: 'Request', options, attachments: [] });
    expect(overrideCanvasTextDeliveryInstruction(prompt, source, instruction)).toBe(prompt);
  }
});

it('returns the original prompt for malformed snapshots without coercing values', () => {
  const { prompt, snapshot } = fixture('en');
  const invalid = [undefined, '', '{invalid JSON', 'null', '[]', 'true', '"snapshot"', ...[
    {}, { ...snapshot, text: 123 }, { ...snapshot, prompt: null },
    { ...snapshot, options: null }, { ...snapshot, options: [] }, { ...snapshot, options: 'short' },
    { ...snapshot, options: { length: null } }, { ...snapshot, options: { length: 'unrecognized' } },
    { ...snapshot, options: { templatePrompt: 123 } }, { ...snapshot, options: { templatePrompt: null } },
  ].map(value => JSON.stringify(value))];
  for (const source of invalid) expect(overrideCanvasTextDeliveryInstruction(prompt, source, instruction)).toBe(prompt);
});
