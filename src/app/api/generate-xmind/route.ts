/**
 * 下载 XMind 文件 API
 */

import { NextRequest, NextResponse } from 'next/server';
import { xmindService } from '@/lib/services';
import path from 'path';
import fs from 'fs';
import { validateRequired } from '@/lib/utils/validators';
import type { MindMapData } from '@/types/mindmap';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { structure } = body as { structure: MindMapData };

    // 验证
    if (!structure) {
      return NextResponse.json(
        { success: false, error: '缺少思维导图结构数据' },
        { status: 400 }
      );
    }

    console.log('[INFO] 正在生成 XMind 文件...');

    // 生成临时文件路径
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const outputPath = path.join(tempDir, `mindmap-${Date.now()}.xmind`);

    // 生成 XMind 文件
    await xmindService.generateXMind(structure, outputPath);

    // 读取文件并返回
    const fileBuffer = fs.readFileSync(outputPath);

    // 清理临时文件
    fs.unlinkSync(outputPath);

    return new NextResponse(fileBuffer, {
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
