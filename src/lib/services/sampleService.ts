/**
 * 样例文件处理服务
 */

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

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

async function parseXMindFile(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  let contentText = '';
  if (zip.files['content.json']) {
    contentText = await zip.files['content.json'].async('string');
  } else {
    return '（无法解析该 xmind 文件）';
  }

  let sheets: Sheet[];
  try {
    sheets = JSON.parse(contentText);
  } catch {
    return '（content.json 解析失败）';
  }

  if (!Array.isArray(sheets)) return '（格式不符）';

  const fileName = path.basename(filePath, '.xmind');
  let output = `=== 样例：${fileName} ===\n`;

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

class SampleService {
  async readSamples(sampleDir = './sample'): Promise<string> {
    if (!fs.existsSync(sampleDir)) {
      console.warn(`[WARN] 样例目录不存在: ${sampleDir}`);
      return '';
    }

    const files = fs.readdirSync(sampleDir).filter(f => f.endsWith('.xmind'));
    if (files.length === 0) {
      console.warn('[WARN] sample 目录下没有找到 .xmind 文件');
      return '';
    }

    console.log(`[INFO] 发现 ${files.length} 个样例文件`);

    const results = [];
    for (const file of files) {
      const fullPath = path.join(sampleDir, file);
      try {
        const text = await parseXMindFile(fullPath);
        results.push(text);
        console.log(`[SUCCESS] 样例解析完成: ${file}`);
      } catch (e) {
        console.warn(`[WARN] 样例解析失败 (${file})`);
      }
    }

    return results.join('\n\n');
  }

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
    }

    return output.trim();
  }
}

export const sampleService = new SampleService();
