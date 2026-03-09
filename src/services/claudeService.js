const Anthropic = require('@anthropic-ai/sdk');
const { jsonrepair } = require('jsonrepair');
const config = require('../config');

/**
 * Claude AI 服务
 */
class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.claude.apiKey,
      baseURL: config.claude.baseURL,
      timeout: 120000,
      maxRetries: 2
    });
  }

  /**
   * 生成申请文书思维导图结构
   * @param {Object} applicationData - 申请数据
   * @returns {Promise<Object>} 思维导图结构
   */
  async generateApplicationMindMap(applicationData) {
    try {
      console.log('[INFO] 使用单次请求生成完整思维导图...');
      return await this._generateCompleteStructure(applicationData);
    } catch (error) {
      console.error('[ERROR] 生成失败:', error.message);
      throw error;
    }
  }

  /**
   * 单次请求生成完整结构
   */
  async _generateCompleteStructure(applicationData) {
    const { schoolName, programName, websiteContent, userMaterials, sampleContent } = applicationData;

    // 根据传入的数据动态生成目标项目名称，避免写死学校和专业
    const targetParts = [];
    if (schoolName) targetParts.push(schoolName);
    if (programName) targetParts.push(programName);
    const targetProjectName = targetParts.join('-') || '目标留学项目';

    // 改进后的 prompt - 面向面试官的专业申请文书（保持五大板块，内容更细化更多层级）
    const sampleSection = sampleContent
      ? `\n## 【最高优先级】参考样例\n以下是用户提供的真实样例。**你必须模仿样例的语气、表达风格、句式习惯和措辞方式**，不要用"模板腔"或"申请文书套话"。样例里怎么说话，你就怎么说话。结构层次和内容深度也以样例为准。\n\n${sampleContent}\n`
      : '';

    const prompt = `请根据以下材料，生成申请文书思维导图的完整 JSON 数据。
${sampleSection}
## 学校项目介绍
${websiteContent}

## 申请人背景材料
${userMaterials}

## 输出规范

### 结构规则（必须严格遵守，最重要）
五大板块节点（兴趣起源/进阶思考/能力匹配/心仪课程/衷心求学）下面的 children **直接只放**：

1) **多个正文节点**（type: "content"）
- 五大板块后面直接跟正文，不要再加“二级小标题/维度一二三”这类过渡层（除非它本身也是一段完整正文）

2) **每个正文节点下面**紧跟 1 个或多个解释节点（type: "explanation"）
- 解释节点数量：可以只有 1 个，也可以很多个
- 解释节点可以继续分叉：解释节点的 children 里可以再挂更多解释/补充分支（数量不限、层级不限）

3) **板块总结节点**（每个板块必须有且只有 1 个，放在该板块 children 的最后一个）
- 位置：与“正文节点”同级（都在板块 children 里），并且必须排在最后，像“图片节点那样”做收尾
- title 建议以「板块总结：……」开头（便于识别）
- 内容：用很口语但有信息密度的方式，总结这一板块最关键的 3–5 个要点（给学生看的“收口”总结）
- 允许分支：板块总结节点下面也可以有若干 children 分支（数量不限），但必须保持它是该板块 children 的最后一个节点

### 两种节点（缺一不可）

**A. 文书正文节点**（type: "content"）
- 面向招生官的内容，有具体细节、数据、独特视角
- 写完整段落（100字以上），严格模仿样例语气
- 禁止套话：不用"我对XX有浓厚兴趣"、"这让我深刻认识到"、"这也正是我希望探索的方向"等
- **特别注意**：兴趣起源和进阶思考板块，**不要写成简历复述**。即使提到经历，也要从**思考/感悟/困惑**的角度切入，而不是"我做了什么"。重点是展示你的思维方式和对问题的深层理解。

**B. 写作逻辑解释节点**（type: "explanation"）

【最重要的语气要求，必须严格执行】
解释节点是你在**私下跟学生（姐姐/哥哥）发微信**说明「为什么要这样写」。
重点是安抚和说明，而不是给写作师下工作指令。

语气特征：
- 称呼用「姐姐」或「哥哥」，可以带一点撒娇/打趣的口吻
- 口语化，可以用「哈~」「~」「！」等语气词，但不要一句话里堆太多
- 一条解释只讲 1–2 个关键点：要么解释这段的写作小心机，要么提前提醒姐姐哪里是容易担心的点
- 直接说人话，例如「这里我故意不说自己多喜欢博物馆，是因为AO最怕那种套话开头哈~」

长度与密度要求：
- 每个解释节点控制在 **2–4 句话**，整体偏短，不写成小论文
- 不要塞整段的背景知识包、政策综述、面试话术清单等
- 不做逐条操作说明，不讲「怎么改这篇稿子」，只讲「这段为什么这样写」和「姐姐需要知道什么」

严禁出现的内容：
- 「根据审校意见，删除了XXX，改为XXX」（这是审校报告语气）
- 「这里是为了符合要求」「这里采用了XX写法」（太正式）
- 任何复述「我做了什么修改操作」的表达

### 图片节点（保持和你样例的感觉）
每个最终叶子节点后放图片节点，用来承载**配图 + 简短说明**。

图片节点推荐格式：
- 形式 A：{"title": "给学生看的简短解释或备注（1–2 句话）", "imageKeyword": "英文图片关键词", "children": []}
- 形式 B：{"title": "网址或资源名称", "imageKeyword": "英文图片关键词", "children": [{"title": "一句话解释这个网址/资源的用处或让姐姐注意的点", "imageKeyword": "", "children": []}]}

### 心仪课程板块（特别重要）
具体课程名称必须从学校官网抓取的内容里找，不能编造。
每门课按样例方式写：课程名称 + 这门课解决了她哪个具体的问题/好奇心。

### 节点ID（必须）
每个节点必须有唯一的id，使用UUID格式（如 "7bcd6231-7a61-4e91-a9c5-7f6852372ca1"）。
在生成children之前，先给每个节点分配id，后续在relationships里引用这些id。

### 关联线（必须）
生成 5-10 条跨板块的逻辑关联线，放在顶层 relationships 字段。
每个关联线必须包含：
- id: 唯一标识符（UUID）
- end1Title: **起始节点的完整标题文本**（必须和结构中某个节点的 title 完全一致！）
- end2Title: **结束节点的完整标题文本**（必须和结构中某个节点的 title 完全一致！）
- title: 逻辑关系标注

关联线样式默认使用虚线（line-pattern: dash）。

**重要**：end1Title 和 end2Title 必须使用结构中节点的完整标题文本，不要自己编造！

### 五大板块结构（固定不变）
1. **兴趣起源** - 不写简历流水账，而是讲**什么根本性的问题/困惑/观察**让你开始思考这个领域。可以提简历经历，但要从**哲学层面**切入：比如"我从小就好奇为什么..."、"一次偶然观察到...让我开始追问..."
2. **进阶思考** - 展现**认知的演进和思辨**，不是罗列做了什么，而是思考**这个领域本质上在回答什么问题**、**我现在的理解和最初有什么不同**、**还有什么困惑想继续探索**。可以联系简历经历，但重点是"我因此想到了..."而不是"我做了..."
3. **能力匹配** - 展示学术能力+实践经历，用"挑战→行动→结果"
4. **心仪课程** - 说明对目标项目课程的具体了解和兴趣
5. **衷心求学** - 表达真诚的申请意愿，谦逊但自信

### JSON 格式（严格遵守，relationships 必须在最外层）
{
  "rootTitle": "${targetProjectName}",
  "structure": [
    {"title": "兴趣起源", "type": "content", "id": "板块1的UUID", "children": [
      {"title": "正文段落...", "type": "content", "id": "节点A的UUID", "children": [
        {"title": "解释（给姐姐/哥哥看的微信口吻）...", "type": "explanation", "id": "解释节点UUID", "children": [
          {"title": "解释分支A...", "type": "explanation", "id": "UUID", "children": []},
          {"title": "解释分支B...", "type": "explanation", "id": "UUID", "children": []}
        ]},
        {"title": "另一个解释...", "type": "explanation", "id": "UUID", "children": []}
      ]},
      {"title": "板块总结：这里用3-5条把兴趣起源收口一下哈~", "type": "explanation", "id": "总结节点UUID", "children": []}
    ]},
    {"title": "进阶思考", "type": "content", "id": "板块2的UUID", "children": []},
    {"title": "能力匹配", "type": "content", "id": "板块3的UUID", "children": []},
    {"title": "心仪课程", "type": "content", "id": "板块4的UUID", "children": []},
    {"title": "衷心求学", "type": "content", "id": "板块5的UUID", "children": []}
  ],
  "relationships": [
    {"id": "关联线UUID", "end1Title": "节点A的完整标题文本", "end2Title": "节点B的完整标题文本", "title": "逻辑关系标注"}
  ]
}

只输出 JSON，不输出任何其他内容。`;

    let fullText = '';

    const systemPrompt = sampleContent
      ? `你是一个专业的 JSON 数据生成工具。
你的任务是：根据背景材料和规划要求，生成完整的思维导图 JSON 数据。
你只输出 JSON，不输出任何解释、标记或代码块。

【语气风格最高优先级】用户已提供真实样例，你必须严格模仿样例的语气、措辞、句式风格来撰写内容。禁止使用申请文书模板腔或套话。`
      : `你是一个专业的 JSON 数据生成工具。
你的任务是：根据背景材料和规划要求，生成完整的思维导图 JSON 数据。
你只输出 JSON，不输出任何解释、标记或代码块。`;

    const stream = this.client.messages.stream({
      model: config.claude.model,
      max_tokens: 12000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });

    stream.on('text', (text) => {
      fullText += text;
      process.stdout.write('.');
    });

    // 等待流真正结束（SDK 内置 120s 超时兜底，无需手动截断）
    await stream.done();

    console.log(`\n[INFO] 接收完成，共 ${fullText.length} 字符`);
    const result = this._parseJSON(fullText);

    // 如果 AI 把 relationships 放进了子节点里，自动提升到顶层
    if (!result.relationships) {
      const found = this._extractRelationships(result.structure || []);
      if (found.length > 0) {
        result.relationships = found;
        console.log(`[INFO] 自动修复：从子节点中提取 ${found.length} 条 relationships 到顶层`);
      }
    }

    // 保存生成的 JSON 到文件，方便调试
    const fs = require('fs');
    fs.writeFileSync('./ai-output.json', JSON.stringify(result, null, 2), 'utf-8');
    console.log('[INFO] AI 输出已保存到 ai-output.json');

    return result;
  }

  /**
   * 递归从 structure 子节点里找 relationships，处理 AI 放错位置的情况
   */
  _extractRelationships(nodes) {
    if (!Array.isArray(nodes)) return [];
    let found = [];
    for (const node of nodes) {
      if (Array.isArray(node.relationships)) {
        found = found.concat(node.relationships);
        delete node.relationships;
      }
      if (Array.isArray(node.children)) {
        found = found.concat(this._extractRelationships(node.children));
      }
    }
    return found;
  }

  /**
   * 解析 JSON 响应
   * AI 输出的 JSON 字符串里常含未转义的换行、引号等非法字符，
   * 先尝试直接解析，失败后用 jsonrepair 自动修复降级处理。
   */
  _parseJSON(responseText) {
    console.log('[DEBUG] AI 原始响应:', responseText.slice(0, 300));

    // 优先提取代码块内的 JSON，没有则尝试匹配裸 JSON 对象
    let jsonText = responseText;
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    } else {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonText = jsonMatch[0];
    }

    // 第一次尝试：直接解析
    try {
      return JSON.parse(jsonText);
    } catch (_) {
      // 第二次尝试：用 jsonrepair 修复 AI 常见格式问题再解析
      try {
        console.warn('[WARN] 直接解析失败，尝试 jsonrepair 自动修复...');
        const repaired = jsonrepair(jsonText);
        const result = JSON.parse(repaired);
        console.log('[INFO] jsonrepair 修复成功');
        return result;
      } catch (error) {
        console.error('[ERROR] JSON 解析彻底失败:', error.message);
        console.error('[ERROR] 响应总长度:', responseText.length, '字符');
        console.error('[ERROR] 响应末尾:', responseText.slice(-300));
        throw new Error('JSON 解析失败');
      }
    }
  }
}

module.exports = new ClaudeService();
