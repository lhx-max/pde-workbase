import {describe,it,expect} from 'vitest';
import {initialMarkdownDocument,nextMarkdownDocumentPath} from '../src/state/file-creation';
import {en} from '../src/i18n/locales/en';
import type {ProjectFile} from '@bezier/contracts';
describe('original document creation defaults',()=>{
 it('retains numbered document.md names and case-insensitive collision protection',()=>{const files=[{name:'folder/Document.md'},{name:'folder/document-2.md'}] as ProjectFile[];expect(nextMarkdownDocumentPath(files,'folder')).toBe('folder/document-3.md');expect(nextMarkdownDocumentPath(files,'')).toBe('document.md');});
 it('creates the original localized document template rather than an empty replacement',()=>{const result=initialMarkdownDocument('document-3.md','prototype',key=>en[key]);expect(result).toContain('# Document 3');expect(result).toContain(en['designFiles.documentTemplate.goalHeading']);expect(result).toContain(en['designFiles.documentTemplate.capabilityMarkdown']);expect(result).toContain(en['designFiles.documentTemplate.scenario.prototype']);});
});
