const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');



/**
 * 递归将 xmind topic 树转换为缩进文本，方便投喂给 AI 作为参考
 * @param {Object} topic  - xmind content.json 里的 topic 对象
 * @param {number} depth  - 当前层级（用于缩进）
 * @param {number} maxDepth - 最大采样深度，避免文本过长
 * @returns {string}
 */
function topicToText(topic, depth = 0, maxDepth = 4) {
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

/**
 * 递归收集 xmind topic 的 id → title 映射
 */
function collectIdTitles(topic, map) {
  if (!topic) return;
  if (topic.id && topic.title) map[topic.id] = topic.title;
  const attached = topic.children?.attached || [];
  for (const child of attached) {
    collectIdTitles(child, map);
  }
}

/**
 * 解析单个 .xmind 文件，返回其结构文本摘要
 * @param {string} filePath - .xmind 文件路径
 * @returns {Promise<string>}
 */
async function parseXMindFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 优先读取 content.json（新版 xmind 格式）
  let contentText = '';
  if (zip.files['content.json']) {
    contentText = await zip.files['content.json'].async('string');
  } else if (zip.files['content.xml']) {
    // 旧版 XML 格式：只做简单文本提取，不完整解析
    const xml = await zip.files['content.xml'].async('string');
    const titles = [...xml.matchAll(/title[^>]*>([^<]+)</g)].map(m => m[1]);
    return titles.slice(0, 60).join('\n');
  } else {
    return '（无法解析该 xmind 文件）';
  }

  let sheets;
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

    // 提取关联线作为参考
    if (Array.isArray(sheet.relationships) && sheet.relationships.length > 0) {
      // 构建 id → title 映射
      const idToTitle = {};
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

/**
 * 读取 sampleDir 目录下所有 .xmind 文件，返回合并的样例文本
 * 支持从外部路径读取（优先检查外部路径）
 * @param {string} sampleDir - 样例目录路径
 * @returns {Promise<string>}
 */
async function readSamples(sampleDir = './sample') {
  // 优先检查外部路径
  const externalPath = 'E:\\xianyu\\LLM海外\\sample\\HKU+CityU-Business+Ethics AI.xmind';
  if (fs.existsSync(externalPath)) {
    console.log(`[INFO] 从外部路径读取样例: ${externalPath}`);
    try {
      const text = await parseXMindFile(externalPath);
      console.log(`[SUCCESS] 样例解析完成`);
      return text;
    } catch (e) {
      console.warn(`[WARN] 样例解析失败: ${e.message}`);
    }
  }

  // 检查目标目录
  if (!fs.existsSync(sampleDir)) {
    console.warn(`[WARN] 样例目录不存在: ${sampleDir}`);
    return '';
  }

  const files = fs.readdirSync(sampleDir).filter(f => f.endsWith('.xmind'));
  if (files.length === 0) {
    console.warn('[WARN] sample 目录下没有找到 .xmind 文件');
    return '';
  }

  console.log(`[INFO] 发现 ${files.length} 个样例文件: ${files.join(', ')}`);

  const results = [];
  for (const file of files) {
    const fullPath = path.join(sampleDir, file);
    try {
      const text = await parseXMindFile(fullPath);
      results.push(text);
      console.log(`[SUCCESS] 样例解析完成: ${file}`);
    } catch (e) {
      console.warn(`[WARN] 样例解析失败 (${file}): ${e.message}`);
    }
  }

  return results.join('\n\n');
}

module.exports = { readSamples };

// 直接运行时执行测试
if (require.main === module) {
  const sampleDir = process.argv[2] || './sample';
  console.log(`\n正在解析样例目录: ${sampleDir}\n`);
  readSamples(sampleDir).then(text => {
    if (!text) {
      console.log('未解析到任何内容');
      return;
    }
    console.log('\n========== 解析结果 ==========\n');
    console.log(text);
    console.log('\n========== 结束 ==========');
    console.log(`\n总字符数: ${text.length}`);
  }).catch(err => {
    console.error('解析失败:', err.message);
    console.error(err.stack);
  });
}
