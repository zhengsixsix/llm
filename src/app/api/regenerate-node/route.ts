/**
 * 单节点 AI 重新生成 API
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const { currentTitle, nodePath, rootTitle, nodeType } = await request.json();

    if (!currentTitle) {
      return NextResponse.json({ error: '缺少节点内容' }, { status: 400 });
    }

    const client = new Anthropic({
      apiKey: config.claude.apiKey || process.env.CLAUDE_API_KEY,
      baseURL: config.claude.baseURL || process.env.CLAUDE_BASE_URL,
      timeout: 60000,
    });

    const pathStr = nodePath ? nodePath.join(' > ') : '';
    const typeHint = nodeType === 'explanation'
      ? '这是一个写作逻辑解释节点（面向学生的口语化解释，称呼用"姐姐/哥哥"，2-4句话）'
      : '这是一个文书正文节点（面向招生官，需要有具体细节和数据，100字以上完整段落）';

    const prompt = `你是留学文书思维导图的写作助手。请重新生成以下节点的内容。

## 上下文
- 项目：${rootTitle || '留学申请'}
- 节点路径：${pathStr}
- 节点类型：${typeHint}

## 当前内容
${currentTitle}

## 要求
1. 保持相同的主题方向，但用不同的角度/表达重新写
2. 内容质量要更好、更具体、更有深度
3. 只输出新的节点文本内容，不要任何解释或标记`;

    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const newTitle = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!newTitle) {
      throw new Error('AI 未返回有效内容');
    }

    return NextResponse.json({ success: true, newTitle });
  } catch (error) {
    const message = error instanceof Error ? error.message : '重新生成失败';
    console.error('[ERROR] 节点重新生成失败:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
