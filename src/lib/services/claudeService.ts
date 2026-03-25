/**
 * Claude AI 多智能体协作服务
 * 流程：总览AI → 板块AI（含总结+图片）→ 审核AI → 关联识别AI → 合并
 */

import Anthropic from '@anthropic-ai/sdk';
import {jsonrepair} from 'jsonrepair';
import {config} from '@/lib/config';
import type {MindMapData, MindMapNode, Relationship} from '@/types/mindmap';

interface ApplicationData {
    schoolName: string;
    programName: string;
    websiteContent: string;
    userMaterials: string;
    sampleContent?: string;
    /** 0-100，0=简洁 50=标准 100=详细 */
    detailLevel?: number;
    /** 0-100，0=学术 50=创意 100=实用 */
    stylePreference?: number;
}

interface BoardResult {
    boardName: string;
    boardId: string;
    data: unknown;
    writingGuide: string;
    keyPoints: string[];
}

interface ReviewResult {
    boardName: string;
    passed: boolean;
    issues: string[];
    suggestions: string[];
    score: number;
}

interface Checkpoint {
    step: number;
    overview?: unknown;
    boardResults?: BoardResult[];
    reviewResults?: unknown;
    relationships?: unknown;
}

type CheckpointSaver = (checkpoint: Checkpoint) => Promise<void>;

class ClaudeService {
    private client: Anthropic;

    constructor() {
        this.client = new Anthropic({
            apiKey: config.claude.apiKey || process.env.CLAUDE_API_KEY,
            baseURL: config.claude.baseURL || process.env.CLAUDE_BASE_URL,
            timeout: config.claude.timeout || 300000,
            maxRetries: config.claude.maxRetries || 3
        });
    }

    async generateApplicationMindMap(
        applicationData: ApplicationData,
        onProgress?: (step: string, charCount: number) => void,
        checkpoint?: Checkpoint,
        onCheckpoint?: CheckpointSaver,
    ): Promise<MindMapData> {
        try {
            console.log('[INFO] 启动多AI协作生成流程...');
            console.log('[INFO] 当前 checkpoint:', checkpoint ? `step=${checkpoint.step}` : '无，从头开始');
            return await this._multiAIGenerate(applicationData, onProgress, checkpoint, onCheckpoint);
        } catch (error) {
            console.error('[ERROR] 生成失败:', error instanceof Error ? error.message : '未知错误');
            throw error;
        }
    }

