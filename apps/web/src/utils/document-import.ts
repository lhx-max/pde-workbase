/**
 * OS document import — converts a dropped File into markdown text.
 *
 * md/markdown/txt pass through as-is. .docx goes through mammoth (docx→html)
 * + turndown (html→markdown), loaded lazily so the canvas bundle only pays
 * the cost when a Word file is actually dropped. Legacy .doc is a binary
 * format no browser converter handles — it reports unsupported honestly.
 */
export async function documentFileToMarkdown(file: File): Promise<string> {
  if (/\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const [mammothModule, TurndownService] = await Promise.all([
      import('mammoth/mammoth.browser'),
      import('turndown'),
    ]);
    const buffer = await file.arrayBuffer();
    const { value: html } = await mammothModule.default.convertToHtml({ arrayBuffer: buffer });
    const service = new TurndownService.default({ headingStyle: 'atx', bulletListMarker: '-' });
    service.keep?.(['sub', 'sup']);
    const markdown = service.turndown(html ?? '');
    if (!markdown.trim()) throw new Error('Word 文档内容为空或无法识别');
    return markdown;
  }
  if (/\.(md|markdown|txt)$/i.test(file.name) || /^text\//i.test(file.type)) {
    return file.text();
  }
  throw new Error(`不支持导入「${file.name}」：目前支持 .md / .txt / .docx`);
}

export function documentDropTitle(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt|docx)$/i, '') || fileName;
}
