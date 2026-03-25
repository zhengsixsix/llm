/**
 * 生成思维导图 API（SSE 流式进度推送）
 */

import { NextRequest } from 'next/server';
import { claudeService, webScraperService, documentService, sampleService, imageSearchService } from '@/lib/services';
import { validateRequired, validateUrl } from '@/lib/utils/validators';
import type { ServiceFile } from '@/types/config';
import type { MindMapNode } from '@/types/mindmap';

async function attachImages(nodes: MindMapNode[]): Promise<void> {
  for (const node of nodes) {
    if (node.imageKeyword) {
      try {
        const imageUrl = await imageSearchService.searchImage(node.imageKeyword);
        if (imageUrl) {
          node.imageUrl = imageUrl;
        }
      } catch (error) {
        console.warn(`[WARN] 图片搜索失败: ${node.imageKeyword}`);
      }
    }
    if (node.children && node.children.length > 0) {
      await attachImages(node.children);
    }
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const schoolName = formData.get('schoolName') as string;
  const programName = formData.get('programName') as string;
  const projectWebsite = formData.get('projectWebsite') as string || '';
  const curriculumLink = formData.get('curriculumLink') as string || '';
  const activitiesLink = formData.get('activitiesLink') as string || '';
  const detailLevel = Number(formData.get('detailLevel')) || 50;
  const stylePreference = Number(formData.get('stylePreference')) || 50;

  // 验证必填字段（失败时直接返回 JSON 错误）
  try {
    validateRequired(schoolName, '学校名称');
    validateRequired(programName, '专业名称');
    if (projectWebsite) validateUrl(projectWebsite, '项目官网链接');
    if (curriculumLink) validateUrl(curriculumLink, '课程链接');
    if (activitiesLink) validateUrl(activitiesLink, '活动链接');
  } catch (error) {
    const message = error instanceof Error ? error.message : '参数验证失败';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. 处理文件
        send('progress', { stage: 'files', message: '正在读取上传文件…' });
        const files: ServiceFile[] = [];
        const uploadedFiles = formData.getAll('files') as File[];
        let sampleContent = '';

        if (uploadedFiles && uploadedFiles.length > 0) {
          for (const file of uploadedFiles) {
            if (file) {
              const buffer = Buffer.from(await file.arrayBuffer());
              if (file.name.endsWith('.xmind')) {
                const parsed = await sampleService.parseXMindBuffer(buffer, file.name);
                if (parsed) sampleContent = parsed;
              } else if (documentService.isSupportedFile(file.name)) {
                files.push({ filename: file.name, content: buffer });
              }
            }
          }
        }

        const userMaterials = await documentService.readFiles(files);

        // 2. 抓取网页
        const urls = [projectWebsite, curriculumLink, activitiesLink].filter(url => url);
        let websiteContent = '';
        if (urls.length > 0) {
          send('progress', { stage: 'scraping', message: `正在抓取 ${urls.length} 个网页…` });
          websiteContent = await webScraperService.fetchMultipleUrls(urls);
        }

        // 3. AI 生成
        send('progress', { stage: 'generating', message: 'AI 生成中…', charCount: 0 });

        const structure = await claudeService.generateApplicationMindMap(
          { schoolName, programName, websiteContent, userMaterials, sampleContent, detailLevel, stylePreference },
          (step, charCount) => {
            send('progress', { stage: step, message: `AI 生成中（${step} - ${charCount} 字）`, charCount });
          },
        );

        // 4. 搜索图片
        send('progress', { stage: 'images', message: '正在搜索配图…' });
        await attachImages(structure.structure);

        // 5. 完成
        send('result', { success: true, data: structure });
        send('done', {});
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成失败';
        console.error('[ERROR] 生成失败:', message);
        send('error', { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
