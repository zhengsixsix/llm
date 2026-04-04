import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { config } from '@/lib/config';
import type { BoardBudget, BoardName, WordBudgetPlan } from '@/types/budget';
import type { BoardDraftItem, SectionDraft } from '@/types/draft';
import type { MindMapData, MindMapNode, Relationship } from '@/types/mindmap';
import type { EvidenceAtom, ProgramProfile, ResumeProfile } from '@/types/profile';
import type { StyleProfile } from '@/types/style';
import { sampleStyleService } from './sampleStyleService';
import { wordBudgetService } from './wordBudgetService';

interface ApplicationData {
  schoolName: string;
  programName: string;
  websiteContent: string;
  userMaterials: string;
  sampleContent?: string;
  styleProfile?: StyleProfile;
  detailLevel?: number;
  stylePreference?: number;
  targetWords?: number;
}

interface OverviewBoardPlan {
  title: BoardName;
  id: string;
  boardGoal: string;
  writingGuide: string;
  keyPoints: string[];
  transition: string;
}

interface OverviewResult {
  rootTitle: string;
  thesis: string;
  structure: OverviewBoardPlan[];
  overallLogic: string;
}

interface BoardResult {
  boardName: string;
  boardId: string;
  data: unknown;
  writingGuide: string;
  keyPoints: string[];
  targetChars?: number;
}

interface ReviewResult {
  boardName: string;
  passed: boolean;
  issues: string[];
  suggestions: string[];
  score: number;
}

interface BoardDraftReview {
  passed: boolean;
  score: number;
  contentQualityScore: number;
  ratioComplianceScore: number;
  explanationVoiceScore: number;
  issues: string[];
  suggestions: string[];
}

interface SourceProfiles {
  resumeProfile: ResumeProfile;
  programProfile: ProgramProfile;
}

interface Checkpoint {
  step: number;
  overview?: unknown;
  boardResults?: BoardResult[];
  reviewResults?: unknown;
  relationships?: unknown;
}

type CheckpointSaver = (checkpoint: Checkpoint) => Promise<void>;

const FALLBACK_IMAGE_KEYWORDS: Record<BoardName, string> = {
  '兴趣起源': 'student inspiration moment',
  '进阶思考': 'ai ethics concept',
  '能力匹配': 'team project collaboration',
  '心仪课程': 'university classroom study',
  '衷心求学': 'campus aspiration portrait',
};

