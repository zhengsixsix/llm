/**
 * 样例文件处理服务
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

// 本地默认样例文件路径（src/lib/samples 目录下的文件）
const LOCAL_SAMPLE_DIR = path.join(process.cwd(), 'src', 'lib', 'samples');
const DEFAULT_SAMPLE_FILE = 'samples.xmind';

interface Topic {
  id?: string;
  title?: string;
  children?: {
    attached?: Topic[];
  };
}

interface Sheet {
  rootTopic?: Topic;
  relationships?: Array<{
    end1Id: string;
    end2Id: string;
    title?: string;
  }>;
}

function topicToText(topic: Topic, depth = 0, maxDepth = 4): string {
  if (!topic || depth > maxDepth) return '';
  const indent = '  '.repeat(depth);
  const title = topic.title || '';
  let result = `${indent}- ${title}\n`;

  const attached = topic.children?.attached || [];
  for (const child of attached) {
    result += topicToText(child, depth + 1, maxDepth);
  }
  return result;
}

function collectIdTitles(topic: Topic, map: Record<string, string>): void {
  if (!topic) return;
  if (topic.id && topic.title) map[topic.id] = topic.title;
  const attached = topic.children?.attached || [];
  for (const child of attached) {
    collectIdTitles(child, map);
  }
}

class SampleService {
  /**
   * 读取本地默认样例文件（src/lib/samples/samples.xmind）
   * 如果文件不存在或解析失败，返回空字符串
   */
  async getDefaultSampleContent(): Promise<string> {
    const filePath = path.join(LOCAL_SAMPLE_DIR, DEFAULT_SAMPLE_FILE);
    try {
      const buffer = await fs.readFile(filePath);
      return await this.parseXMindBuffer(buffer, DEFAULT_SAMPLE_FILE);
    } catch (err) {
      console.warn(`[WARN] 读取本地默认样例失败: ${filePath}`, err);
      return '';
    }
  }

  /**
   * 解析上传的 XMind 文件 Buffer，提取为纯文本
   */
  async parseXMindBuffer(buffer: Buffer, filename: string): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);

    let contentText = '';
    if (zip.files['content.json']) {
      contentText = await zip.files['content.json'].async('string');
    } else {
      return '';
    }

    let sheets: Sheet[];
    try {
      sheets = JSON.parse(contentText);
    } catch {
      return '';
    }

    if (!Array.isArray(sheets)) return '';

    let output = `=== 样例：${filename} ===\n`;

    for (const sheet of sheets) {
      const rootTopic = sheet.rootTopic;
      if (!rootTopic) continue;
      output += topicToText(rootTopic, 0, 4);

      if (Array.isArray(sheet.relationships) && sheet.relationships.length > 0) {
        const idToTitle: Record<string, string> = {};
        collectIdTitles(rootTopic, idToTitle);

        output += '\n【样例关联线参考】\n';
        for (const rel of sheet.relationships) {
          const t1 = idToTitle[rel.end1Id] || rel.end1Id;
          const t2 = idToTitle[rel.end2Id] || rel.end2Id;
          const label = rel.title ? `"${rel.title}"` : '（无标注）';
          output += `  ${t1} → ${t2}  标注: ${label}\n`;
        }
      }
    }

    return output.trim();
  }
}

export const sampleService = new SampleService();
