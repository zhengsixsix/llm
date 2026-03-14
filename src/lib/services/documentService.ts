/**
 * 文档读取服务
 */

import mammoth from 'mammoth';
import { SUPPORTED_FILE_TYPES } from '@/lib/constants';
import type { ServiceFile } from '@/types/config';

class DocumentService {
  async readFiles(files: ServiceFile[]): Promise<string> {
    const contents = [];

    for (const file of files) {
      const content = await this.readFile(file.filename, file.content);
      if (content) {
        contents.push(`=== ${file.filename} ===\n${content}\n`);
      }
    }

    return contents.join('\n');
  }

  private async readFile(filename: string, content: Buffer): Promise<string> {
    if (filename.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: content });
      return result.value;
    } else if (filename.toLowerCase().endsWith('.txt') || filename.toLowerCase().endsWith('.md')) {
      return content.toString('utf-8');
    }
    return '';
  }

  isSupportedFile(filename: string): boolean {
    return SUPPORTED_FILE_TYPES.some(ext => filename.toLowerCase().endsWith(ext));
  }
}

export const documentService = new DocumentService();
