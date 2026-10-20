import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  materializeCanvasArtifactResponse,
  prepareCanvasArtifactWorkspace,
  type CanvasArtifactWorkspace,
} from '../src/canvas/artifact-workspace.js';

const html = '<!doctype html><html><body><main>candidate</main></body></html>';
const secondHtml = '<html><body><main>another candidate</main></body></html>';
const artifact = (content: string, identifier = 'reply-name') => `<artifact type="text/html" identifier="${identifier}">${content}</artifact>`;
const fence = (content: string) => `\`\`\`html\n${content}\n\`\`\``;

describe('canvas HTML stdout materialization', () => {
  let root: string;
  let project: string;
  let workspace: CanvasArtifactWorkspace;
  let target: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'da-artifact-response-'));
    project = path.join(root, 'project');
    mkdirSync(project);
    writeFileSync(path.join(project, 'original.html'), 'original project bytes');
    workspace = prepareCanvasArtifactWorkspace({
      runtimeDataDir: path.join(root, 'runtime'), projectRoot: project,
      runId: 'response-run', outputPath: 'results/bound-candidate.html', references: ['original.html'],
    });
    target = path.join(workspace.cwd, workspace.outputPath);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function expectNoMaterialization() {
    expect(existsSync(target)).toBe(false);
    expect(existsSync(path.dirname(target))).toBe(false);
    expect(existsSync(path.join(project, workspace.outputPath))).toBe(false);
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe('original project bytes');
  }

  it.each([
    ['artifact', artifact(html)],
    ['fenced HTML', `Here is the result:\n\n${fence(html)}\n\nDone.`],
    ['raw HTML', html],
  ])('materializes one complete %s response only inside the bound workspace', (_format, response) => {
    materializeCanvasArtifactResponse(workspace, response!);
    expect(readFileSync(target, 'utf8')).toBe(html);
    expect(existsSync(path.join(project, workspace.outputPath))).toBe(false);
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe('original project bytes');
  });

  it.each(['artifact', 'fence', 'raw'])('does not count HTML in script/template/comment/srcdoc as another %s document', format => {
    const embedded = '<!doctype html><html><body>'
      + '<!-- <html><body>comment example</body></html> -->'
      + '<script>const template = `<html><body>script string</body></html>`;</script>'
      + '<template><html><body>template content</body></html></template>'
      + '<iframe srcdoc="<html><body>embedded document</body></html>"></iframe>'
      + '</body></html>';
    materializeCanvasArtifactResponse(workspace, format === 'artifact' ? artifact(embedded) : format === 'fence' ? fence(embedded) : embedded);
    expect(readFileSync(target, 'utf8')).toBe(embedded);
  });

  it('does not strip artifact-looking literals or template children out of a raw HTML document', () => {
    const document = `<html><body><script>const sample = ${JSON.stringify(artifact(secondHtml))};</script>`
      + `<template>${artifact(secondHtml)}</template></body></html>`;
    materializeCanvasArtifactResponse(workspace, document);
    expect(readFileSync(target, 'utf8')).toBe(document);
  });

  it('does not extract a Markdown HTML fence embedded in a raw document script string', () => {
    const document = `<html><body><script>const sample = \`\n${fence(secondHtml)}\n\`;</script></body></html>`;
    materializeCanvasArtifactResponse(workspace, document);
    expect(readFileSync(target, 'utf8')).toBe(document);
  });

  it('uses the declared output path rather than the response identifier or filename', () => {
    const response = `<artifact type="text/html" identifier="../../original" filename="${path.join(project, 'original.html')}">${html}</artifact>`;
    materializeCanvasArtifactResponse(workspace, response);
    expect(readFileSync(target, 'utf8')).toBe(html);
    expect(readFileSync(path.join(workspace.cwd, 'original.html'), 'utf8')).toBe('original project bytes');
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe('original project bytes');
    expect(existsSync(path.join(project, workspace.outputPath))).toBe(false);
  });

  it.each([
    ['two artifacts', `${artifact(html, 'first')}\n${artifact(secondHtml, 'second')}`],
    ['two HTML fences', `${fence(html)}\n\n${fence(secondHtml)}`],
    ['artifact and HTML fence', `${artifact(html)}\n\n${fence(secondHtml)}`],
    ['artifact and raw HTML', `${artifact(html)}\n\n${secondHtml}`],
    ['raw HTML and artifact', `${html}\n\n${artifact(secondHtml)}`],
    ['HTML fence and raw HTML', `${fence(html)}\n\n${secondHtml}`],
    ['raw HTML and HTML fence', `${html}\n\n${fence(secondHtml)}`],
    ['two raw HTML documents', `${html}\n${secondHtml}`],
    ['two documents inside one artifact', artifact(`${html}\n${secondHtml}`)],
    ['two documents inside one fence', fence(`${html}\n${secondHtml}`)],
  ])('rejects ambiguous %s instead of selecting or merging candidates', (_format, response) => {
    expect(() => materializeCanvasArtifactResponse(workspace, response!)).toThrow();
    expectNoMaterialization();
  });

  it.each([
    ['unfinished artifact HTML', artifact('<html><body><main>unfinished')],
    ['unfinished fenced HTML', fence('<html><body><main>unfinished')],
    ['unfinished raw HTML', '<!doctype html><html><body>unfinished'],
    ['HTML fragment only', fence('<main>fragment</main>')],
    ['plain explanation', 'The design is complete; no HTML is attached.'],
    ['empty response', ''],
  ])('rejects %s without creating a partial file or output directory', (_format, response) => {
    expect(() => materializeCanvasArtifactResponse(workspace, response!)).toThrow();
    expectNoMaterialization();
  });

  it.each([
    ['replacement HTML', artifact(secondHtml)],
    ['ambiguous stdout', `${artifact(html, 'first')}\n${artifact(secondHtml, 'second')}`],
    ['overflow sentinel', null],
  ])('preserves an existing runtime-written candidate despite %s', (_kind, response) => {
    mkdirSync(path.dirname(target), { recursive: true });
    const runtimeWritten = '<html><body>runtime file is authoritative</body></html>';
    writeFileSync(target, runtimeWritten);
    expect(() => materializeCanvasArtifactResponse(workspace, response)).not.toThrow();
    expect(readFileSync(target, 'utf8')).toBe(runtimeWritten);
    expect(existsSync(path.join(project, workspace.outputPath))).toBe(false);
  });

  it('rejects the overflow/null sentinel when no runtime-written file exists', () => {
    expect(() => materializeCanvasArtifactResponse(workspace, null)).toThrow(/20 MB/);
    expectNoMaterialization();
  });

  it('enforces the 20 MiB limit on UTF-8 bytes, not character count', () => {
    const limit = 20 * 1024 * 1024;
    const response = `<html><body>${'界'.repeat(Math.floor(limit / 3))}</body></html>`;
    expect(response.length).toBeLessThan(limit);
    expect(Buffer.byteLength(response, 'utf8')).toBeGreaterThan(limit);
    expect(() => materializeCanvasArtifactResponse(workspace, response)).toThrow(/20 MB/);
    expectNoMaterialization();
  });
});
