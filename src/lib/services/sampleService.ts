import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import type { SampleDocument, SampleNode, SampleNodeRole } from '@/types/style';

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

interface ParsedSheet {
  nodes: SampleNode[];
  renderedText: string;
  relationshipExamples: string[];
}

class SampleService {
  async getDefaultSampleContent(): Promise<string> {
    const sample = await this.getDefaultSampleDocument();
    return sample?.renderedText || '';
  }

  async getDefaultSampleDocument(): Promise<SampleDocument | null> {
    const filePath = path.join(LOCAL_SAMPLE_DIR, DEFAULT_SAMPLE_FILE);
    try {
      const buffer = await fs.readFile(filePath);
      return await this.parseXMindBufferDetailed(buffer, DEFAULT_SAMPLE_FILE);
    } catch (error) {
      console.warn(`[WARN] Failed to read default sample: ${filePath}`, error);
      return null;
    }
  }

  async parseXMindBuffer(buffer: Buffer, filename: string): Promise<string> {
    const sample = await this.parseXMindBufferDetailed(buffer, filename);
    return sample?.renderedText || '';
  }

  async parseXMindBufferDetailed(buffer: Buffer, filename: string): Promise<SampleDocument | null> {
    const zip = await JSZip.loadAsync(buffer);
    const contentFile = zip.files['content.json'];
    if (!contentFile) return null;

    let sheets: Sheet[];
    try {
      const contentText = await contentFile.async('string');
      sheets = JSON.parse(contentText);
    } catch {
      return null;
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return null;
    }

    const rootNodes: SampleNode[] = [];
    const renderedParts: string[] = [`=== 样例：${filename} ===`];
    const contentExamples: string[] = [];
    const explanationExamples: string[] = [];
    const summaryExamples: string[] = [];
    const referenceExamples: string[] = [];
    const relationshipExamples: string[] = [];
    let rootTitle = '';

    for (const sheet of sheets) {
      if (!sheet.rootTopic) continue;
      if (!rootTitle) {
        rootTitle = sheet.rootTopic.title || '样例';
      }

      const parsed = this.parseSheet(sheet);
      rootNodes.push(...parsed.nodes);
      if (parsed.renderedText) {
        renderedParts.push(parsed.renderedText);
      }
      relationshipExamples.push(...parsed.relationshipExamples);
      this.collectExamples(parsed.nodes, {
        contentExamples,
        explanationExamples,
        summaryExamples,
        referenceExamples,
      });
    }

    return {
      filename,
      rootTitle: rootTitle || '样例',
      nodes: rootNodes,
      renderedText: renderedParts.join('\n').trim(),
      contentExamples: this.uniqueKeepOrder(contentExamples).slice(0, 12),
      explanationExamples: this.uniqueKeepOrder(explanationExamples).slice(0, 12),
      summaryExamples: this.uniqueKeepOrder(summaryExamples).slice(0, 8),
      referenceExamples: this.uniqueKeepOrder(referenceExamples).slice(0, 8),
      relationshipExamples: this.uniqueKeepOrder(relationshipExamples).slice(0, 12),
    };
  }

  private parseSheet(sheet: Sheet): ParsedSheet {
    const rootTopic = sheet.rootTopic;
    if (!rootTopic) {
      return { nodes: [], renderedText: '', relationshipExamples: [] };
    }

    const rootNode = this.convertTopic(rootTopic, 0, 'root');
    const renderedText = this.renderNode(rootNode).trim();
    const relationshipExamples = this.renderRelationships(sheet, rootTopic);

    return {
      nodes: rootNode.children,
      renderedText,
      relationshipExamples,
    };
  }

  private convertTopic(topic: Topic, depth: number, parentRole: SampleNodeRole): SampleNode {
    const title = (topic.title || '').trim();
    const role = this.inferRole(title, depth, parentRole);
    const children = (topic.children?.attached || []).map((child) => this.convertTopic(child, depth + 1, role));

    return {
      title,
      depth,
      role,
      children,
    };
  }

  private inferRole(title: string, depth: number, parentRole: SampleNodeRole): SampleNodeRole {
    if (!title) return 'empty';
    if (/^https?:\/\//i.test(title)) return 'reference';
    if (depth === 0) return 'root';
    if (depth === 1) return 'board';
    if (/^板块总结[:：]/.test(title) || /总结/.test(title)) return 'summary';

    if (depth >= 3) {
      if (this.looksLikeExplanation(title, parentRole)) return 'explanation';
      return parentRole === 'content' || parentRole === 'explanation' ? 'explanation' : 'content';
    }

    return 'content';
  }

  private looksLikeExplanation(title: string, parentRole: SampleNodeRole): boolean {
    if (parentRole === 'content' || parentRole === 'explanation') return true;
    return /姐姐|这里|前文|铺垫|贴合|说明|后文|顺便|我看了看|我就|我们/.test(title);
  }

  private renderNode(node: SampleNode): string {
    const lines: string[] = [];
    const walk = (current: SampleNode) => {
      if (current.role !== 'empty') {
        lines.push(`${'  '.repeat(current.depth)}- ${current.title}`);
      }
      current.children.forEach(walk);
    };
    walk(node);
    return lines.join('\n');
  }

  private renderRelationships(sheet: Sheet, rootTopic: Topic): string[] {
    if (!Array.isArray(sheet.relationships) || sheet.relationships.length === 0) {
      return [];
    }

    const idToTitle: Record<string, string> = {};
    this.collectIdTitles(rootTopic, idToTitle);

    return sheet.relationships.map((relationship) => {
      const left = idToTitle[relationship.end1Id] || relationship.end1Id;
      const right = idToTitle[relationship.end2Id] || relationship.end2Id;
      const label = relationship.title ? `，标注：${relationship.title}` : '';
      return `${left} -> ${right}${label}`;
    });
  }

  private collectExamples(
    nodes: SampleNode[],
    buckets: {
      contentExamples: string[];
      explanationExamples: string[];
      summaryExamples: string[];
      referenceExamples: string[];
    },
  ): void {
    const walk = (node: SampleNode) => {
      if (node.title) {
        if (node.role === 'content') buckets.contentExamples.push(node.title);
        if (node.role === 'explanation') buckets.explanationExamples.push(node.title);
        if (node.role === 'summary') buckets.summaryExamples.push(node.title);
        if (node.role === 'reference') buckets.referenceExamples.push(node.title);
      }
      node.children.forEach(walk);
    };
    nodes.forEach(walk);
  }

  private collectIdTitles(topic: Topic, target: Record<string, string>): void {
    if (!topic) return;
    if (topic.id && topic.title) {
      target[topic.id] = topic.title;
    }
    (topic.children?.attached || []).forEach((child) => this.collectIdTitles(child, target));
  }

  private uniqueKeepOrder(items: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }
}

export const sampleService = new SampleService();
