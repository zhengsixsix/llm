/**
 * 下载 XMind 文件 API
 */

import { NextRequest, NextResponse } from 'next/server';
import { xmindService } from '@/lib/services';
import { validateRequired } from '@/lib/utils/validators';
import type { MindMapData } from '@/types/mindmap';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { structure } = body as { structure: MindMapData };

    if (!structure) {
      return NextResponse.json(
        { success: false, error: '缺少思维导图结构数据' },
        { status: 400 }
      );
    }

    console.log('[INFO] 正在生成 XMind 文件...');

    const buffer = await xmindService.generateXMind(structure);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="mindmap.xmind"`
      }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败';
    console.error('[ERROR] XMind 生成失败:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
