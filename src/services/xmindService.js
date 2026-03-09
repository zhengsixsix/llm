const { Workbook, Topic, Zipper } = require('xmind');
const JSZip = require('jszip');
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
 * xmind SDK 的 image() 只支持本地文件路径（xap:resources/xxx）。
 * 远程 URL 需要先下载到临时目录，再传路径给 SDK 写入 xmind 资源包。
 */
class XMindService {
  constructor() {
    // 收集所有 explanation 节点的 title，用于后期注入样式
    this._explanationTitles = new Set();
  }

  /**
   * 根据结构化数据生成 XMind 文件
   * @param {Object} structure - 思维导图结构数据
   * @param {string} outputPath - 输出文件路径
   */
  async generateXMind(structure, outputPath) {
    const workbook = new Workbook();
    const rootTitle = structure.rootTitle || '申请文书思维导图';

    const sheet = workbook.createSheet(rootTitle, rootTitle);
    const topic = new Topic({ sheet });

    const rootId = topic.rootTopicId;

    // 生成关联线
    const relationships = structure.relationships || [];
    if (relationships.length > 0) {
      console.log(`[INFO] 检测到 ${relationships.length} 条关联线待处理`);
    }

    const structureData = structure.structure || [];
    if (Array.isArray(structureData)) {
      for (const section of structureData) {
        if (!section || !section.title) continue;

        // 创建一级板块节点
        topic.on(rootId).add({ title: section.title });
        const sectionId = topic.cid();

        if (Array.isArray(section.children)) {
          await this._buildSection(topic, sectionId, section.children);
        }
      }
    }

    const outputDir = path.dirname(path.resolve(outputPath));
    const filename = path.basename(outputPath, '.xmind');

    const zipper = new Zipper({ path: outputDir, workbook, filename });
    await zipper.save();

    // 注入黑色背景白色字体样式到所有节点
    // 解压→修改→重新打包
    await this._injectBlackStyleToAllNodes(outputPath, structure.relationships || []);
  }

  /**
   * 给所有节点注入黑色背景白色字体样式
   * 修复版：确保同时更新 content.json 和 content.xml
   */
  async _injectBlackStyleToAllNodes(outputPath, relationships) {
    try {
      const absPath = path.resolve(outputPath);
      const buffer = fs.readFileSync(absPath);
      const zip = await JSZip.loadAsync(buffer);

      // 1. 修改 content.json
      if (zip.files['content.json']) {
        const contentStr = await zip.files['content.json'].async('string');
        const contentData = JSON.parse(contentStr);
        const sheet = contentData[0];

        // 递归给所有节点添加黑色背景样式
        this._applyBlackStyleToTopic(sheet.rootTopic);

        // 同时修改 sheet 的样式
        if (!sheet.style) sheet.style = {};
        sheet.style['svg:fill'] = '#000000';
        sheet.style['fo:background-color'] = '#000000';
        sheet.style['fo:color'] = '#FFFFFF';

        // 添加关联线
        if (relationships && relationships.length > 0) {
          sheet.relationships = this._buildRelationshipsData(sheet.rootTopic, relationships);
        }

        zip.file('content.json', JSON.stringify(contentData));
      }

      // 2. 修改 content.xml - 始终用 content.json 重新生成，确保样式被正确写入
      if (zip.files['content.xml']) {
        const contentStr = await zip.files['content.json'].async('string');
        const contentData = JSON.parse(contentStr);
        const newXml = this._generateContentXml(contentData[0]);
        zip.file('content.xml', newXml);
      }

      const newBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      fs.writeFileSync(absPath, newBuffer);
      console.log('[SUCCESS] 已注入黑色背景白色字体样式');
    } catch (e) {
      console.warn(`[WARN] 样式注入失败: ${e.message}`);
    }
  }

  /**
   * 从 JSON 数据生成 content.xml
   */
  _generateContentXml(sheet) {
    const xmlParts = [];
    xmlParts.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
    xmlParts.push(`<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">`);

    const style = sheet.rootTopic?.style || {};
    const fill = style['svg:fill'] || '#000000';
    const color = style['fo:color'] || '#FFFFFF';
    const borderColor = style['border-line-color'] || '#000000';
    const borderWidth = style['border-line-width'] || '2pt';

    xmlParts.push(`<sheet id="${sheet.id}" theme="classic">`);
    xmlParts.push(`<topic id="${sheet.rootTopic.id}" structure-class="org.xmind.ui.logic.right" svg:fill="${fill}" fo:color="${color}" border-line-color="${borderColor}" border-line-width="${borderWidth}">`);
    xmlParts.push(`<title>${this._escapeXml(sheet.rootTopic.title)}</title>`);

    if (sheet.rootTopic.children?.attached) {
      xmlParts.push('<children>');
      xmlParts.push('<topics type="attached">');
      for (const child of sheet.rootTopic.children.attached) {
        xmlParts.push(this._topicToXml(child, 2, fill, color, borderColor, borderWidth));
      }
      xmlParts.push('</topics>');
      xmlParts.push('</children>');
    }

    xmlParts.push('</topic>');
    xmlParts.push('</sheet>');
    xmlParts.push('</xmap-content>');

    return xmlParts.join('\n');
  }