    /**
     * 多AI协作主流程
     * 支持断点续传：checkpoint 包含已完成步骤的结果，函数自动跳过
     */
    private async _multiAIGenerate(
        applicationData: ApplicationData,
        onProgress?: (step: string, charCount: number) => void,
        checkpoint?: Checkpoint,
        onCheckpoint?: CheckpointSaver,
    ): Promise<MindMapData> {
        const { schoolName, programName, websiteContent, userMaterials, sampleContent, detailLevel = 50, stylePreference = 50 } = applicationData;

        const targetParts = [];
        if (schoolName) targetParts.push(schoolName);
        if (programName) targetParts.push(programName);
        const targetProjectName = targetParts.join('-') || '目标留学项目';

        // ===== 第一步：总览AI - 生成整体结构框架 =====
        let overview: unknown;
        if (checkpoint && checkpoint.step >= 1 && checkpoint.overview) {
            overview = checkpoint.overview;
            console.log('[INFO] 跳过总览AI（从 checkpoint 恢复）');
        } else {
            // 保底：即使还没开始，先占位 checkpoint，这样 abort 后 retry 直接重试本步
            await onCheckpoint?.({ step: 0, overview, boardResults: [], reviewResults: [], relationships: [] });
            onProgress?.('总览AI', 0);
            overview = await this._callAI({
                systemPrompt: `你是一个专业的留学申请文书规划师。
你的任务是根据申请材料和样例，规划出五大板块的整体结构和写作方向。
你只输出JSON，不输出任何解释、标记或代码块。`,
                userPrompt: this._buildOverviewPrompt(targetProjectName, websiteContent, userMaterials, sampleContent),
                onProgress: (count) => onProgress?.('总览AI', count)
            });
            await onCheckpoint?.({ step: 1, overview });
            console.log('[INFO] 总览AI完成，已保存 checkpoint');
        }

        // ===== 第二步：五大板块AI并行生成 =====
        let boardResults: BoardResult[];
        if (checkpoint && checkpoint.step >= 2 && checkpoint.boardResults) {
            boardResults = checkpoint.boardResults;
            console.log('[INFO] 跳过板块生成（从 checkpoint 恢复）');
        } else {
            await onCheckpoint?.({ step: 1, overview, boardResults: [], reviewResults: [], relationships: [] });
            const boardNames = ['兴趣起源', '进阶思考', '能力匹配', '心仪课程', '衷心求学'];
            onProgress?.('板块生成', 0);
            boardResults = await Promise.all(
                boardNames.map((boardName, index) =>
                    this._generateBoardContent(
                        boardName, index + 1,
                        overview as { structure?: Array<{ title: string; id: string; writingGuide: string; keyPoints: string[]; targetLength: string }> },
                        applicationData,
                        (count) => onProgress?.(`板块:${boardName}`, count)
                    )
                )
            );
            await onCheckpoint?.({ step: 2, overview, boardResults });
            console.log('[INFO] 板块生成完成，已保存 checkpoint');
        }

        // ===== 第三步：审核AI - 审核各板块内容 =====
        let reviewResults: unknown;
        if (checkpoint && checkpoint.step >= 3 && checkpoint.reviewResults) {
            reviewResults = checkpoint.reviewResults;
            console.log('[INFO] 跳过审核AI（从 checkpoint 恢复）');
        } else {
            await onCheckpoint?.({ step: 2, overview, boardResults, reviewResults: null, relationships: [] });
            onProgress?.('审核AI', 0);
            reviewResults = await this._reviewAllBoards(boardResults, applicationData, (count) => onProgress?.('审核AI', count));
            await onCheckpoint?.({ step: 3, overview, boardResults, reviewResults });
            console.log('[INFO] 审核AI完成，已保存 checkpoint');
        }

        // ===== 第四步：关联识别AI - 识别跨板块关联 =====
        let relationships: Relationship[];
        if (checkpoint && checkpoint.step >= 4 && checkpoint.relationships) {
            relationships = checkpoint.relationships as Relationship[];
            console.log('[INFO] 跳过关联识别AI（从 checkpoint 恢复）');
        } else {
            await onCheckpoint?.({ step: 3, overview, boardResults, reviewResults, relationships: [] });
            onProgress?.('关联识别AI', 0);
            relationships = await this._identifyRelationships(boardResults, reviewResults as { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] }, (count) => onProgress?.('关联识别AI', count));
            await onCheckpoint?.({ step: 4, overview, boardResults, reviewResults, relationships });
            console.log('[INFO] 关联识别AI完成，已保存 checkpoint');
        }

        // ===== 第五步：合并最终JSON =====
        const finalResult = this._mergeFinalResult(targetProjectName, boardResults, relationships);
        await onCheckpoint?.({ step: 5, overview, boardResults, reviewResults, relationships });