class ClaudeService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.claude.apiKey || process.env.CLAUDE_API_KEY || '',
      baseURL: config.claude.baseURL || process.env.CLAUDE_BASE_URL,
      timeout: config.claude.timeout || 300000,
      maxRetries: config.claude.maxRetries || 3,
    });
  }

  async generateApplicationMindMap(
    applicationData: ApplicationData,
    onProgress?: (step: string, charCount: number) => void,
    checkpoint?: Checkpoint,
    onCheckpoint?: CheckpointSaver,
  ): Promise<MindMapData> {
    try {
      return await this.generateWithPipeline(applicationData, onProgress, checkpoint, onCheckpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ERROR] Generation failed:', message);
      throw error;
    }
  }

  private async generateWithPipeline(
    applicationData: ApplicationData,
    onProgress?: (step: string, charCount: number) => void,
    checkpoint?: Checkpoint,
    onCheckpoint?: CheckpointSaver,
  ): Promise<MindMapData> {
    const {
      schoolName,
      programName,
      websiteContent,
      userMaterials,
      sampleContent,
      detailLevel = 50,
      stylePreference = 50,
      targetWords = 1000,
    } = applicationData;

    const targetProjectName = [schoolName, programName].filter(Boolean).join('-') || '目标留学项目';
    const budgetPlan = wordBudgetService.buildPlan(targetWords);
    const styleProfile = applicationData.styleProfile ?? sampleStyleService.buildProfile(undefined, sampleContent || '');
    const styleBundle = sampleStyleService.buildPromptBundle(styleProfile);
    let cachedSourceProfiles: SourceProfiles | null = null;
    const ensureSourceProfiles = async (): Promise<SourceProfiles> => {
      if (cachedSourceProfiles) return cachedSourceProfiles;
      onProgress?.('材料解析AI', 0);
      const resumeProfile = await this.buildResumeProfile(userMaterials, (count) => onProgress?.('材料解析AI', count));
      onProgress?.('项目解析AI', 0);
      const programProfile = await this.buildProgramProfile(websiteContent, (count) => onProgress?.('项目解析AI', count));
      cachedSourceProfiles = { resumeProfile, programProfile };
      return cachedSourceProfiles;
    };

    let overview: OverviewResult;
    if (checkpoint?.step && checkpoint.step >= 1 && checkpoint.overview) {
      overview = checkpoint.overview as OverviewResult;
    } else {
      const sourceProfiles = await ensureSourceProfiles();
      await onCheckpoint?.({ step: 0, overview: undefined, boardResults: [], reviewResults: [], relationships: [] });
      onProgress?.('总览AI', 0);
      overview = await this.buildOverviewWithFallback({
        targetProjectName,
        websiteContent,
        userMaterials,
        sampleContent,
        budgetPlan,
        styleProfile,
        sourceProfiles,
        onProgress,
      });
      await onCheckpoint?.({ step: 1, overview });
    }

    let boardResults: BoardResult[];
    if (checkpoint?.step && checkpoint.step >= 2 && checkpoint.boardResults) {
      boardResults = checkpoint.boardResults;
    } else {
      const sourceProfiles = await ensureSourceProfiles();
      await onCheckpoint?.({ step: 1, overview, boardResults: [], reviewResults: [], relationships: [] });
      onProgress?.('板块生成', 0);
      boardResults = await this.mapWithConcurrency(
        budgetPlan.boards,
        1,
        async (boardBudget) => {
          const boardPlan = overview.structure.find((item) => item.title === boardBudget.boardName)
            || this.makeFallbackBoardPlan(boardBudget.boardName);
          return this.generateBoardResult({
            boardBudget,
            boardPlan,
            applicationData,
            targetProjectName,
            sampleContent,
            styleBundle,
            styleProfile,
            budgetPlan,
            detailLevel,
            stylePreference,
            sourceProfiles,
            onProgress: (count) => onProgress?.(`板块:${boardBudget.boardName}`, count),
          });
        },
      );
      await onCheckpoint?.({ step: 2, overview, boardResults });
    }

    let reviewResults: { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] };
    if (checkpoint?.step && checkpoint.step >= 3 && checkpoint.reviewResults) {
      reviewResults = checkpoint.reviewResults as typeof reviewResults;
    } else {
      await onCheckpoint?.({ step: 2, overview, boardResults, reviewResults: null, relationships: [] });
      onProgress?.('审稿AI', 0);
      reviewResults = await this.reviewBoards(boardResults, applicationData, budgetPlan, styleProfile, (count) =>
        onProgress?.('审稿AI', count),
      );
      await onCheckpoint?.({ step: 3, overview, boardResults, reviewResults });
    }

    let relationships: Relationship[];
    if (checkpoint?.step && checkpoint.step >= 4 && checkpoint.relationships) {
      relationships = checkpoint.relationships as Relationship[];
    } else {
      await onCheckpoint?.({ step: 3, overview, boardResults, reviewResults, relationships: [] });
      onProgress?.('关联识别AI', 0);
      relationships = await this.identifyRelationships(boardResults, reviewResults, (count) =>
        onProgress?.('关联识别AI', count),
      );
      await onCheckpoint?.({ step: 4, overview, boardResults, reviewResults, relationships });
    }

    const sourceProfiles = await ensureSourceProfiles();

    const finalResult = this.mergeFinalResult(targetProjectName, boardResults, relationships, {
      schoolName,
      programName,
      thesis: overview.thesis,
      overallLogic: overview.overallLogic,
      sampleContent,
      styleProfile,
      budgetPlan,
      resumeProfile: sourceProfiles.resumeProfile,
      programProfile: sourceProfiles.programProfile,
    });
    await onCheckpoint?.({ step: 5, overview, boardResults, reviewResults, relationships });
    return finalResult;
  }

  private async buildResumeProfile(
    userMaterials: string,
    onProgress?: (charCount: number) => void,
  ): Promise<ResumeProfile> {
    if (!userMaterials.trim()) {
      return {
        candidateSummary: '暂无可提炼的申请人材料。',
        education: [],
        experiences: [],
        projects: [],
        awards: [],
        motivations: [],
      };
    }

    const raw = await this.callAI({
      systemPrompt: '你是留学申请材料分析师。请把申请人材料整理成结构化画像，保留可直接写进文书的事实和反思。只输出JSON。',
      userPrompt: `请从以下申请人材料中提炼结构化画像，优先保留能支撑文书正文的事实单元，而不是流水账。

## 原始材料
${userMaterials}

## 输出JSON格式
{
  "candidateSummary": "2-4句，高密度总结申请人的主线、能力和动机",
  "education": [
    {
      "category": "education",
      "title": "经历名",
      "time": "时间",
      "action": "做了什么",
      "outcome": "结果",
      "metric": "数据或结果",
      "reflection": "这段经历如何影响申请方向",
      "rawSnippet": "原文摘录"
    }
  ],
  "experiences": [],
  "projects": [],
  "awards": [],
  "motivations": []
}

规则：
- 每个数组最多保留 3 条最有价值的信息
- reflection 优先写“为什么这件事会引向当前申请方向”
- rawSnippet 只需保留最关键的一句话
- 只输出JSON`,
      maxTokens: 3200,
      onProgress,
    });

    return this.normalizeResumeProfile(raw);
  }

  private async buildProgramProfile(
    websiteContent: string,
    onProgress?: (charCount: number) => void,
  ): Promise<ProgramProfile> {
    if (!websiteContent.trim()) {
      return {
        programSummary: '暂无可提炼的项目资料。',
        courses: [],
        faculty: [],
        labs: [],
        fitHooks: [],
      };
    }

    const raw = await this.callAI({
      systemPrompt: '你是留学项目分析师。请从官网材料中提炼项目画像和可用于文书匹配的抓手。只输出JSON。',
      userPrompt: `请从以下项目资料中提炼项目画像，重点提炼适合写进申请文书的 fit hooks。

## 原始资料
${websiteContent}

## 输出JSON格式
{
  "programSummary": "2-4句，概括项目的定位、核心训练方式和差异化",
  "courses": ["课程或模块"],
  "faculty": ["教授、导师或研究方向"],
  "labs": ["实验室、平台或特色资源"],
  "fitHooks": ["最适合在文书里对接申请人的具体抓手"]
}

规则：
- courses / faculty / labs 各最多 4 条
- fitHooks 保留 4-6 条，必须是具体抓手，不能只写“资源丰富”
- programSummary 要写出项目的训练重点和区分度
- 只输出JSON`,
      maxTokens: 2600,
      onProgress,
    });

    return this.normalizeProgramProfile(raw);
  }

  private buildOverviewPrompt(params: {
    targetProjectName: string;
    websiteContent: string;
    userMaterials: string;
    sampleContent?: string;
    budgetPlan: WordBudgetPlan;
    styleProfile: StyleProfile;
    sourceProfiles: SourceProfiles;
  }): string {
    const { targetProjectName, websiteContent, userMaterials, sampleContent, budgetPlan, styleProfile, sourceProfiles } = params;
    const websiteExcerpt = this.clipPromptText(websiteContent, 2200);
    const userExcerpt = this.clipPromptText(userMaterials, 2800);
    const sampleSection = sampleContent
      ? `\n## 参考样例摘录\n以下样例只用于提供风格与口吻锚点。请参考其思路密度和叙事节奏，不要照抄内容。\n${this.clipPromptText(sampleContent, 1800)}\n`
      : '';

    const boardNames = budgetPlan.boards.map((board) => board.boardName).join('、');
    return `请基于以下材料，为申请文书思维导图规划五大固定板块。

## 固定板块顺序
${boardNames}

## 正文预算
总正文预算：${budgetPlan.totalContentChars}字
${wordBudgetService.renderPlan(budgetPlan)}

## 风格总要求
- 正文风格：${styleProfile.contentVoice.tone}
- 解释风格：${styleProfile.explanationVoice.tone}
- 全局信号：${styleProfile.globalSignals.join('、') || '高密度叙事'}

## 申请人画像
${this.renderResumeProfile(sourceProfiles.resumeProfile)}

## 项目画像
${this.renderProgramProfile(sourceProfiles.programProfile)}

## 项目资料摘录
${websiteExcerpt || '无'}

## 申请人材料摘录
${userExcerpt || '无'}
${sampleSection}
## 任务
请输出五大固定板块的叙事规划，每个板块都要给出：
- title: 必须与固定板块名称完全一致
- id: UUID
- boardGoal: 这一板块要完成的叙事任务
- writingGuide: 明确写什么、怎么写、避开什么
- keyPoints: 3-5个必须覆盖的核心点
- transition: 与前后板块的衔接逻辑

## 输出JSON格式
{
  "rootTitle": "${targetProjectName}",
  "thesis": "整篇文书主命题",
  "structure": [
    {
      "title": "兴趣起源",
      "id": "UUID",
      "boardGoal": "......",
      "writingGuide": "......",
      "keyPoints": ["......"],
      "transition": "......"
    }
  ],
  "overallLogic": "五大板块如何递进"
}

只输出JSON。`;
  }

  private async buildOverviewWithFallback(params: {
    targetProjectName: string;
    websiteContent: string;
    userMaterials: string;
    sampleContent?: string;
    budgetPlan: WordBudgetPlan;
    styleProfile: StyleProfile;
    sourceProfiles: SourceProfiles;
    onProgress?: (step: string, charCount: number) => void;
  }): Promise<OverviewResult> {
    const {
      targetProjectName,
      websiteContent,
      userMaterials,
      sampleContent,
      budgetPlan,
      styleProfile,
      sourceProfiles,
      onProgress,
    } = params;

    try {
      const raw = await this.callAI({
        systemPrompt: '你是留学申请文书的总策划师。你负责先定叙事主线，再定五大板块的任务和过渡。只输出JSON。',
        userPrompt: this.buildOverviewPrompt({
          targetProjectName,
          websiteContent,
          userMaterials,
          sampleContent,
          budgetPlan,
          styleProfile,
          sourceProfiles,
        }),
        maxTokens: 2200,
        retries: 2,
        onProgress: (count) => onProgress?.('总览AI', count),
      });

      return this.normalizeOverview(raw as unknown as OverviewResult, targetProjectName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown overview error';
      console.warn(`[WARN] overview AI failed, falling back to local planning: ${message}`);
      onProgress?.('总览兜底规划', 0);
      return this.buildOverviewLocally(targetProjectName, sourceProfiles);
    }
  }

  private buildOverviewLocally(
    targetProjectName: string,
    sourceProfiles: SourceProfiles,
  ): OverviewResult {
    const { resumeProfile, programProfile } = sourceProfiles;
    const fallbackBoards = (['兴趣起源', '进阶思考', '能力匹配', '心仪课程', '衷心求学'] as BoardName[])
      .map((boardName) => this.makeFallbackBoardPlan(boardName));

    const interestSeed = this.pickFirstNonEmpty(
      resumeProfile.motivations[0]?.reflection,
      resumeProfile.motivations[0]?.title,
      resumeProfile.education[0]?.reflection,
      resumeProfile.education[0]?.title,
      resumeProfile.candidateSummary,
    );
    const thinkingSeed = this.pickFirstNonEmpty(
      resumeProfile.experiences[0]?.reflection,
      resumeProfile.projects[0]?.reflection,
      resumeProfile.education[0]?.reflection,
      resumeProfile.candidateSummary,
    );
    const abilitySeeds = this.uniqueCompact([
      resumeProfile.experiences[0]?.title,
      resumeProfile.projects[0]?.title,
      resumeProfile.experiences[1]?.title,
      resumeProfile.projects[1]?.title,
    ]).slice(0, 4);
    const programSeeds = this.uniqueCompact([
      programProfile.fitHooks[0],
      programProfile.fitHooks[1],
      programProfile.courses[0],
      programProfile.faculty[0],
      programProfile.labs[0],
    ]).slice(0, 4);
    const closingSeed = this.pickFirstNonEmpty(
      resumeProfile.motivations[0]?.title,
      resumeProfile.motivations[0]?.reflection,
      programProfile.fitHooks[0],
      resumeProfile.candidateSummary,
    );

    const boardMap = new Map<BoardName, OverviewBoardPlan>();
    for (const board of fallbackBoards) {
      if (board.title === '兴趣起源') {
        boardMap.set(board.title, {
          ...board,
          boardGoal: interestSeed
            ? `从“${this.shortenSeed(interestSeed)}”切入，写出兴趣如何自然走向当前申请方向。`
            : board.boardGoal,
          keyPoints: this.uniqueCompact([
            interestSeed,
            resumeProfile.education[0]?.title,
            resumeProfile.motivations[0]?.reflection,
            programProfile.fitHooks[0],
            ...board.keyPoints,
          ]).slice(0, 5),
        });
      } else if (board.title === '进阶思考') {
        boardMap.set(board.title, {
          ...board,
          boardGoal: thinkingSeed
            ? `从“${this.shortenSeed(thinkingSeed)}”继续推进，写清认知升级和问题意识。`
            : board.boardGoal,
          keyPoints: this.uniqueCompact([
            thinkingSeed,
            resumeProfile.experiences[0]?.reflection,
            resumeProfile.projects[0]?.reflection,
            programProfile.fitHooks[0],
            ...board.keyPoints,
          ]).slice(0, 5),
        });
      } else if (board.title === '能力匹配') {
        boardMap.set(board.title, {
          ...board,
          keyPoints: this.uniqueCompact([
            ...abilitySeeds,
            ...board.keyPoints,
          ]).slice(0, 5),
        });
      } else if (board.title === '心仪课程') {
        boardMap.set(board.title, {
          ...board,
          boardGoal: programSeeds.length > 0
            ? `点出项目中的具体资源，说明它们如何补上申请人的下一步能力缺口。`
            : board.boardGoal,
          keyPoints: this.uniqueCompact([
            ...programSeeds,
            ...board.keyPoints,
          ]).slice(0, 5),
        });
      } else if (board.title === '衷心求学') {
        boardMap.set(board.title, {
          ...board,
          boardGoal: closingSeed
            ? `围绕“${this.shortenSeed(closingSeed)}”完成收束，表达成熟而明确的求学落点。`
            : board.boardGoal,
          keyPoints: this.uniqueCompact([
            closingSeed,
            programProfile.fitHooks[0],
            resumeProfile.motivations[0]?.title,
            ...board.keyPoints,
          ]).slice(0, 5),
        });
      }
    }

    const structure = (['兴趣起源', '进阶思考', '能力匹配', '心仪课程', '衷心求学'] as BoardName[]).map((boardName) =>
      boardMap.get(boardName) || this.makeFallbackBoardPlan(boardName),
    );

    return {
      rootTitle: targetProjectName,
      thesis: this.pickFirstNonEmpty(
        `${resumeProfile.candidateSummary} 并与 ${programProfile.programSummary} 形成清晰匹配。`,
        '通过具体经历、认知推进与项目匹配，建立一条可信而有辨识度的申请叙事。',
      ),
      structure,
      overallLogic: '从兴趣起点写到认知升级，再写能力支撑、项目匹配与求学落点。',
    };
  }

  private normalizeOverview(raw: OverviewResult, targetProjectName: string): OverviewResult {
    const boardMap = new Map<string, OverviewBoardPlan>();
    for (const item of raw?.structure || []) {
      if (!item?.title) continue;
      boardMap.set(item.title, {
        title: item.title as BoardName,
        id: item.id || crypto.randomUUID(),
        boardGoal: item.boardGoal || item.writingGuide || '围绕板块主题建立完整叙事。',
        writingGuide: item.writingGuide || item.boardGoal || '写具体事实，避免空话。',
        keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints.filter(Boolean).slice(0, 5) : [],
        transition: item.transition || '与下一板块形成顺势推进。',
      });
    }

    const structure = (['兴趣起源', '进阶思考', '能力匹配', '心仪课程', '衷心求学'] as BoardName[]).map((boardName) =>
      boardMap.get(boardName) || this.makeFallbackBoardPlan(boardName),
    );

    return {
      rootTitle: raw?.rootTitle || targetProjectName,
      thesis: raw?.thesis || '通过具体经历、认知推进与项目匹配，建立一条可信而有辨识度的申请叙事。',
      structure,
      overallLogic: raw?.overallLogic || '从兴趣起点写到认知升级，再写能力支撑、项目匹配与求学落点。',
    };
  }

  private makeFallbackBoardPlan(boardName: BoardName): OverviewBoardPlan {
    const defaults: Record<BoardName, Omit<OverviewBoardPlan, 'title' | 'id'>> = {
      '兴趣起源': {
        boardGoal: '写出兴趣的具体起点，并展示它如何自然引向申请方向。',
        writingGuide: '用真实观察、场景或经历切入，不要用空泛热爱开头。',
        keyPoints: ['兴趣起点', '具体场景', '初步认知', '与项目方向的第一层呼应'],
        transition: '从兴趣萌发推进到更深入的问题意识。',
      },
      '进阶思考': {
        boardGoal: '展示认知升级、问题意识与更高阶的思考框架。',
        writingGuide: '从经历中抽出问题，再上升到方法、框架或价值判断。',
        keyPoints: ['认知升级', '问题意识', '方法或框架', '为什么必须继续深造'],
        transition: '由思考落到已经具备的能力与实践积累。',
      },
      '能力匹配': {
        boardGoal: '证明自己具备完成该项目所需的能力与实践基础。',
        writingGuide: '用挑战、行动、结果的结构，不要堆砌经历清单。',
        keyPoints: ['关键经历', '行动细节', '结果或数据', '可迁移能力'],
        transition: '由自身能力顺势转向为什么这个项目最合适。',
      },
      '心仪课程': {
        boardGoal: '说明课程、师资或项目资源如何精确补全申请人的下一步目标。',
        writingGuide: '必须点名项目资源，并说清能解决什么问题。',
        keyPoints: ['课程或资源', '与过往经历的连接', '与未来目标的连接'],
        transition: '由项目资源收束到诚恳而明确的求学动机。',
      },
      '衷心求学': {
        boardGoal: '完成收束，表达成熟、克制但坚定的求学意愿。',
        writingGuide: '真诚、自信，不要模板化致谢。',
        keyPoints: ['为什么是现在', '为什么是这个项目', '我能带来什么'],
        transition: '收束全文。',
      },
    };

    return {
      title: boardName,
      id: crypto.randomUUID(),
      ...defaults[boardName],
    };
  }

  private async generateBoardResult(params: {
    boardBudget: BoardBudget;
    boardPlan: OverviewBoardPlan;
    applicationData: ApplicationData;
    targetProjectName: string;
    sampleContent?: string;
    styleBundle: ReturnType<typeof sampleStyleService.buildPromptBundle>;
    styleProfile: StyleProfile;
    budgetPlan: WordBudgetPlan;
    detailLevel: number;
    stylePreference: number;
    sourceProfiles: SourceProfiles;
    onProgress?: (charCount: number) => void;
  }): Promise<BoardResult> {
    const {
      boardBudget,
      boardPlan,
      applicationData,
      sampleContent,
      styleBundle,
      styleProfile,
      detailLevel,
      stylePreference,
      sourceProfiles,
      onProgress,
    } = params;

    const prompt = this.buildBoardDraftPrompt({
      boardBudget,
      boardPlan,
      applicationData,
      sampleContent,
      styleBundle,
      styleProfile,
      detailLevel,
      stylePreference,
      sourceProfiles,
    });

    const rawDraft = await this.callAI({
      systemPrompt: '你是申请文书写作师。你的任务是先写高质量正文草稿，再生成解释节点与总结。只输出JSON。',
      userPrompt: prompt,
      maxTokens: Math.max(3500, Math.round(boardBudget.targetChars * 10)),
      onProgress,
    });

    let draft = this.normalizeBoardDraft(rawDraft, boardBudget, boardPlan);
    draft = await this.polishBoardDraft({
      draft,
      boardBudget,
      boardPlan,
      applicationData,
      styleBundle,
      styleProfile,
      sourceProfiles,
      onProgress,
    });

    return {
      boardName: boardBudget.boardName,
      boardId: boardPlan.id || crypto.randomUUID(),
      data: this.projectBoardDraft(boardBudget, boardPlan, draft, styleProfile),
      writingGuide: boardPlan.writingGuide,
      keyPoints: boardPlan.keyPoints,
      targetChars: boardBudget.targetChars,
    };
  }

  private buildBoardDraftPrompt(params: {
    boardBudget: BoardBudget;
    boardPlan: OverviewBoardPlan;
    applicationData: ApplicationData;
    sampleContent?: string;
    styleBundle: ReturnType<typeof sampleStyleService.buildPromptBundle>;
    styleProfile: StyleProfile;
    detailLevel: number;
    stylePreference: number;
    sourceProfiles: SourceProfiles;
  }): string {
    const {
      boardBudget,
      boardPlan,
      applicationData,
      sampleContent,
      styleBundle,
      styleProfile,
      detailLevel,
      stylePreference,
      sourceProfiles,
    } = params;

    const detailInstruction = detailLevel >= 70
      ? '正文要写得更饱满，细节更足，但仍须守住节点预算。'
      : detailLevel <= 30
        ? '正文要更凝练，但不能牺牲具体性。'
        : '正文保持标准细节密度。';

    const styleAdjustment = stylePreference >= 70
      ? '整体语言更偏直接、落地、结果导向。'
      : stylePreference <= 30
        ? '整体语言可适度提高抽象思辨密度。'
        : '整体语言兼顾叙事性与分析性。';

    const sampleSection = sampleContent
      ? `\n## 样例原文锚点\n${sampleContent}\n`
      : '';

    const nodeBudgetText = boardBudget.nodeBudgets
      .map((budget, index) => `${index + 1}. 正文节点${index + 1} 不超过 ${budget} 字`)
      .join('\n');

    return `请为「${boardBudget.boardName}」板块生成中间草稿，而不是直接生成导图结构。

## 板块任务
- boardGoal: ${boardPlan.boardGoal}
- writingGuide: ${boardPlan.writingGuide}
- transition: ${boardPlan.transition}

## 必须覆盖的核心点
${boardPlan.keyPoints.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## 正文预算
- 本板块正文总预算：${boardBudget.targetChars} 字
- 正文节点数量：${boardBudget.nodeCount} 个
${nodeBudgetText}
- 解释节点和板块总结不计入正文预算

## 风格硬要求
${styleBundle.contentInstruction}
${styleBundle.explanationInstruction}
${styleBundle.summaryInstruction}

## 风格补充说明
- 正文优先模仿样例中的正文腔：${styleProfile.contentVoice.tone}
- 解释必须模仿样例中的顾问口吻：${styleProfile.explanationVoice.preferredAddress ? `优先使用“${styleProfile.explanationVoice.preferredAddress}”称呼，` : ''}${styleProfile.explanationVoice.tone}
- ${detailInstruction}
- ${styleAdjustment}

## 项目资料
${applicationData.websiteContent}

## 申请人画像
${this.renderResumeProfile(sourceProfiles.resumeProfile)}

## 项目画像
${this.renderProgramProfile(sourceProfiles.programProfile)}

## 申请人材料
${applicationData.userMaterials}
${sampleSection}
## 输出JSON格式
{
  "boardThesis": "这一板块的中心论点",
  "contentItems": [
    {
      "content": "面向招生官的正文段落，不超过对应预算",
      "explanation": "面向学生的解释，2-4句话，解释这段为什么这样写、如何贴项目、如何承接",
      "imageKeyword": "english keyword",
      "visualHint": "给图片节点看的简短提示"
    }
  ],
  "summary": "一句到两句的板块收束"
}

## 额外规则
- contentItems 数量必须严格等于 ${boardBudget.nodeCount}
- 每个 content 必须尽量贴近对应预算，不要明显偏短
- 正文必须具体，不能写成履历罗列
- 解释不要重复正文，要解释“写作意图”和“叙事功能”
- imageKeyword 用英文短词，2-6个词即可
- 只输出JSON`;
  }

  private normalizeBoardDraft(raw: Record<string, unknown>, boardBudget: BoardBudget, boardPlan: OverviewBoardPlan): SectionDraft {
    const items = Array.isArray(raw.contentItems) ? raw.contentItems : [];
    const contentItems: BoardDraftItem[] = boardBudget.nodeBudgets.map((budget, index) => {
      const source = (items[index] || items[items.length - 1] || {}) as Record<string, unknown>;
      const fallbackPoint = boardPlan.keyPoints[index] || boardPlan.keyPoints[0] || boardPlan.boardGoal;
      const content = this.cleanText(
        String(source.content || source.title || fallbackPoint || boardPlan.writingGuide),
      );
      const explanation = this.cleanText(
        String(source.explanation || `${boardPlan.transition} 这段用来完成板块任务，不要写成经历堆叠。`),
      );
      const visualHint = this.cleanText(String(source.visualHint || fallbackPoint || boardBudget.boardName));
      return {
        content: wordBudgetService.truncateToBudget(content, budget),
        explanation,
        imageKeyword: this.cleanImageKeyword(String(source.imageKeyword || ''), boardBudget.boardName),
        visualHint,
      };
    });

    const summaryText = this.cleanText(String(raw.summary || boardPlan.transition || boardPlan.boardGoal));
    return {
      boardName: boardBudget.boardName,
      boardThesis: this.cleanText(String(raw.boardThesis || boardPlan.boardGoal)),
      targetChars: boardBudget.targetChars,
      contentItems,
      summary: summaryText,
    };
  }

  private async rebalanceBoardDraft(
    draft: SectionDraft,
    boardBudget: BoardBudget,
    boardPlan: OverviewBoardPlan,
    applicationData: ApplicationData,
    styleBundle: ReturnType<typeof sampleStyleService.buildPromptBundle>,
    sourceProfiles: SourceProfiles,
    onProgress?: (charCount: number) => void,
  ): Promise<SectionDraft> {
    const prompt = `请在保持原意与风格的前提下，重新平衡这一板块的正文长度，使其更贴近预算。

## 当前草稿
${JSON.stringify(draft, null, 2)}

## 预算要求
- 板块：${boardBudget.boardName}
- 正文总预算：${boardBudget.targetChars} 字
- 节点预算：${boardBudget.nodeBudgets.join(' / ')}

## 板块写作要求
- boardGoal: ${boardPlan.boardGoal}
- writingGuide: ${boardPlan.writingGuide}
- keyPoints: ${boardPlan.keyPoints.join('；')}

## 风格要求
${styleBundle.contentInstruction}
${styleBundle.explanationInstruction}

## 项目资料
${applicationData.websiteContent}

## 申请人画像
${this.renderResumeProfile(sourceProfiles.resumeProfile)}

## 项目画像
${this.renderProgramProfile(sourceProfiles.programProfile)}

## 规则
- 只微调 contentItems[*].content 的长度与句子组织
- explanation、summary、imageKeyword、visualHint 尽量保持
- 每个 content 尽量贴近各自预算，不要明显不足
- 只输出 JSON，结构保持不变`;

    const raw = await this.callAI({
      systemPrompt: '你是申请文书的文字调速器。你只负责在保持内容质量的前提下，把正文长度调到预算附近。只输出JSON。',
      userPrompt: prompt,
      maxTokens: Math.max(2500, Math.round(boardBudget.targetChars * 8)),
      onProgress,
    });

    return this.normalizeBoardDraft(raw, boardBudget, boardPlan);
  }

  private async polishBoardDraft(params: {
    draft: SectionDraft;
    boardBudget: BoardBudget;
    boardPlan: OverviewBoardPlan;
    applicationData: ApplicationData;
    styleBundle: ReturnType<typeof sampleStyleService.buildPromptBundle>;
    styleProfile: StyleProfile;
    sourceProfiles: SourceProfiles;
    onProgress?: (charCount: number) => void;
  }): Promise<SectionDraft> {
    const { boardBudget, boardPlan, applicationData, styleBundle, styleProfile, sourceProfiles, onProgress } = params;
    let working = params.draft;

    for (let round = 1; round <= 2; round += 1) {
      const compliance = wordBudgetService.measureBoardCompliance(
        boardBudget.boardName,
        boardBudget.targetChars,
        working.contentItems.map((item) => item.content),
      );

      if (!compliance.withinTolerance) {
        working = await this.rebalanceBoardDraft(
          working,
          boardBudget,
          boardPlan,
          applicationData,
          styleBundle,
          sourceProfiles,
          onProgress,
        );
      }

      const review = await this.reviewBoardDraft(working, boardBudget, boardPlan, styleProfile, onProgress);
      if (review.passed) {
        return this.attachReviewIssues(working, review.issues);
      }

      working = await this.rewriteBoardDraft({
        draft: working,
        review,
        boardBudget,
        boardPlan,
        applicationData,
        styleBundle,
        styleProfile,
        sourceProfiles,
        onProgress,
      });
    }

    const finalReview = await this.reviewBoardDraft(working, boardBudget, boardPlan, styleProfile, onProgress);
    return this.attachReviewIssues(working, finalReview.issues);
  }

  private async reviewBoardDraft(
    draft: SectionDraft,
    boardBudget: BoardBudget,
    boardPlan: OverviewBoardPlan,
    styleProfile: StyleProfile,
    onProgress?: (charCount: number) => void,
  ): Promise<BoardDraftReview> {
    const compliance = wordBudgetService.measureBoardCompliance(
      boardBudget.boardName,
      boardBudget.targetChars,
      draft.contentItems.map((item) => item.content),
    );

    const prompt = `请审核这个板块草稿是否达到发布标准。

## 板块信息
- 板块：${boardBudget.boardName}
- boardGoal：${boardPlan.boardGoal}
- writingGuide：${boardPlan.writingGuide}
- keyPoints：${boardPlan.keyPoints.join('；')}

## 风格标准
- 正文目标：${styleProfile.contentVoice.tone}
- 解释目标：${styleProfile.explanationVoice.tone}
- 解释偏好称呼：${styleProfile.explanationVoice.preferredAddress || '无固定称呼'}

## 正文预算
- 板块总预算：${boardBudget.targetChars}
- 节点预算：${boardBudget.nodeBudgets.join(' / ')}
- 当前正文统计：${compliance.actualChars}
- 偏差：${compliance.deltaChars}

## 当前草稿
${JSON.stringify(draft, null, 2)}

## 审核重点
1. 正文是否具体、有画面、有推进，不像简历复述
2. 正文是否与板块任务对齐
3. explanation 是否是顾问解释口吻，是否像样例里的“她”
4. 字数比例是否基本准确
5. 是否存在套话、空话、重复

## 输出JSON格式
{
  "passed": true,
  "score": 88,
  "contentQualityScore": 90,
  "ratioComplianceScore": 86,
  "explanationVoiceScore": 87,
  "issues": ["..."],
  "suggestions": ["..."]
}

规则：
- 只有在三个分项都至少 84 且没有明显硬伤时，passed 才能为 true
- 只输出JSON`;

    const raw = await this.callAI({
      systemPrompt: '你是申请文书单板块审核师。只输出JSON。',
      userPrompt: prompt,
      maxTokens: 2500,
      onProgress,
    });

    const score = this.asScore(raw.score, 75);
    const contentQualityScore = this.asScore(raw.contentQualityScore, 75);
    const ratioComplianceScore = this.asScore(raw.ratioComplianceScore, compliance.withinTolerance ? 88 : 70);
    const explanationVoiceScore = this.asScore(raw.explanationVoiceScore, 75);
    const issues = this.asStringArray(raw.issues);
    const suggestions = this.asStringArray(raw.suggestions);

    return {
      passed: Boolean(raw.passed) && score >= 84 && contentQualityScore >= 84 && ratioComplianceScore >= 84 && explanationVoiceScore >= 84,
      score,
      contentQualityScore,
      ratioComplianceScore,
      explanationVoiceScore,
      issues,
      suggestions,
    };
  }

  private async rewriteBoardDraft(params: {
    draft: SectionDraft;
    review: BoardDraftReview;
    boardBudget: BoardBudget;
    boardPlan: OverviewBoardPlan;
    applicationData: ApplicationData;
    styleBundle: ReturnType<typeof sampleStyleService.buildPromptBundle>;
    styleProfile: StyleProfile;
    sourceProfiles: SourceProfiles;
    onProgress?: (charCount: number) => void;
  }): Promise<SectionDraft> {
    const { draft, review, boardBudget, boardPlan, applicationData, styleBundle, styleProfile, sourceProfiles, onProgress } = params;

    const prompt = `请根据审核问题重写这个板块草稿，优先修正文质量、字数偏差和 explanation 口吻。

## 当前草稿
${JSON.stringify(draft, null, 2)}

## 审核问题
${review.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') || '无'}

## 修改建议
${review.suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}

## 板块要求
- 板块：${boardBudget.boardName}
- boardGoal：${boardPlan.boardGoal}
- writingGuide：${boardPlan.writingGuide}
- transition：${boardPlan.transition}
- keyPoints：${boardPlan.keyPoints.join('；')}

## 正文预算
- 总预算：${boardBudget.targetChars}
- 节点预算：${boardBudget.nodeBudgets.join(' / ')}

## 风格约束
${styleBundle.contentInstruction}
${styleBundle.explanationInstruction}
${styleBundle.summaryInstruction}

## 风格补充
- 正文必须继续保持：${styleProfile.contentVoice.tone}
- explanation 必须继续保持：${styleProfile.explanationVoice.tone}

## 项目资料
${applicationData.websiteContent}

## 申请人画像
${this.renderResumeProfile(sourceProfiles.resumeProfile)}

## 项目画像
${this.renderProgramProfile(sourceProfiles.programProfile)}

## 用户材料
${applicationData.userMaterials}

## 输出JSON格式
{
  "boardThesis": "保持或优化后的中心论点",
  "contentItems": [
    {
      "content": "重写后的正文",
      "explanation": "重写后的解释",
      "imageKeyword": "english keyword",
      "visualHint": "visual hint"
    }
  ],
  "summary": "重写后的总结"
}

规则：
- 必须保留 contentItems 数量
- 每个 content 尽量贴近各自预算
- explanation 不重复正文，要解释这段的写作策略
- 只输出JSON`;

    const raw = await this.callAI({
      systemPrompt: '你是申请文书重写师。你负责按审核问题定向重写板块草稿。只输出JSON。',
      userPrompt: prompt,
      maxTokens: Math.max(3000, Math.round(boardBudget.targetChars * 8)),
      onProgress,
    });

    return this.normalizeBoardDraft(raw, boardBudget, boardPlan);
  }

  private attachReviewIssues(draft: SectionDraft, issues: string[]): SectionDraft {
    const cleanedIssues = issues.filter(Boolean).slice(0, 4);
    return {
      ...draft,
      contentItems: draft.contentItems.map((item) => ({
        ...item,
        reviewIssues: cleanedIssues,
      })),
      reviewIssues: cleanedIssues,
    } as SectionDraft;
  }

  private projectBoardDraft(
    boardBudget: BoardBudget,
    boardPlan: OverviewBoardPlan,
    draft: SectionDraft,
    styleProfile: StyleProfile,
  ): Record<string, unknown> {
    const siblingContents = draft.contentItems.map((candidate) => candidate.content);
    const contentChildren: MindMapNode[] = draft.contentItems.map((item, index) => ({
      title: item.content,
      type: 'content',
      id: crypto.randomUUID(),
      meta: {
        boardName: boardBudget.boardName,
        boardGoal: boardPlan.boardGoal,
        boardThesis: draft.boardThesis,
        boardBudget: boardBudget.targetChars,
        nodeBudget: boardBudget.nodeBudgets[index],
        voiceRole: 'content',
        styleTone: styleProfile.contentVoice.tone,
        writingGuide: boardPlan.writingGuide,
        transition: boardPlan.transition,
        keyPoints: boardPlan.keyPoints,
        siblingContents,
        visualHint: item.visualHint,
        sampleAnchors: styleProfile.contentVoice.anchorExamples,
        reviewIssues: item.reviewIssues || draft.reviewIssues,
      },
      children: [
        {
          title: item.explanation,
          type: 'explanation',
          id: crypto.randomUUID(),
          meta: {
            boardName: boardBudget.boardName,
            boardGoal: boardPlan.boardGoal,
            boardThesis: draft.boardThesis,
            boardBudget: boardBudget.targetChars,
            nodeBudget: boardBudget.nodeBudgets[index],
            voiceRole: 'explanation',
            styleTone: styleProfile.explanationVoice.tone,
            preferredAddress: styleProfile.explanationVoice.preferredAddress,
            writingGuide: boardPlan.writingGuide,
            transition: boardPlan.transition,
            keyPoints: boardPlan.keyPoints,
            siblingContents,
            visualHint: item.visualHint,
            sampleAnchors: styleProfile.explanationVoice.anchorExamples,
            reviewIssues: item.reviewIssues || draft.reviewIssues,
          },
          children: [
            {
              title: item.visualHint || '配图参考',
              imageKeyword: item.imageKeyword,
              meta: {
                boardName: boardBudget.boardName,
                boardGoal: boardPlan.boardGoal,
                boardThesis: draft.boardThesis,
                voiceRole: 'explanation',
                visualHint: item.visualHint,
              },
              children: [],
            },
          ],
        },
      ],
    }));

    contentChildren.push({
      title: `板块总结：${draft.summary}`,
      type: 'explanation',
      id: crypto.randomUUID(),
      meta: {
        boardName: boardBudget.boardName,
        boardGoal: boardPlan.boardGoal,
        boardThesis: draft.boardThesis,
        boardBudget: boardBudget.targetChars,
        voiceRole: 'summary',
        styleTone: styleProfile.summaryVoice.tone,
        writingGuide: boardPlan.writingGuide,
        transition: boardPlan.transition,
        keyPoints: boardPlan.keyPoints,
        sampleAnchors: styleProfile.summaryVoice.anchorExamples,
        reviewIssues: draft.reviewIssues,
      },
      children: [],
    });

    return {
      title: boardBudget.boardName,
      type: 'content',
      id: crypto.randomUUID(),
      meta: {
        boardName: boardBudget.boardName,
        boardGoal: boardPlan.boardGoal,
        boardThesis: draft.boardThesis,
        boardBudget: boardBudget.targetChars,
        voiceRole: 'content',
        styleTone: styleProfile.contentVoice.tone,
        writingGuide: boardPlan.writingGuide,
        transition: boardPlan.transition,
        keyPoints: boardPlan.keyPoints,
        sampleAnchors: styleProfile.contentVoice.anchorExamples,
        reviewIssues: draft.reviewIssues,
      },
      children: contentChildren,
    };
  }

  private async reviewBoards(
    boardResults: BoardResult[],
    applicationData: ApplicationData,
    budgetPlan: WordBudgetPlan,
    styleProfile: StyleProfile,
    onProgress?: (charCount: number) => void,
  ): Promise<{ reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] }> {
    const budgetReport = budgetPlan.boards.map((board) => {
      const boardData = boardResults.find((item) => item.boardName === board.boardName)?.data as { children?: MindMapNode[] } | undefined;
      const contentTitles = (boardData?.children || [])
        .filter((node) => node.type === 'content')
        .map((node) => node.title);
      const compliance = wordBudgetService.measureBoardCompliance(board.boardName, board.targetChars, contentTitles);
      return `${board.boardName}: 预算${compliance.expectedChars}字，实际${compliance.actualChars}字，偏差${compliance.deltaChars}字`;
    }).join('\n');

    const reviewPrompt = `你是留学申请文书审核师。请审核五大板块的内容质量、字数比例和解释口吻。

## 审核重点
1. 正文是否具体、可信、有叙事推进，而不是简历复述
2. 板块之间是否顺畅递进
3. 正文字数是否基本符合预算
4. explanation 是否像样例里的顾问口吻，而不是正文腔
5. 是否存在模板套话

## 风格目标
- 正文目标：${styleProfile.contentVoice.tone}
- 解释目标：${styleProfile.explanationVoice.tone}
- 偏好称呼：${styleProfile.explanationVoice.preferredAddress || '无明确称呼'}

## 预算报告
${budgetReport}

## 板块内容
${boardResults.map((board) => `### ${board.boardName}\n${JSON.stringify(board.data, null, 2)}`).join('\n\n')}

## 申请人材料
${applicationData.userMaterials}

## 输出JSON格式
{
  "reviews": [
    {
      "boardName": "兴趣起源",
      "passed": true,
      "issues": ["..."],
      "suggestions": ["..."],
      "score": 85
    }
  ],
  "overallScore": 85,
  "overallIssues": ["..."],
  "overallSuggestions": ["..."]
}

只输出JSON。`;

    return (await this.callAI({
      systemPrompt: '你是申请文书质量审核师。只输出JSON。',
      userPrompt: reviewPrompt,
      onProgress,
    })) as unknown as { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] };
  }

  private extractAllNodeTitles(boardResults: BoardResult[]): Array<{ board: string; title: string; id: string }> {
    const allNodes: Array<{ board: string; title: string; id: string }> = [];

    const walk = (nodes: MindMapNode[] | undefined, board: string) => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (node?.title) {
          allNodes.push({
            board,
            title: node.title,
            id: node.id || '',
          });
        }
        walk(node.children, board);
      }
    };

    for (const board of boardResults) {
      const data = board.data as { children?: MindMapNode[] } | undefined;
      walk(data?.children, board.boardName);
    }

    return allNodes;
  }

  private async identifyRelationships(
    boardResults: BoardResult[],
    reviewResults: { reviews: ReviewResult[]; overallScore: number; overallIssues: string[]; overallSuggestions: string[] },
    onProgress?: (charCount: number) => void,
  ): Promise<Relationship[]> {
    const allNodes = this.extractAllNodeTitles(boardResults);
    const nodeListText = allNodes.map((node) => `[${node.board}] ${node.title}`).join('\n');

    const prompt = `你是申请文书关联分析师。请识别跨板块的强逻辑呼应关系。

## 实际节点列表
${nodeListText}

## 审稿反馈
${JSON.stringify(reviewResults, null, 2)}

## 规则
- 只能使用上面已存在的完整节点标题
- 只保留真正有意义的跨板块呼应
- 优先连接“兴趣起源 -> 进阶思考 -> 能力匹配 -> 心仪课程 -> 衷心求学”之间的递进关系

## 输出JSON格式
{
  "relationships": [
    {
      "id": "UUID",
      "end1Board": "兴趣起源",
      "end1Title": "完整标题",
      "end2Board": "进阶思考",
      "end2Title": "完整标题",
      "title": "逻辑呼应",
      "linePattern": "dash"
    }
  ]
}

只输出JSON。`;

    const result = (await this.callAI({
      systemPrompt: '你是申请文书关联分析师。只输出JSON。',
      userPrompt: prompt,
      onProgress,
    })) as unknown as { relationships?: Relationship[] };

    const candidates = result.relationships || [];
    const valid: Relationship[] = [];
    for (const relationship of candidates) {
      const left = allNodes.find((node) => node.title === relationship.end1Title);
      const right = allNodes.find((node) => node.title === relationship.end2Title);
      if (left && right) {
        valid.push({
          ...relationship,
          id: relationship.id || crypto.randomUUID(),
        });
      }
    }
    return valid;
  }

  private mergeFinalResult(
    targetProjectName: string,
    boardResults: BoardResult[],
    relationships: Relationship[],
    generationMeta: MindMapData['generationMeta'],
  ): MindMapData {
    const structure = boardResults.map((board) => {
      const boardData = board.data as MindMapNode;
      return {
        title: board.boardName,
        id: board.boardId,
        type: 'content',
        meta: boardData.meta,
        children: boardData.children || [],
      } as MindMapNode;
    });

    return {
      rootTitle: targetProjectName,
      structure,
      relationships,
      generationMeta,
    };
  }

  private normalizeResumeProfile(raw: Record<string, unknown>): ResumeProfile {
    return {
      candidateSummary: this.cleanText(String(raw.candidateSummary || '申请人具备一定的经历与动机基础，但仍需在正文中进一步展开。')),
      education: this.normalizeEvidenceList(raw.education, 'resume', 'education'),
      experiences: this.normalizeEvidenceList(raw.experiences, 'resume', 'experience'),
      projects: this.normalizeEvidenceList(raw.projects, 'resume', 'project'),
      awards: this.normalizeEvidenceList(raw.awards, 'resume', 'award'),
      motivations: this.normalizeEvidenceList(raw.motivations, 'user', 'motivation'),
    };
  }

  private normalizeProgramProfile(raw: Record<string, unknown>): ProgramProfile {
    return {
      programSummary: this.cleanText(String(raw.programSummary || '项目强调系统训练与明确的方向匹配。')),
      courses: this.asStringArray(raw.courses).slice(0, 4),
      faculty: this.asStringArray(raw.faculty).slice(0, 4),
      labs: this.asStringArray(raw.labs).slice(0, 4),
      fitHooks: this.asStringArray(raw.fitHooks).slice(0, 6),
    };
  }

  private normalizeEvidenceList(
    value: unknown,
    source: EvidenceAtom['source'],
    fallbackCategory: string,
  ): EvidenceAtom[] {
    if (!Array.isArray(value)) return [];

    const results: EvidenceAtom[] = [];
    value.slice(0, 3).forEach((item, index) => {
        const record = (item || {}) as Record<string, unknown>;
        const title = this.cleanText(String(record.title || record.rawSnippet || `${fallbackCategory}-${index + 1}`));
        if (!title) return;
        results.push({
          id: crypto.randomUUID(),
          source,
          category: this.cleanText(String(record.category || fallbackCategory)) || fallbackCategory,
          title,
          time: this.cleanText(String(record.time || '')) || undefined,
          action: this.cleanText(String(record.action || '')) || undefined,
          outcome: this.cleanText(String(record.outcome || '')) || undefined,
          metric: this.cleanText(String(record.metric || '')) || undefined,
          reflection: this.cleanText(String(record.reflection || '')) || undefined,
          rawSnippet: this.cleanText(String(record.rawSnippet || title)),
        });
      });

    return results;
  }

  private renderResumeProfile(profile: ResumeProfile): string {
    const highlightLines = [
      ...profile.education.slice(0, 1),
      ...profile.experiences.slice(0, 2),
      ...profile.projects.slice(0, 2),
      ...profile.motivations.slice(0, 1),
    ]
      .slice(0, 5)
      .map((item) => {
        const parts = [item.title, item.action, item.outcome, item.reflection].filter(Boolean);
        return `- ${parts.join('；')}`;
      });

    return [
      `- candidateSummary: ${profile.candidateSummary || '无'}`,
      ...highlightLines,
    ].join('\n');
  }

  private renderProgramProfile(profile: ProgramProfile): string {
    return [
      `- programSummary: ${profile.programSummary || '无'}`,
      `- fitHooks: ${(profile.fitHooks || []).join('；') || '无'}`,
      `- courses: ${(profile.courses || []).join('；') || '无'}`,
      `- faculty: ${(profile.faculty || []).join('；') || '无'}`,
      `- labs: ${(profile.labs || []).join('；') || '无'}`,
    ].join('\n');
  }

  private clipPromptText(text: string, limit: number): string {
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    if (cleaned.length <= limit) return cleaned;
    return `${cleaned.slice(0, limit)}……`;
  }

  private uniqueCompact(items: Array<string | undefined | null>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const cleaned = this.cleanText(String(item || ''));
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      result.push(cleaned);
    }
    return result;
  }

  private pickFirstNonEmpty(...items: Array<string | undefined | null>): string {
    for (const item of items) {
      const cleaned = this.cleanText(String(item || ''));
      if (cleaned) return cleaned;
    }
    return '';
  }

  private shortenSeed(text: string, limit = 28): string {
    const cleaned = this.cleanText(text);
    if (cleaned.length <= limit) return cleaned;
    return `${cleaned.slice(0, limit)}…`;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let currentIndex = 0;
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));

    const runWorker = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex;
        currentIndex += 1;
        results[index] = await worker(items[index], index);
      }
    };

    await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
    return results;
  }

  private cleanText(text: string): string {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  private cleanImageKeyword(keyword: string, boardName: BoardName): string {
    const cleaned = (keyword || '')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return cleaned || FALLBACK_IMAGE_KEYWORDS[boardName];
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  private asScore(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private async callAI(params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    retries?: number;
    onProgress?: (charCount: number) => void;
  }): Promise<Record<string, unknown>> {
    const { systemPrompt, userPrompt, maxTokens = 6000, retries = 6, onProgress } = params;
    let lastError: Error | undefined;
    let lastResponseText = '';
    const modelCandidates = this.getModelCandidates();

    const apiKey = config.claude.apiKey || process.env.CLAUDE_API_KEY || '';
    const baseURL = (config.claude.baseURL || process.env.CLAUDE_BASE_URL || 'https://api.asxs.top/v1').replace(/\/+$/, '');
    const responsesURL = `${baseURL}/responses`;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const requestTimeout = setTimeout(() => controller.abort(), 300_000);
      const model = modelCandidates[Math.min(attempt - 1, modelCandidates.length - 1)];
      const heartbeatTimer = setInterval(() => {
        try { onProgress?.(0); } catch { /* ignore */ }
      }, 8_000);

      console.log(`[DEBUG] 请求地址: ${responsesURL}`);
      console.log(`[DEBUG] 使用模型: ${model}`);
      console.log(`[DEBUG] max_output_tokens: ${maxTokens}`);

      // 限制单条请求中 userPrompt 最大 80000 字符，防止请求体过大导致连接被切断
      const safeUserPrompt = userPrompt.length > 80000 ? `${userPrompt.slice(0, 80000)}\n\n[内容过长已被自动截断]` : userPrompt;

      try {
        const httpRes = await fetch(responsesURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            instructions: systemPrompt,
            input: [{ role: 'user', content: [{ type: 'input_text', text: safeUserPrompt }] }],
            store: false,
            stream: true,
            include: ['reasoning.encrypted_content'],
            max_output_tokens: maxTokens,
          }),
          signal: controller.signal,
        });

        if (!httpRes.ok) {
          const errText = await httpRes.text();
          throw new Error(`HTTP ${httpRes.status}: ${errText.slice(0, 500)}`);
        }

        // 手动解析 SSE 流
        const reader = httpRes.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let sseBuffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const evt = JSON.parse(data) as { type?: string; delta?: string };
                if (evt.type === 'response.output_text.delta') {
                  fullText += evt.delta ?? '';
                  try { onProgress?.(fullText.length); } catch { /* ignore */ }
                }
              } catch { /* ignore malformed SSE lines */ }
            }
          }
        } catch (streamErr) {
          // 服务器中途切断连接，如果已收到足够内容则尝试使用
          if (fullText.length > 200) {
            console.warn(`[WARN] 流中断 (已收到 ${fullText.length} 字符), 尝试解析已收内容...`);
          } else {
            throw streamErr;
          }
        }

        lastResponseText = fullText;
        console.log(`[DEBUG] 模型返回 (stream完成, chars=${fullText.length}):`);
        if (fullText.length === 0) {
          console.log('[DEBUG] 响应内容为空');
        } else {
          const chunkSize = 2000;
          const chunkCount = Math.ceil(fullText.length / chunkSize);
          for (let i = 0; i < chunkCount; i += 1) {
            console.log(`[DEBUG] 响应分段 ${i + 1}/${chunkCount}:`);
            console.log(fullText.slice(i * chunkSize, Math.min((i + 1) * chunkSize, fullText.length)));
          }
        }
        return this.parseJSON(fullText);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        const currentError = lastError;
        const preview = lastResponseText.trim().slice(0, 300);
        console.warn(`[WARN] AI call failed (attempt ${attempt}/${retries}, model=${model}): ${currentError.message}`);
        if (preview) {
          console.warn(`[WARN] Partial response preview: ${preview}`);
        }
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, this.getRetryDelayMs(currentError, attempt)));
        }
      } finally {
        clearInterval(heartbeatTimer);
        clearTimeout(requestTimeout);
      }
    }

    throw new Error(`AI call failed after ${retries} attempts: ${lastError?.message}`);
  }

  private parseJSON(responseText: string): Record<string, unknown> {
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      return this.tryParse(codeBlockMatch[1]);
    }

    const trimmed = responseText.trim();
    const fullMatch = trimmed.match(/\{[\s\S]*\}\s*$/);
    if (fullMatch) {
      return this.tryParse(fullMatch[0]);
    }

    const lastValid = Math.max(trimmed.lastIndexOf('},'), trimmed.lastIndexOf('}]'));
    if (lastValid > 100) {
      const truncated = trimmed.slice(0, lastValid + 1);
      try {
        return this.tryParse(truncated);
      } catch {
        // fall through to final parse attempt
      }
    }

    return this.tryParse(trimmed);
  }

  private tryParse(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text);
    } catch {
      try {
        const repaired = jsonrepair(text);
        return JSON.parse(repaired);
      } catch (error) {
        throw new Error(`JSON parse failed: ${(error as Error).message} | text length: ${text.length}`);
      }
    }
  }

  private getModelCandidates(): string[] {
    return Array.from(new Set([
      config.claude.model,
      process.env.CLAUDE_FALLBACK_MODEL,
    ].filter((item): item is string => Boolean(item))));
  }

  private getRetryDelayMs(error: Error, attempt: number): number {
    const message = error.message || '';
    if (/403|forbidden|upstream access forbidden|auto-switch/i.test(message)) {
      return Math.min(30_000, 8_000 * attempt);
    }
    if (/timeout|aborted|ECONNRESET|ETIMEDOUT/i.test(message)) {
      return Math.min(20_000, 5_000 * attempt);
    }
    return attempt * 5_000;
  }
}

export const claudeService = new ClaudeService();