  /**
   * 递归将 topic 转换为 XML
   */
  _topicToXml(topic, indent, fill, color, borderColor, borderWidth) {
    const spaces = '  '.repeat(indent);
    
    // 检查当前 topic 是否有自定义样式
    const topicStyle = topic.style || {};
    const topicFill = topicStyle['svg:fill'] || fill;
    const topicColor = topicStyle['fo:color'] || color;
    const topicBorderColor = topicStyle['border-line-color'] || borderColor;
    const topicBorderWidth = topicStyle['border-line-width'] || borderWidth;
    
    let xml = `${spaces}<topic id="${topic.id}" svg:fill="${topicFill}" fo:color="${topicColor}" border-line-color="${topicBorderColor}" border-line-width="${topicBorderWidth}">\n`;
    xml += `${spaces}  <title>${this._escapeXml(topic.title)}</title>\n`;

    // 输出 summary（子节点的概览总结）- 从 children 外面读取
    const summaryTopics = topic.summary || topic.summaries || topic.children?.summary;
    if (Array.isArray(summaryTopics) && summaryTopics.length > 0) {
      xml += `${spaces}  <summaries>\n`;
      for (const s of summaryTopics) {
        // 从 style 中读取样式，如果没有则使用默认值
        const sStyle = s.style || {};
        const sFill = sStyle['svg:fill'] || '#000000';
        const sColor = sStyle['fo:color'] || '#FFFFFF';
        const sBorder = sStyle['border-line-color'] || '#000000';
        const sBorderW = sStyle['border-line-width'] || '1pt';
        // 计算 range（summary 覆盖的子节点范围）
        const childCount = topic.children?.attached?.length || 0;
        const range = `(0,${Math.max(0, childCount - 1)})`;
        xml += `${spaces}    <summary id="${s.id}" range="${range}" topicId="${s.id}" svg:fill="${sFill}" fo:color="${sColor}" border-line-color="${sBorder}" border-line-width="${sBorderW}">\n`;
        xml += `${spaces}      <title>${this._escapeXml(s.title)}</title>\n`;
        xml += `${spaces}    </summary>\n`;
      }
      xml += `${spaces}  </summaries>\n`;
    }

    if (topic.children?.attached) {
      xml += `${spaces}  <children>\n`;
      xml += `${spaces}    <topics type="attached">\n`;
      for (const child of topic.children.attached) {
        xml += this._topicToXml(child, indent + 3, topicFill, topicColor, topicBorderColor, topicBorderWidth);
      }
      xml += `${spaces}    </topics>\n`;
      xml += `${spaces}  </children>\n`;
    }

    xml += `${spaces}</topic>`;
    return xml;
  }

  /**
   * XML 转义
   */
  _escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 递归给节点添加黑色背景样式
   */
  _applyBlackStyleToTopic(topic, options = {}) {
    if (!topic) return;
    const { isSummaryTopic = false } = options;

    // 给当前节点设置黑色背景、白色字体
    if (!topic.style) topic.style = {};
    topic.style['svg:fill'] = '#000000';         // SVG填充色
    topic.style['fo:background-color'] = '#000000'; // 背景色
    topic.style['fo:color'] = '#FFFFFF';          // 字体颜色
    topic.style['border-line-color'] = '#000000';
    topic.style['border-line-width'] = '2pt';
    topic.style['shape-class'] = 'org.xmind.topicShape.roundedRect';

    // 概览/总结框（Summary topic）样式：黑色背景+白色字体
    if (isSummaryTopic) {
      topic.style['svg:fill'] = '#000000';        // 黑色背景
      topic.style['fo:background-color'] = '#000000'; // 黑色背景
      topic.style['fo:color'] = '#FFFFFF';        // 白色字体
      topic.style['border-line-color'] = '#000000'; // 黑色边框
      topic.style['border-line-width'] = '1pt';   // 细边框
      topic.style['fo:font-size'] = topic.style['fo:font-size'] || '11pt';
      topic.style['fo:text-align'] = topic.style['fo:text-align'] || 'left';
      if (!topic.customWidth) topic.customWidth = 360;
    }

    // 递归处理子节点
    const children = topic.children?.attached || [];
    for (const child of children) {
      this._applyBlackStyleToTopic(child);
    }

    // Summary 主题节点（在不同版本/结构里可能出现在 topic.summary 或 topic.children.summary 或 topic.summaries）
    const summaryTopics = []
      .concat(Array.isArray(topic.summary) ? topic.summary : [])
      .concat(Array.isArray(topic.children?.summary) ? topic.children.summary : [])
      .concat(Array.isArray(topic.summaries) ? topic.summaries : []);

    for (const s of summaryTopics) {
      this._applyBlackStyleToTopic(s, { isSummaryTopic: true });
    }
  }

