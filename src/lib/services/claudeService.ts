/**
 * Claude AI 服务
 */

import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import { config } from '@/lib/config';
import type { MindMapData, MindMapNode, Relationship } from '@/types/mindmap';

interface ApplicationData {
  schoolName: string;
  programName: string;
  websiteContent: string;
  userMaterials: string;
  sampleContent?: string;
}

class ClaudeService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.claude.apiKey || process.env.CLAUDE_API_KEY,
      baseURL: config.claude.baseURL || process.env.CLAUDE_BASE_URL,
      timeout: config.claude.timeout || 120000,
      maxRetries: config.claude.maxRetries || 2
    });
  }

  async generateApplicationMindMap(applicationData: ApplicationData): Promise<MindMapData> {
    try {
      console.log('[INFO] 使用单次请求生成完整思维导图...');
      return await this.generateCompleteStructure(applicationData);
    } catch (error) {
      console.error('[ERROR] 生成失败:', error instanceof Error ? error.message : '未知错误');
      throw error;
    }
  }

  private async generateCompleteStructure(applicationData: ApplicationData): Promise<MindMapData> {
    const { schoolName, programName, websiteContent, userMaterials, sampleContent } = applicationData;

    const targetParts = [];
    if (schoolName) targetParts.push(schoolName);
    if (programName) targetParts.push(programName);
    const targetProjectName = targetParts.join('-') || '目标留学项目';

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
- 五大板块后面直接跟正文，不要再加"二级小标题/维度一二三"这类过渡层

2) **每个正文节点下面**紧跟 1 个或多个解释节点（type: "explanation"）
- 解释节点数量：可以只有 1 个，也可以很多个
- 解释节点可以继续分叉：解释节点的 children 里可以再挂更多解释/补充分支

3) **板块总结节点**（每个板块必须有且只有 1 个，放在该板块 children 的最后一个）

### 两种节点（缺一不可）

**A. 文书正文节点**（type: "content"）
- 面向招生官的内容，有具体细节、数据、独特视角
- 写完整段落（100字以上），严格模仿样例语气
- 禁止套话

**B. 写作逻辑解释节点**（type: "explanation"）
- 解释节点是你在私下跟学生（姐姐/哥哥）发微信说明「为什么要这样写」
- 口语化，称呼用「姐姐」或「哥哥」
- 每个解释节点控制在 2–4 句话

### 图片节点
每个最终叶子节点后放图片节点。
- 格式：{"title": "简短解释", "imageKeyword": "英文图片关键词", "children": []}

### 心仪课程板块
具体课程名称必须从学校官网抓取的内容里找。

### 节点ID
每个节点必须有唯一的id，使用UUID格式。

### 关联线（如有需要）
根据正文内容自主判断是否需要添加跨板块的逻辑关联线。

### 五大板块结构（固定不变）
1. 兴趣起源 - 用故事+吹牛+少量学术点缀
2. 进阶思考 - 在兴趣起源基础上展现认知的演进和思辨深度
3. 能力匹配 - 展示学术能力+实践经历
4. 心仪课程 - 说明对目标项目课程的具体了解和兴趣
5. 衷心求学 - 表达真诚的申请意愿

### JSON 格式
{
  "rootTitle": "${targetProjectName}",
  "structure": [
    {"title": "兴趣起源", "type": "content", "id": "UUID", "children": []},
    {"title": "进阶思考", "type": "content", "id": "UUID", "children": []},
    {"title": "能力匹配", "type": "content", "id": "UUID", "children": []},
    {"title": "心仪课程", "type": "content", "id": "UUID", "children": []},
    {"title": "衷心求学", "type": "content", "id": "UUID", "children": []}
  ],
  "relationships": []
}

只输出 JSON，不输出任何其他内容。`;

    let fullText = '';

    const systemPrompt = sampleContent
      ? `你是一个专业的 JSON 数据生成工具。你的任务是：根据背景材料和规划要求，生成完整的思维导图 JSON 数据。你只输出 JSON，不输出任何解释、标记或代码块。【语气风格最高优先级】用户已提供真实样例，你必须严格模仿样例的语气、措辞、句式风格来撰写内容。`
      : `你是一个专业的 JSON 数据生成工具。你的任务是：根据背景材料和规划要求，生成完整的思维导图 JSON 数据。你只输出 JSON，不输出任何解释、标记或代码块。`;

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

    await stream.done();

    console.log(`\n[INFO] 接收完成，共 ${fullText.length} 字符`);
    const result = this.parseJSON(fullText);

    if (!result.relationships) {
      const found = this.extractRelationships((result.structure || []) as Record<string, unknown>[]);
      if (found.length > 0) {
        result.relationships = found;
      }
    }

    return result as unknown as MindMapData;
  }

  private extractRelationships(nodes: Record<string, unknown>[]): Relationship[] {
    if (!Array.isArray(nodes)) return [];
    let found: Relationship[] = [];
    for (const node of nodes) {
      if (Array.isArray(node.relationships)) {
        found = found.concat(node.relationships as Relationship[]);
        delete node.relationships;
      }
      if (Array.isArray(node.children)) {
        found = found.concat(this.extractRelationships(node.children as Record<string, unknown>[]));
      }
    }
    return found;
  }

  private parseJSON(responseText: string): Record<string, unknown> {
    console.log('[DEBUG] AI 原始响应:', responseText.slice(0, 300));

    let jsonText = responseText;
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    } else {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonText = jsonMatch[0];
    }

    try {
      return JSON.parse(jsonText);
    } catch {
      try {
        console.warn('[WARN] 直接解析失败，尝试 jsonrepair 自动修复...');
        const repaired = jsonrepair(jsonText);
        const result = JSON.parse(repaired);
        console.log('[INFO] jsonrepair 修复成功');
        return result;
      } catch (error) {
        console.error('[ERROR] JSON 解析彻底失败:', error instanceof Error ? error.message : '未知错误');
        throw new Error('JSON 解析失败');
      }
    }
  }
}

export const claudeService = new ClaudeService();
