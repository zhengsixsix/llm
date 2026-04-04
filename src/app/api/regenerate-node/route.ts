import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { wordBudgetService } from '@/lib/services';
import type { MindMapGenerationMeta, NodeMeta, NodeType } from '@/types/mindmap';

interface RegeneratePayload {
  currentTitle?: string;
  nodePath?: string[];
  rootTitle?: string;
  nodeType?: NodeType;
  nodeMeta?: NodeMeta;
  generationMeta?: MindMapGenerationMeta;
  boardName?: string;
  boardSummary?: string;
  boardContentTitles?: string[];
  boardExplanationTitles?: string[];
  parentContentTitle?: string;
  pairedExplanationTitle?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegeneratePayload;
    if (!body.currentTitle) {
      return NextResponse.json({ error: '缺少节点内容' }, { status: 400 });
    }

    const client = new OpenAI({
      apiKey: config.claude.apiKey || process.env.CLAUDE_API_KEY || '',
      baseURL: config.claude.baseURL || process.env.CLAUDE_BASE_URL,
      timeout: 90000,
    });

    const prompt = body.nodeType === 'explanation'
      ? buildExplanationPrompt(body)
      : buildContentPrompt(body);

    const response = await createWithRetry(client, {
      max_output_tokens: body.nodeType === 'explanation' ? 1400 : 2200,
      input: prompt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawText = ((response as any).output_text || '').trim();

    const parsed = tryParseStructured(rawText);
    const nodeBudget = body.nodeMeta?.nodeBudget;
    const newTitleRaw = parsed.newTitle || rawText;
    const newTitle = body.nodeType === 'content' && nodeBudget
      ? wordBudgetService.truncateToBudget(newTitleRaw, nodeBudget)
      : newTitleRaw.trim();

    if (!newTitle) {
      throw new Error('AI 未返回有效内容');
    }

    let pairedExplanationTitle = parsed.pairedExplanationTitle?.trim();
    if (pairedExplanationTitle && body.nodeMeta?.voiceRole === 'content') {
      pairedExplanationTitle = pairedExplanationTitle.replace(/\s+/g, ' ').trim();
    }

    return NextResponse.json({
      success: true,
      newTitle,
      pairedExplanationTitle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '重新生成失败';
    console.error('[ERROR] regenerate-node failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildContentPrompt(body: RegeneratePayload): string {
  const pathStr = (body.nodePath || []).join(' > ');
  const boardName = body.boardName || body.nodeMeta?.boardName || '当前板块';
  const nodeBudget = body.nodeMeta?.nodeBudget;
  const boardBudget = body.nodeMeta?.boardBudget;
  const styleTone = body.nodeMeta?.styleTone || body.generationMeta?.styleProfile?.contentVoice.tone || '具体、克制、有叙事推进的招生官文书腔';
  const pairedExplanationTone = body.generationMeta?.styleProfile?.explanationVoice.tone || '顾问解释口吻';
  const anchors = body.nodeMeta?.sampleAnchors || body.generationMeta?.styleProfile?.contentVoice.anchorExamples || [];
  const explanationAnchors = body.generationMeta?.styleProfile?.explanationVoice.anchorExamples || [];
  const reviewIssues = body.nodeMeta?.reviewIssues || [];
  const applicantBrief = renderResumeProfile(body.generationMeta?.resumeProfile);
  const programBrief = renderProgramProfile(body.generationMeta?.programProfile);

  return `你是留学申请文书节点重写助手。请重写一个正文节点，并同步给出更匹配的新解释节点。

## 节点身份
- 项目：${body.rootTitle || '留学申请'}
- 板块：${boardName}
- 路径：${pathStr}
- 板块中心论点：${body.nodeMeta?.boardThesis || body.generationMeta?.thesis || '保持整板块叙事主线'}
- 板块任务：${body.nodeMeta?.boardGoal || '完成该板块的叙事任务'}
- 写作指导：${body.nodeMeta?.writingGuide || '写具体事实，不要空话'}
- 过渡方向：${body.nodeMeta?.transition || body.generationMeta?.overallLogic || '与整篇逻辑保持一致'}

## 字数限制
- 当前节点预算：${nodeBudget || '尽量控制在原长度附近'}字
- 板块总正文预算：${boardBudget || '按原比例保持'}
- 规则：重写后的正文必须尽量贴近节点预算，不能明显缩水，也不能超得太多

## 风格要求
- 正文口吻：${styleTone}
- 解释口吻：${pairedExplanationTone}
- explanation 如有称呼偏好，优先使用：${body.generationMeta?.styleProfile?.explanationVoice.preferredAddress || '无固定称呼'}

## 当前正文
${body.currentTitle}

## 当前配套解释
${body.pairedExplanationTitle || '无'}

## 申请人画像
${applicantBrief}

## 项目画像
${programBrief}

## 同板块其他正文
${(body.boardContentTitles || []).join('\n') || '无'}

## 板块总结
${body.boardSummary || '无'}

## 样例锚点
正文锚点：
${anchors.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}
解释锚点：
${explanationAnchors.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}

## 需要特别规避的问题
${reviewIssues.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}

## 输出JSON格式
{
  "newTitle": "重写后的正文",
  "pairedExplanationTitle": "与新正文匹配的新解释，2-4句话"
}

规则：
- newTitle 面向招生官，必须更具体、更可信、更有推进
- newTitle 不能写成经历清单，也不要用模板套话开头
- pairedExplanationTitle 面向学生，解释这段为什么这样写、怎样贴板块任务、怎样承接上下文
- 只输出JSON`;
}

function buildExplanationPrompt(body: RegeneratePayload): string {
  const pathStr = (body.nodePath || []).join(' > ');
  const boardName = body.boardName || body.nodeMeta?.boardName || '当前板块';
  const preferredAddress = body.nodeMeta?.preferredAddress || body.generationMeta?.styleProfile?.explanationVoice.preferredAddress || '你';
  const styleTone = body.nodeMeta?.styleTone || body.generationMeta?.styleProfile?.explanationVoice.tone || '顾问解释口吻';
  const anchors = body.nodeMeta?.sampleAnchors || body.generationMeta?.styleProfile?.explanationVoice.anchorExamples || [];
  const reviewIssues = body.nodeMeta?.reviewIssues || [];
  const applicantBrief = renderResumeProfile(body.generationMeta?.resumeProfile);
  const programBrief = renderProgramProfile(body.generationMeta?.programProfile);

  return `你是留学文书顾问，请重写一个 explanation 节点。

## 节点身份
- 项目：${body.rootTitle || '留学申请'}
- 板块：${boardName}
- 路径：${pathStr}
- 上层正文：${body.parentContentTitle || '无'}
- 板块中心论点：${body.nodeMeta?.boardThesis || body.generationMeta?.thesis || '保持整板块逻辑'}
- 板块任务：${body.nodeMeta?.boardGoal || '解释这一段的写作意图'}
- 写作指导：${body.nodeMeta?.writingGuide || '解释写法，不重复正文'}

## explanation 风格
- 口吻：${styleTone}
- 偏好称呼：${preferredAddress}
- 必须像顾问在给学生解释写法，不是招生官正文

## 当前 explanation
${body.currentTitle}

## 申请人画像
${applicantBrief}

## 项目画像
${programBrief}

## 同板块其他 explanation
${(body.boardExplanationTitles || []).join('\n') || '无'}

## 样例锚点
${anchors.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}

## 需要特别规避的问题
${reviewIssues.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}

## 输出JSON格式
{
  "newTitle": "重写后的 explanation"
}

规则：
- 2-4 句话，口语化但逻辑要清楚
- 要解释这段为什么写、怎么贴项目/板块、如何承接前后
- 不要复读正文，不要写成学术腔
- 只输出JSON`;
}

function tryParseStructured(text: string): { newTitle?: string; pairedExplanationTitle?: string } {
  const cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = codeBlockMatch ? codeBlockMatch[1] : cleaned;

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      return { newTitle: cleaned };
    }
  }
}

async function createWithRetry(
  client: OpenAI,
  params: { max_output_tokens: number; input: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const models = Array.from(new Set([
    config.claude.model,
    process.env.CLAUDE_FALLBACK_MODEL,
  ].filter((item): item is string => Boolean(item))));

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const model = models[Math.min(attempt - 1, models.length - 1)];
    try {
      const apiKey = config.claude.apiKey || process.env.CLAUDE_API_KEY || '';
      const baseURL = (config.claude.baseURL || process.env.CLAUDE_BASE_URL || 'https://api.asxs.top/v1').replace(/\/+$/, '');
      const httpRes = await fetch(`${baseURL}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          input: [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }],
          store: false,
          stream: true,
          include: ['reasoning.encrypted_content'],
          max_output_tokens: params.max_output_tokens,
        }),
      });
      if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}: ${(await httpRes.text()).slice(0, 300)}`);
      const reader = httpRes.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const evt = JSON.parse(data) as { type?: string; delta?: string };
            if (evt.type === 'response.output_text.delta') text += evt.delta ?? '';
          } catch { /* ignore */ }
        }
      }
      return { output_text: text };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      const currentError = lastError;
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(currentError, attempt)));
      }
    }
  }

  throw lastError || new Error('AI 调用失败');
}

function getRetryDelayMs(error: Error, attempt: number): number {
  const message = error.message || '';
  if (/403|forbidden|upstream access forbidden|auto-switch/i.test(message)) {
    return Math.min(30_000, 8_000 * attempt);
  }
  if (/timeout|aborted|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return Math.min(20_000, 5_000 * attempt);
  }
  return attempt * 5_000;
}

function renderResumeProfile(profile: MindMapGenerationMeta['resumeProfile']): string {
  if (!profile) return '无可用申请人画像，重写时请只依据当前节点与板块上下文。';

  const highlights = [
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
    ...highlights,
  ].join('\n');
}

function renderProgramProfile(profile: MindMapGenerationMeta['programProfile']): string {
  if (!profile) return '无可用项目画像，重写时请只依据当前节点与板块上下文。';

  return [
    `- programSummary: ${profile.programSummary || '无'}`,
    `- fitHooks: ${(profile.fitHooks || []).slice(0, 5).join('；') || '无'}`,
    `- courses: ${(profile.courses || []).slice(0, 4).join('；') || '无'}`,
    `- facultyOrLabs: ${[...(profile.faculty || []).slice(0, 2), ...(profile.labs || []).slice(0, 2)].join('；') || '无'}`,
  ].join('\n');
}