  /**
   * 构建单个「板块」：
   * - 普通 children 正常渲染
   * - 如果存在「板块总结」节点，则用 XMind 的 Summary 组件渲染到右侧（而不是在底部追加一个节点）
   */
  async _buildSection(topic, sectionId, children) {
    if (!Array.isArray(children) || children.length === 0) return;

    // 兼容：AI 可能不严格把总结放在最后，所以这里取最后一个命中的 summary 节点
    let sectionSummaryNode = null;
    const normalChildren = [];
    for (const node of children) {
      if (this._isSectionSummaryNode(node)) {
        sectionSummaryNode = node;
      } else {
        normalChildren.push(node);
      }
    }

    const topLevelIds = await this._buildChildren(topic, sectionId, normalChildren);

    if (!sectionSummaryNode) return;

    // Summary 是“同级范围总结”组件：需要用同一层级的起点 topicId + edge topicId
    // 不能用 sectionId（父节点）作为起点，否则会变成对父层级的 summary，左右分支会丢失
    const startId = topLevelIds.length > 0 ? topLevelIds[0] : null;
    const edgeId = topLevelIds.length > 0 ? topLevelIds[topLevelIds.length - 1] : null;
    if (!startId || !edgeId) return;

    const sources = this._extractSourcesFromNodes(normalChildren);
    const summaryTitle = this._composeOverviewTitle(sectionSummaryNode.title, sources);

    // 板块概览（Summary 组件）——会跟随该板块在左右两侧渲染
    topic.on(startId).summary({ title: summaryTitle, edge: edgeId });
  }

  _isSectionSummaryNode(node) {
    if (!node || typeof node.title !== 'string') return false;
    return /^板块总结\s*[:：]/.test(node.title.trim());
  }

  _composeOverviewTitle(summaryText, sources) {
    const base = (summaryText || '').trim();
    const deduped = Array.isArray(sources) ? Array.from(new Set(sources)).filter(Boolean) : [];
    if (deduped.length === 0) return base || '概览';

    const maxSources = 8;
    const lines = deduped.slice(0, maxSources).map(s => `- ${s}`);
    return `${base || '概览'}\n\n来源：\n${lines.join('\n')}`;
  }

