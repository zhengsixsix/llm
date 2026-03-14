/**
 * XMind 处理服务
 */

import { Workbook, RootTopic, Topic, Relationship, Summary } from 'xmind-generator';
import { writeFile } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import os from 'os';
import type { MindMapData, MindMapNode } from '@/types/mindmap';
import { imageSearchService } from './imageSearchService';

class XMindService {
  private titleToRefMap: Record<string, string> = {};

  async generateXMind(structure: MindMapData, outputPath: string): Promise<void> {
    const rootTitle = structure.rootTitle || '申请文书思维导图';
    const relationships = structure.relationships || [];

    console.log(`[INFO] 检测到 ${relationships.length} 条关联线待处理`);

    this.titleToRefMap = {};
    const rootChildren = await this.buildStructure(structure.structure || []);

    const workbook = Workbook(
      RootTopic(rootTitle)
        .children(rootChildren as any)
        .relationships(this.buildRelationships(relationships) as any)
    );

    const absPath = path.resolve(outputPath);
    const outputDir = path.dirname(absPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const buffer = await workbook.archive();
    if (!buffer || !(buffer instanceof ArrayBuffer)) {
      throw new Error('XMind 生成失败: archive() 未返回有效数据');
    }
    await writeFile(absPath, Buffer.from(buffer));

    console.log(`[SUCCESS] XMind 文件已生成: ${absPath}`);
  }

  private async buildStructure(structureData: MindMapNode[]): Promise<any[]> {
    if (!Array.isArray(structureData)) return [];

    const children = [];

    for (const section of structureData) {
      if (!section || !section.title) continue;

      const sectionRef = this.generateRef(section.title);
      this.titleToRefMap[section.title] = sectionRef;
      const sectionTopic = Topic(section.title).ref(sectionRef);

      if (Array.isArray(section.children) && section.children.length > 0) {
        const result = await this.buildChildrenWithSummary(section.children);
        if (result.children && result.children.length > 0) {
          sectionTopic.children(result.children as any);
          if (result.summaryBuilders && result.summaryBuilders.length > 0) {
            sectionTopic.summaries(result.summaryBuilders as any);
          }
        }
        children.push(sectionTopic);
      } else {
        children.push(sectionTopic);
      }
    }

    return children;
  }

  private async buildChildrenWithSummary(nodes: MindMapNode[]): Promise<{ children: any[], summaryBuilders: any[] }> {
    if (!Array.isArray(nodes)) return { children: [], summaryBuilders: [] };

    let summaryNode = null;
    const normalChildren = [];

    for (const node of nodes) {
      if (this.isSummaryNode(node)) {
        summaryNode = node;
      } else {
        normalChildren.push(node);
      }
    }

    const builtChildren = await this.buildChildrenRecursive(normalChildren);

    const summaryBuilders = [];
    if (summaryNode && builtChildren.length > 0) {
      const parsed = this.parseSummaryNode(summaryNode);
      const summaryBuilder = Summary(parsed.title, { from: 0, to: builtChildren.length - 1 });
      summaryBuilders.push(summaryBuilder);
    }

    return { children: builtChildren, summaryBuilders };
  }

  private isSummaryNode(node: MindMapNode): boolean {
    if (!node || typeof node.title !== 'string') return false;
    const t = node.title.trim();
    return (
      /^板块总结\s*[:：]/.test(t) ||
      /收口/.test(t) ||
      /概览/.test(t) ||
      /【.*总结】/.test(t) ||
      /总结\s*[:：]/.test(t) ||
      (t.length > 0 && (t.endsWith('总结') || t.endsWith('收口')))
    );
  }

  private parseSummaryNode(node: MindMapNode): { title: string, sources: string[] } {
    const fullTitle = node.title || '';
    const match = fullTitle.match(/^板块总结\s*[:：]\s*([\s\S]+)$/);
    const title = match ? match[1].trim() : (fullTitle.trim() || '概览');
    return { title, sources: [] };
  }

  private async buildChildrenRecursive(nodes: MindMapNode[]): Promise<any[]> {
    if (!Array.isArray(nodes)) return [];

    const children = [];

    for (const node of nodes) {
      if (!node) continue;

      const hasImage = !!node.imageKeyword;
      const isImageOnlyNode = !node.title && hasImage;

      if (isImageOnlyNode) {
        const imageTitle = `[图片: ${node.imageKeyword}]`;
        const imageRef = this.generateRef(imageTitle);
        this.titleToRefMap[imageTitle] = imageRef;
        const imageTopic = Topic(imageTitle).ref(imageRef);
        await this.attachImage(imageTopic, node.imageKeyword);

        if (Array.isArray(node.children) && node.children.length > 0) {
          const result = await this.buildChildrenWithSummary(node.children);
          if (result.children && result.children.length > 0) {
            imageTopic.children(result.children as any);
            if (result.summaryBuilders && result.summaryBuilders.length > 0) imageTopic.summaries(result.summaryBuilders as any);
          }
        }
        children.push(imageTopic);
      } else if (hasImage) {
        const topicRef = this.generateRef(node.title);
        this.titleToRefMap[node.title] = topicRef;
        const topic = Topic(node.title).ref(topicRef);
        await this.attachImage(topic, node.imageKeyword);

        if (Array.isArray(node.children) && node.children.length > 0) {
          const result = await this.buildChildrenWithSummary(node.children);
          if (result.children && result.children.length > 0) {
            topic.children(result.children as any);
            if (result.summaryBuilders && result.summaryBuilders.length > 0) topic.summaries(result.summaryBuilders as any);
          }
        }
        children.push(topic);
      } else {
        const topicRef = this.generateRef(node.title);
        this.titleToRefMap[node.title] = topicRef;
        const topic = Topic(node.title).ref(topicRef);

        if (Array.isArray(node.children) && node.children.length > 0) {
          const result = await this.buildChildrenWithSummary(node.children);
          if (result.children && result.children.length > 0) {
            topic.children(result.children as any);
            if (result.summaryBuilders && result.summaryBuilders.length > 0) topic.summaries(result.summaryBuilders as any);
          }
        }
        children.push(topic);
      }
    }

    return children;
  }

  private buildRelationships(relationships: any[]): any[] {
    if (!Array.isArray(relationships) || relationships.length === 0) {
      return [];
    }

    const rels = relationships.map(rel => {
      const r = rel as { end1Title?: string; end2Title?: string; title?: string };
      const fromRef = r.end1Title ? this.titleToRefMap[r.end1Title] : null;
      const toRef = r.end2Title ? this.titleToRefMap[r.end2Title] : null;

      if (fromRef && toRef) {
        return Relationship(r.title || '', { from: fromRef, to: toRef });
      } else {
        console.warn(`[WARN] 关联线节点未找到: end1=${r.end1Title}, end2=${r.end2Title}`);
        return null;
      }
    }).filter(Boolean);

    return rels;
  }

  private generateRef(title: string): string {
    const hash = title.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    const positiveHash = Math.abs(hash).toString(36);
    return `topic:${positiveHash}`;
  }

  private async attachImage(topic: any, keyword: string): Promise<void> {
    try {
      console.log(`[INFO] 搜索图片: ${keyword}`);
      const imageUrl = await imageSearchService.searchImage(keyword);
      if (!imageUrl) {
        console.warn(`[WARN] 未找到图片: ${keyword}`);
        return;
      }

      const ext = this.getExtFromUrl(imageUrl);
      const tmpPath = path.join(os.tmpdir(), `xmind_img_${Date.now()}.${ext}`);
      await this.downloadFile(imageUrl, tmpPath);

      const imgBuffer = fs.readFileSync(tmpPath);
      topic.image({ data: imgBuffer, name: `image.${ext}` });

      fs.unlinkSync(tmpPath);
      console.log(`[SUCCESS] 图片嵌入成功: ${keyword}`);
    } catch (e) {
      console.warn(`[WARN] 图片嵌入失败 (${keyword})`);
    }
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      proto.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          this.downloadFile(res.headers.location!, destPath).then(resolve).catch(reject);
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  private getExtFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() || 'jpg';
      return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    } catch {
      return 'jpg';
    }
  }
}

export const xmindService = new XMindService();
