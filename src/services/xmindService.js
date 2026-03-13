const { Workbook, RootTopic, Topic, Relationship, Summary } = require('xmind-generator');
const { writeFile } = require('fs').promises;
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const imageSearchService = require('./imageSearchService');

/**
 * XMind 处理服务
 *
 * 使用 xmind-generator 官方库，支持：
 * - 链式 API 构建思维导图
 * - .relationships() 添加关联线
 * - .summaries() 添加概览/总结
 * - .ref() 设置节点 ID
 */
class XMindService {
  constructor() {
    // 用于存储所有节点的 title -> ref 映射，供关联线和 summary 使用
    this._titleToRefMap = {};
  }

  /**
   * 根据结构化数据生成 XMind 文件
   * @param {Object} structure - 思维导图结构数据
   * @param {string} outputPath - 输出文件路径
   */
  async generateXMind(structure, outputPath) {
    const rootTitle = structure.rootTitle || '申请文书思维导图';
    const relationships = structure.relationships || [];

    if (relationships.length > 0) {
      console.log(`[INFO] 检测到 ${relationships.length} 条关联线待处理`);
    }

    // 先构建结构（含图片下载与挂载），获取 title -> ref 映射
    this._titleToRefMap = {};
    const rootChildren = await this._buildStructure(structure.structure || []);

    // 使用 xmind-generator 的链式 API
    const workbook = Workbook(
      RootTopic(rootTitle)
        .children(rootChildren)
        .relationships(this._buildRelationships(relationships))
    );

    // 写入文件 - 使用 save 方法
    const absPath = path.resolve(outputPath);
    const outputDir = path.dirname(absPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 自行 archive 并写入，确保 buffer 有效且写入完成
    const buffer = await workbook.archive();
    if (!buffer || !(buffer instanceof ArrayBuffer)) {
      throw new Error('XMind 生成失败: archive() 未返回有效数据');
    }
    await writeFile(absPath, Buffer.from(buffer));

    console.log(`[SUCCESS] XMind 文件已生成: ${absPath}`);
  }

  /**
   * 构建思维导图结构（异步，以便挂载图片）
   * 返回子节点数组
   */
  async _buildStructure(structureData) {
    if (!Array.isArray(structureData)) return [];

    const children = [];

    for (const section of structureData) {
      if (!section || !section.title) continue;

      const sectionRef = this._generateRef(section.title);
      this._titleToRefMap[section.title] = sectionRef;
      const sectionTopic = Topic(section.title).ref(sectionRef);

      if (Array.isArray(section.children) && section.children.length > 0) {
        const { children: sectionChildren, summaryBuilders } = await this._buildChildrenWithSummary(section.children);
        if (sectionChildren && sectionChildren.length > 0) {
          sectionTopic.children(sectionChildren);
          if (summaryBuilders && summaryBuilders.length > 0) {
            sectionTopic.summaries(summaryBuilders);
          }
        }
        children.push(sectionTopic);
      } else {
        children.push(sectionTopic);
      }
    }

    return children;
  }

  /**
   * 递归构建子节点，同时处理「板块总结/收口」：作为 Summary（概要）显示在子节点末尾
   * xmind-generator 的 summaries() 需要：Summary(title, { from: startIndex, to: endIndex })
   * 返回 { children, summaryBuilders }
   */
  async _buildChildrenWithSummary(nodes) {
    if (!Array.isArray(nodes)) return { children: [], summaryBuilders: [] };

    // 找出总结节点（板块总结：xxx 或 含「收口」）
    let summaryNode = null;
    const normalChildren = [];

    for (const node of nodes) {
      if (this._isSummaryNode(node)) {
        summaryNode = node;
      } else {
        normalChildren.push(node);
      }
    }

    // 只构建普通子节点
    const builtChildren = await this._buildChildrenRecursive(normalChildren);

    // 用 Summary() 创建概要（不是子节点！）
    const summaryBuilders = [];
    if (summaryNode && builtChildren.length > 0) {
      const { title: summaryTitle, sources } = this._parseSummaryNode(summaryNode);
      const displayTitle = summaryTitle + (sources.length > 0 ? `\n来源：\n${sources.map(s => `- ${s}`).join('\n')}` : '');

      // Summary 覆盖的子节点范围：0 到最后一个子节点
      const fromIndex = 0;
      const toIndex = builtChildren.length - 1;

      // 用 Summary() 创建概要 builder（from/to 用数字索引）
      const summaryBuilder = Summary(displayTitle, { from: fromIndex, to: toIndex });
      summaryBuilders.push(summaryBuilder);
    }

    return { children: builtChildren, summaryBuilders };
  }

  /**
   * 判断是否为板块总结/收口节点（与 sample 中「收口」在最后的样式一致）
   * 匹配：板块总结：、收口、【xx收口】、概览、总结 等
   */
  _isSummaryNode(node) {
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

  /**
   * 解析 Summary 节点，提取标题和来源
   */
  _parseSummaryNode(node) {
    const fullTitle = node.title || '';
    const match = fullTitle.match(/^板块总结\s*[:：]\s*(.+)$/s);
    const title = match ? match[1].trim() : (fullTitle.trim() || '概览');

    // 从子节点中提取来源（URL 或邮箱）
    const sources = this._extractSources(node.children || []);

    return { title, sources };
  }

  /**
   * 递归提取来源（URL/邮箱）
   */
  _extractSources(nodes) {
    const results = [];
    const visit = (n) => {
      if (!n) return;
      if (typeof n.title === 'string') {
        const t = n.title.trim();
        if (/(https?:\/\/\S+)/i.test(t) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(t)) {
          results.push(t);
        }
      }
      if (Array.isArray(n.children)) {
        for (const c of n.children) visit(c);
      }
    };

    if (Array.isArray(nodes)) {
      for (const n of nodes) visit(n);
    }
    return results;
  }

  /**
   * 从原始节点数据得到其 ref（与 _buildChildrenRecursive 里赋值的 ref 一致）
   */
  _getRefFromNode(node) {
    if (!node) return null;
    const title = node.title || (node.imageKeyword ? `[图片: ${node.imageKeyword}]` : null);
    return title ? this._titleToRefMap[title] || this._generateRef(title) : null;
  }

  /**
   * 递归构建子节点（异步，以便挂载图片）
   */
  async _buildChildrenRecursive(nodes) {
    if (!Array.isArray(nodes)) return [];

    const children = [];

    for (const node of nodes) {
      if (!node) continue;

      const hasImage = !!node.imageKeyword;
      const isImageOnlyNode = !node.title && hasImage;

      if (isImageOnlyNode) {
        // 纯图片节点：创建节点并挂载图片
        const imageTitle = `[图片: ${node.imageKeyword}]`;
        const imageRef = this._generateRef(imageTitle);
        this._titleToRefMap[imageTitle] = imageRef;
        const imageTopic = Topic(imageTitle).ref(imageRef);
        await this._attachImage(imageTopic, node.imageKeyword);
        if (Array.isArray(node.children) && node.children.length > 0) {
          const { children: subChildren, summaryBuilders } = await this._buildChildrenWithSummary(node.children);
          if (subChildren && subChildren.length > 0) {
            imageTopic.children(subChildren);
            if (summaryBuilders && summaryBuilders.length > 0) imageTopic.summaries(summaryBuilders);
          }
          children.push(imageTopic);
        } else {
          children.push(imageTopic);
        }
      } else if (hasImage) {
        // 有标题 + 图片：建节点、挂载图片、再处理子节点
        const topicRef = this._generateRef(node.title);
        this._titleToRefMap[node.title] = topicRef;
        const topic = Topic(node.title).ref(topicRef);
        await this._attachImage(topic, node.imageKeyword);
        if (node.notes) topic.note(node.notes);
        if (Array.isArray(node.children) && node.children.length > 0) {
          const { children: subChildren, summaryBuilders } = await this._buildChildrenWithSummary(node.children);
          if (subChildren && subChildren.length > 0) {
            topic.children(subChildren);
            if (summaryBuilders && summaryBuilders.length > 0) topic.summaries(summaryBuilders);
          }
          children.push(topic);
        } else {
          children.push(topic);
        }
      } else {
        // 普通内容节点
        const topicRef = this._generateRef(node.title);
        this._titleToRefMap[node.title] = topicRef;
        const topic = Topic(node.title).ref(topicRef);
        if (node.notes) topic.note(node.notes);
        if (Array.isArray(node.children) && node.children.length > 0) {
          const { children: subChildren, summaryBuilders } = await this._buildChildrenWithSummary(node.children);
          if (subChildren && subChildren.length > 0) {
            topic.children(subChildren);
            if (summaryBuilders && summaryBuilders.length > 0) topic.summaries(summaryBuilders);
          }
          children.push(topic);
        } else {
          children.push(topic);
        }
      }
    }

    return children;
  }

  /**
   * 构建关联线数据
   * 使用 title 匹配节点，生成 Relationship 对象
   */
  _buildRelationships(relationships) {
    if (!Array.isArray(relationships) || relationships.length === 0) {
      return [];
    }

    const rels = relationships.map(rel => {
      const fromRef = rel.end1Title ? this._titleToRefMap[rel.end1Title] : null;
      const toRef = rel.end2Title ? this._titleToRefMap[rel.end2Title] : null;

      if (fromRef && toRef) {
        return Relationship(rel.title || '', { from: fromRef, to: toRef });
      } else {
        console.warn(`[WARN] 关联线节点未找到: end1=${rel.end1Title}, end2=${rel.end2Title}`);
        return null;
      }
    }).filter(Boolean);

    return rels;
  }

  /**
   * 生成稳定的 ref ID
   */
  _generateRef(title) {
    // 使用 title 生成一个稳定的 ref ID
    const hash = title.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    const positiveHash = Math.abs(hash).toString(36);
    return `topic:${positiveHash}`;
  }

  /**
   * 搜索并下载图片，然后附加到节点
   */
  async _attachImage(topic, keyword) {
    try {
      console.log(`[INFO] 搜索图片: ${keyword}`);
      const imageUrl = await imageSearchService.searchImage(keyword);
      if (!imageUrl) {
        console.warn(`[WARN] 未找到图片: ${keyword}`);
        return;
      }

      // 下载图片到系统临时目录
      const ext = this._getExtFromUrl(imageUrl);
      const tmpPath = path.join(os.tmpdir(), `xmind_img_${Date.now()}.${ext}`);
      await this._downloadFile(imageUrl, tmpPath);

      // xmind-generator 要求 { data: Buffer, name: string }，不能传 data URI
      const imgBuffer = fs.readFileSync(tmpPath);
      topic.image({ data: imgBuffer, name: `image.${ext}` });

      // 清理临时文件
      fs.unlinkSync(tmpPath);
      console.log(`[SUCCESS] 找到并嵌入图片: ${keyword}`);
    } catch (e) {
      console.warn(`[WARN] 图片嵌入失败 (${keyword}): ${e.message}`);
    }
  }

  /**
   * 下载远程文件到本地路径
   */
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      proto.get(url, (res) => {
        // 跟随重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          this._downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * 从 URL 中提取文件扩展名（默认 jpg）
   */
  _getExtFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop().toLowerCase();
      return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    } catch {
      return 'jpg';
    }
  }

  /**
   * 生成 UUID
   */
  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = new XMindService();