  _extractSourcesFromNodes(nodes) {
    const results = [];
    const visit = (n) => {
      if (!n) return;
      if (typeof n.title === 'string') {
        const t = n.title.trim();
        // URL / Email / "xxx | https://..." 这类信息通常就是用户想看到的“来源”
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
   * 递归收集所有节点的 title → id 映射
   */
  _collectTitleIds(topic, map) {
    if (!topic) return;
    if (topic.title) map[topic.title] = topic.id;
    const children = topic.children?.attached || [];
    for (const child of children) {
      this._collectTitleIds(child, map);
    }
  }

  /**
   * 构建一组兄弟节点，保证「图片节点」挂在前一个内容节点下面
   * @param {Topic} topic
   * @param {string} parentId - 当前层级的父节点 ID
   * @param {Array} children  - 当前层级的所有子节点数据
   */
  async _buildChildren(topic, parentId, children) {
    let lastContentNodeId = null;
    const createdIds = [];

    for (const node of children) {
      if (!node) continue;

      const isImageNode = !node.title && node.imageKeyword;

      if (isImageNode && lastContentNodeId) {
        // 纯图片节点，且前面有内容节点：挂在最近的内容节点下面
        await this._buildTopic(topic, lastContentNodeId, node);
      } else {
        // 普通内容节点或前面没有内容节点：挂在该板块/父节点下面
        const createdId = await this._buildTopic(topic, parentId, node);
        if (createdId && !isImageNode) {
          lastContentNodeId = createdId;
          // 只记录「直接挂在 parentId 下面」的节点，作为 summary 的 edge 计算依据
          createdIds.push(createdId);
        }
      }
    }

    return createdIds;
  }

  /**
   * 递归构建单个主题节点
   * @param {Topic} topic    - xmind Topic 实例
   * @param {string} parentId - 父节点的组件 ID（UUID，不是标题）
   * @param {Object} data    - 当前节点数据 {title, imageKeyword?, notes?, children}
   * @returns {Promise<string|null>} - 当前创建节点的 ID（如果创建了）
   *
   * 这里不再主动拆分句子，由 AI 在 JSON 里决定是否有 children。
   */
  async _buildTopic(topic, parentId, data) {
    if (!data) return null;

    const isImageNode = !data.title && data.imageKeyword;
    const nodeTitle = data.title || (isImageNode ? `[图片: ${data.imageKeyword}]` : '');
    if (!nodeTitle) return null;

    // 创建当前节点
    topic.on(parentId).add({ title: nodeTitle });
    const currentId = topic.cid();

    // 记录写作逻辑解释节点，用于后期注入样式
    if (data.type === 'explanation' && data.title) {
      this._explanationTitles.add(data.title);
    }

    if (data.imageKeyword) {
      await this._attachImage(topic, currentId, data.imageKeyword);
    }

    if (data.notes) {
      topic.on(currentId).note(data.notes);
    }

    if (Array.isArray(data.children) && data.children.length > 0) {
      await this._buildChildren(topic, currentId, data.children);
    }

    return currentId;
  }

  /**
   * 搜索并下载图片，然后通过 xmind SDK 附加到节点
   * xmind SDK image() 方法需要本地文件路径或 base64 data URI
   */
  async _attachImage(topic, nodeId, keyword) {
    try {
      console.log(`[INFO] 搜索图片: ${keyword}`);
      const imageUrl = await imageSearchService.searchImage(keyword);
      if (!imageUrl) {
        console.warn(`[WARN] 未找到图片: ${keyword}`);
        return;
      }

      // 下载图片到系统临时目录
      const tmpPath = path.join(os.tmpdir(), `xmind_img_${Date.now()}.jpg`);
      await this._downloadFile(imageUrl, tmpPath);

      // 读取为 base64 data URI（xmind SDK 支持 data URI src）
      const imgBuffer = fs.readFileSync(tmpPath);
      const ext = this._getExtFromUrl(imageUrl);
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${imgBuffer.toString('base64')}`;

      // 附加图片到节点（SDK 内部会将图片写入 xmind 资源包）
      topic.on(nodeId).image({ src: dataUri });

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
        // 跟随重定向（Unsplash 返回 302）
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
   * 构建关联线数据
   * 递归遍历所有节点，找到与 relationships 中 end1Id/end2Id 匹配的节点
   * 支持两种匹配方式：1. 通过节点id匹配 2. 通过节点title匹配
   */
  _buildRelationshipsData(rootTopic, relationships) {
    const result = [];
    
    // 递归收集所有节点，使用精确的 title 匹配
    const nodeTitleMap = {}; // title -> 实际XMind节点
    
    const collectNodes = (topic) => {
      if (!topic) return;
      
      // 使用完整 title 作为 key
      if (topic.title) {
        if (!nodeTitleMap[topic.title]) {
          nodeTitleMap[topic.title] = topic;
        }
      }
      
      const children = topic.children?.attached || [];
      for (const child of children) {
        collectNodes(child);
      }
    };
    
    collectNodes(rootTopic);

    for (const rel of relationships) {
      let end1Node = null;
      let end2Node = null;
      
      // 精确匹配 title
      if (rel.end1Title) {
        end1Node = nodeTitleMap[rel.end1Title];
      }
      if (rel.end2Title) {
        end2Node = nodeTitleMap[rel.end2Title];
      }
      
      if (end1Node && end2Node) {
        // 构建关联线，不添加 style/class 字段以保证兼容性
        const relData = {
          id: rel.id || this._generateUUID(),
          end1Id: end1Node.id,
          end2Id: end2Node.id,
          title: rel.title || '',
          controlPoints: {}
        };
        
        // 如果标题有多个单词，添加 attributedTitle
        if (rel.title && rel.title.includes(' ')) {
          const words = rel.title.split(' ');
          relData.attributedTitle = words.map(w => ({ text: w }));
        }
        
        result.push(relData);
        console.log(`[INFO] 关联线已添加: ${rel.title}`);
      } else {
        console.warn(`[WARN] 关联线节点未找到: end1=${rel.end1Id || rel.end1Title?.substring(0,30)}, end2=${rel.end2Id || rel.end2Title?.substring(0,30)}`);
      }
    }
    
    return result;
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