        return finalResult;
    }

    /**
     * 构建总览AI的prompt
     */
    private _buildOverviewPrompt(targetProjectName: string, websiteContent: string, userMaterials: string, sampleContent?: string): string {
        const sampleSection = sampleContent
            ? `\n## 【最高优先级】参考样例\n以下是用户提供的真实样例。**你必须模仿样例的语气、表达风格、句式习惯和措辞方式**。\n\n${sampleContent}\n`
            : '';

        return `请根据以下材料，规划申请文书思维导图的五大板块结构。

${sampleSection}
## 学校项目介绍
${websiteContent}

## 申请人背景材料
${userMaterials}

## 任务
生成一个整体结构规划，包含：
1. rootTitle: "${targetProjectName}"
2. structure: 五大板块数组，每个板块包含：
   - title: 板块名称
   - id: UUID
   - writingGuide: 写作指导（告诉板块AI这个板块要写什么、怎么写、避免什么）
   - keyPoints: 3-5个核心要点（这个板块必须涵盖的关键信息）
   - targetLength: 目标字数范围
3. overallLogic: 整体逻辑（描述五大板块如何串联，形成完整叙事）

## 输出JSON格式
{
  "rootTitle": "${targetProjectName}",
  "structure": [
    {
      "title": "兴趣起源",
      "id": "UUID",
      "writingGuide": "写作指导...",
      "keyPoints": ["要点1", "要点2", "要点3"],
      "targetLength": "500-800字"
    },
    ...
  ],
  "overallLogic": "整体逻辑描述..."
}

只输出JSON，不输出任何其他内容。`;
    }

    /**
     * 生成单个板块内容（包含总结节点和图片节点）
     */
    private async _generateBoardContent(
        boardName: string,
        boardIndex: number,
        overview: { structure?: Array<{ title: string; id: string; writingGuide: string; keyPoints: string[]; targetLength: string }> },
        applicationData: ApplicationData,
        onProgress?: (charCount: number) => void,
    ): Promise<BoardResult> {
        const { websiteContent, userMaterials, sampleContent, detailLevel = 50, stylePreference = 50 } = applicationData;
        const boardInfo = overview.structure?.find(s => s.title === boardName);

        const writingGuide = boardInfo?.writingGuide || this._getDefaultWritingGuide(boardName);
        const keyPoints = boardInfo?.keyPoints || [];
        const targetLength = boardInfo?.targetLength || '500-800字';

        // 根据详细程度生成字数要求
        const minWords = Math.round(60 + (detailLevel / 100) * 140);
        const nodesPerSection = detailLevel <= 30 ? '2-3' : detailLevel >= 70 ? '4-6' : '3-4';

        // 根据风格偏好生成风格指令
        let styleInstruction = '';
        if (stylePreference <= 25) {
            styleInstruction = '\n### 写作风格：学术严谨\n使用正式学术语言，多引用学术概念和理论框架。';
        } else if (stylePreference >= 75) {
            styleInstruction = '\n### 写作风格：实用简练\n直接切入重点，使用短句，突出行动和成果。';
        } else if (stylePreference <= 40) {
            styleInstruction = '\n### 写作风格\n偏学术风格，但保持一定的叙事性。';
        } else if (stylePreference >= 60) {
            styleInstruction = '\n### 写作风格\n偏实用风格，语言简洁明快，但仍保持叙事性。';
        }

        const prompt = `请根据以下指导，生成「${boardName}」板块的完整思维导图内容。

## 写作指导
${writingGuide}

## 核心要点（必须涵盖）
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 目标字数
${targetLength}

## 详细程度
- 正文节点每个至少 ${minWords} 字
- 每个板块安排 ${nodesPerSection} 个正文节点${styleInstruction}

## 参考材料
${sampleContent ? `## 参考样例\n${sampleContent}\n` : ''}
## 学校项目介绍
${websiteContent}

## 申请人背景材料
${userMaterials}

## 输出要求（严格遵守）

### 节点结构
每个板块的结构必须如下：
1. 板块根节点：title, id（UUID）, type: "content"
2. 正文节点数组（children）：
   - 每个正文节点：title（100字以上完整段落）, type: "content", id（UUID）
   - 正文节点的children：解释节点数组
     - 解释节点：title（微信口吻，2-4句话）, type: "explanation", id（UUID）
     - 解释节点的children：可选的补充解释或**图片节点**
3. **板块总结节点**（必须，放在children的最后）：
   - title: 必须以"板块总结："开头，例如："板块总结：用口语但有信息密度的方式总结3-5个要点，像给姐姐发微信收尾"
   - type: "explanation"
   - id: UUID

### 图片节点（必须）
每个最终叶子节点（解释节点或补充解释节点）后面必须放图片节点：
- 形式A: {"title": "给学生看的简短解释或备注", "imageKeyword": "英文图片关键词", "children": []}
- 形式B: {"title": "网址或资源名称", "imageKeyword": "英文图片关键词", "children": [{"title": "一句话解释这个网址/资源的用处", "imageKeyword": "", "children": []}]}

### 禁止事项
- 禁止使用申请文书套话
- 禁止写成简历复述
- 禁止套话开头："我对XX有浓厚兴趣"

## 输出JSON格式
{
  "title": "${boardName}",
  "type": "content",
  "id": "UUID",
  "children": [
    {
      "title": "正文段落（100字以上，有具体故事、场景、细节）",
      "type": "content",
      "id": "UUID",
      "children": [
        {
          "title": "解释内容（微信口吻，2-4句话）",
          "type": "explanation",
          "id": "UUID",
          "children": [
            {
              "title": "图片说明或补充解释",
              "imageKeyword": "图片关键词",
              "children": []
            }
          ]
        }
      ]
    },
    {
      "title": "板块总结：用口语但有信息密度的方式总结3-5个要点，像给姐姐发微信收尾",
      "type": "explanation",
      "id": "UUID",
      "children": []
    }
  ]
}

只输出JSON，不输出任何其他内容。`;

        const result = await this._callAI({
            systemPrompt: `你是一个专业的申请文书写作师。
你的任务是生成高质量的申请文书板块内容，包含正文、解释、总结和图片节点。
你只输出JSON，不输出任何解释、标记或代码块。`,
            userPrompt: prompt,
            maxTokens: 8000,
            onProgress
        });

        return {
            boardName,
            boardId: boardInfo?.id || crypto.randomUUID(),
            data: result,
            writingGuide,
            keyPoints
        };
    }

    /**
     * 获取默认写作指导
     */
    private _getDefaultWritingGuide(boardName: string): string {
        const guides: Record<string, string> = {
            '兴趣起源': '用故事+吹牛+少量学术点缀的方式讲述。不要写成经历复述。从童年回忆、一次难忘的观察、或一个"不自量力"的想法切入。重点展现独特的思考角度和故事感。',
            '进阶思考': '在兴趣起源基础上展现认知演进和思辨深度。引入学术理论框架，提出更高阶的问题/见解。与兴趣起源形成明显层次递进：从"好奇"到"有见解"。禁止罗列更多经历。',
            '能力匹配': '展示学术能力+实践经历，用"挑战→行动→结果"的逻辑。突出解决问题的能力和成长。',
            '心仪课程': '从学校官网抓取的具体课程名称，说明每门课解决了什么问题/好奇心。',
            '衷心求学': '表达真诚的申请意愿，谦逊但自信。说明为什么选择这个项目。'
        };
        return guides[boardName] || '按要求撰写内容';
    }

    /**
     * 审核所有板块内容
     */
    private async _reviewAllBoards(
        boardResults: BoardResult[],
        applicationData: ApplicationData,
        onProgress?: (charCount: number) => void,
    ): Promise<{ reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] }> {
        const reviewPrompt = `你是一个专业的留学申请文书审核师。
请审核以下五大板块的内容质量，检查是否有问题。

## 审核标准
1. 内容质量：是否有具体故事、细节、数据？还是空洞的套话？
2. 逻辑连贯：与整体叙事是否一致？板块之间是否呼应？
3. 语法错误：是否有明显的语法或表达问题？
4. 套话检测：是否使用了申请文书模板腔？
5. 违规检测：是否写成了简历复述？

## 五大板块内容
${boardResults.map(br => `
### ${br.boardName}
${JSON.stringify(br.data, null, 2)}
`).join('\n')}

## 申请人背景
${applicationData.userMaterials}

## 样例风格（参考）
${applicationData.sampleContent || '无'}

## 输出JSON格式
{
  "reviews": [
    {
      "boardName": "兴趣起源",
      "passed": true/false,
      "issues": ["问题1", "问题2"],
      "suggestions": ["修改建议1", "修改建议2"],
      "score": 85
    },
    ...
  ],
  "overallScore": 85,
  "overallIssues": ["整体问题1"],
  "overallSuggestions": ["整体建议1"]
}

只输出JSON，不输出任何其他内容。`;

        const result = await this._callAI({
            systemPrompt: `你是一个专业的留学申请文书审核师。
你的任务是审核文书内容质量，给出具体的修改建议。
你只输出JSON，不输出任何解释、标记或代码块。`,
            userPrompt: reviewPrompt,
            onProgress
        });

        return result as unknown as { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] };
    }

    /**
     * 提取所有节点的完整标题（用于关联线匹配）
     */
    private _extractAllNodeTitles(boardResults: BoardResult[]): Array<{ board: string; title: string; id: string }> {
        const allNodes: Array<{ board: string; title: string; id: string }> = [];

        for (const br of boardResults) {
            const boardData = br.data as { children?: MindMapNode[] } | undefined;
            const nodes = boardData?.children || [];

            const traverse = (nodeList: MindMapNode[], board: string) => {
                if (!Array.isArray(nodeList)) return;
                for (const node of nodeList) {
                    if (node.title) {
                        allNodes.push({
                            board: board,
                            title: node.title,
                            id: node.id || ''
                        });
                    }
                    if (Array.isArray(node.children)) {
                        traverse(node.children, board);
                    }
                }
            };

            traverse(nodes, br.boardName);
        }

        return allNodes;
    }

    /**
     * 识别跨板块关联（使用实际节点标题）
     */
    private async _identifyRelationships(
        boardResults: BoardResult[],
        reviewResults: { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] },
        onProgress?: (charCount: number) => void,
    ): Promise<Relationship[]> {
        // 先提取所有实际生成的节点标题
        const allNodes = this._extractAllNodeTitles(boardResults);

        // 构建节点标题列表（带板块名）
        const nodeListText = allNodes.map(n =>
            `[${n.board}] ${n.title}`
        ).join('\n');

        const relationshipsPrompt = `你是一个专业的留学申请文书关联分析师。
请分析以下五大板块的实际节点内容，识别有逻辑关联的节点，生成关联线。

## 实际生成的节点列表（必须使用这些标题，不能编造）

${nodeListText}

## 审核反馈
${JSON.stringify(reviewResults, null, 2)}

## 任务
识别跨板块的有意义的逻辑关联，比如：
- 兴趣起源中提到的某个故事/观点，在进阶思考中被深化
- 能力匹配中的某个经历，呼应了心仪课程的选择
- 衷心求学的表达，与兴趣起源形成呼应

## 重要规则
- **必须使用上面列出的实际节点标题**，格式为 "[板块名] 节点标题"
- end1Title 和 end2Title 必须能在上面的列表中找到完全匹配的标题
- 宁缺毋滥，不要生成没有逻辑意义的关联线
- 优先找有强逻辑关联的内容

## 输出JSON格式
{
  "relationships": [
    {
      "id": "UUID",
      "end1Board": "兴趣起源",
      "end1Title": "起始节点完整标题（必须和上面列表中的完全一致）",
      "end2Board": "进阶思考",
      "end2Title": "结束节点完整标题（必须和上面列表中的完全一致）",
      "title": "逻辑关系标注",
      "linePattern": "dash"
    }
  ]
}

只输出JSON，不输出任何其他内容。`;

        const result = await this._callAI({
            systemPrompt: `你是一个专业的留学申请文书关联分析师。
你的任务是识别跨板块内容的逻辑关联。
你只输出JSON，不输出任何解释、标记或代码块。
重要：必须使用提供的实际节点标题，不能编造！`,
            userPrompt: relationshipsPrompt,
            onProgress
        });

        const relationships = (result as unknown as { relationships?: Relationship[] })?.relationships || [];

        // 验证关联线是否匹配到实际节点
        const validRelationships: Relationship[] = [];

        for (const rel of relationships) {
            const end1Match = allNodes.find(n => n.title === (rel as unknown as { end1Title?: string }).end1Title);
            const end2Match = allNodes.find(n => n.title === (rel as unknown as { end2Title?: string }).end2Title);

            if (end1Match && end2Match) {
                validRelationships.push({
                    ...rel,
                } as Relationship);
            }
        }

        return validRelationships;
    }

    /**
     * 合并最终结果
     */
    private _mergeFinalResult(targetProjectName: string, boardResults: BoardResult[], relationships: Relationship[]): MindMapData {
        const structure = boardResults.map(br => {
            const boardData = br.data as { children?: MindMapNode[] } | undefined;
            return {
                title: br.boardName,
                id: br.boardId,
                type: 'content',
                children: boardData?.children || []
            } as MindMapNode;
        });

        return {
            rootTitle: targetProjectName,
            structure,
            relationships
        };
    }

    /**
     * 调用AI（通用方法）
     */
    private async _callAI(params: {
        systemPrompt: string;
        userPrompt: string;
        maxTokens?: number;
        retries?: number;
        onProgress?: (charCount: number) => void;
    }): Promise<Record<string, unknown>> {
        const { systemPrompt, userPrompt, maxTokens = 6000, retries = 3, onProgress } = params;
        let lastError: Error | undefined;
        let lastResponseText = '';

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                let fullText = '';
                const controller = new AbortController();
                // 超时配得上重试间隔，避免.abort()打断还在正常返回的响应
                const requestTimeout = setTimeout(() => controller.abort(), 180_000);

                const stream = this.client.messages.stream({
                    model: config.claude.model,
                    max_tokens: maxTokens,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    signal: controller.signal as AbortSignal,
                });

                stream.on('text', (text) => {
                    fullText += text;
                    try { onProgress?.(fullText.length); } catch { /* ignore */ }
                });

                await stream.done();
                clearTimeout(requestTimeout);
                lastResponseText = fullText;

                const result = this._parseJSON(fullText);
                return result;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error('未知错误');
                // 只取前300字，避免日志爆炸
                const preview = lastResponseText.trim().substring(0, 300);
                console.warn(`[WARN] AI调用失败 (第${attempt}次/${retries}):`, lastError.message);
                if (preview) console.warn(`[WARN] 响应文本预览: ${preview}`);

                if (attempt < retries) {
                    const waitTime = attempt * 5_000;
                    console.warn(`[WARN] ${waitTime / 1000}s 后重试…`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        throw new Error(`AI调用失败，已重试 ${retries} 次: ${lastError?.message}`);
    }

    /**
     * 解析JSON（流式截断兜底）
     *
     * Claude 流式输出偶尔会中途断开，导致：
     * 1. 尾部被截在 {...{ 或数组元素中间
     * 2. 缺少 }]}` 等闭合符号
     *
     * 兜底策略：若 JSON.parse 失败，用 jsonrepair 修；
     * 若 jsonrepair 也失败，尝试用正则推断截断点并补全。
     */
    private _parseJSON(responseText: string): Record<string, unknown> {
        // 策略1：代码块包裹
        const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            return this._tryParse(codeBlockMatch[1]);
        }

        // 策略2：直接匹配 {...}
        const trimmed = responseText.trim();

        // 策略2a：完整 JSON
        const fullMatch = trimmed.match(/\{[\s\S]*\}\s*$/);
        if (fullMatch) {
            return this._tryParse(fullMatch[0]);
        }

        // 策略2b：截断 JSON — 找到最后一个完整 "}," 或 "}]" 分隔点，截断后重试
        const lastValid = Math.max(
            trimmed.lastIndexOf('},'),
            trimmed.lastIndexOf('}]'),
        );
        if (lastValid > 100) {
            const truncated = trimmed.substring(0, lastValid + 1);
            try {
                return this._tryParse(truncated);
            } catch {
                // 截断版也失败，交给 jsonrepair
            }
        }

        return this._tryParse(trimmed);
    }

    private _tryParse(text: string): Record<string, unknown> {
        try {
            return JSON.parse(text);
        } catch (_) {
            try {
                const repaired = jsonrepair(text);
                return JSON.parse(repaired);
            } catch (err) {
                throw new Error(`JSON解析失败: ${(err as Error).message} | 原始文本长度: ${text.length}`);
            }
        }
    }
}

export const claudeService = new ClaudeService();
