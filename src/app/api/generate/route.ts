/**
 * 生成思维导图 API
 */

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

import { NextRequest, NextResponse } from 'next/server';
import { claudeService, webScraperService, documentService, sampleService, imageSearchService } from '@/lib/services';
import { validateRequired, validateUrl } from '@/lib/utils/validators';
import type { ServiceFile } from '@/types/config';
import type { MindMapNode } from '@/types/mindmap';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const schoolName = formData.get('schoolName') as string;
    const programName = formData.get('programName') as string;
    const projectWebsite = formData.get('projectWebsite') as string || '';
    const curriculumLink = formData.get('curriculumLink') as string || '';
    const activitiesLink = formData.get('activitiesLink') as string || '';

    // 验证必填字段
    validateRequired(schoolName, '学校名称');
    validateRequired(programName, '专业名称');

    // 验证 URL 格式
    if (projectWebsite) validateUrl(projectWebsite, '项目官网链接');
    if (curriculumLink) validateUrl(curriculumLink, '课程链接');
    if (activitiesLink) validateUrl(activitiesLink, '活动链接');

    console.log('[INFO] 开始生成思维导图...');
    console.log('[INFO] 学校:', schoolName, '专业:', programName);

    // 1. 处理上传的文件
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
    console.log('[INFO] 用户材料读取完成');
    if (sampleContent) console.log('[INFO] 样例文件解析完成');

    // 2. 抓取网页内容
    let websiteContent = '';
    const urls = [projectWebsite, curriculumLink, activitiesLink].filter(url => url);

    if (urls.length > 0) {
      console.log('[INFO] 正在抓取网页内容...');
      websiteContent = await webScraperService.fetchMultipleUrls(urls);
      console.log(`[INFO] 网页内容抓取完成，长度: ${websiteContent.length} 字符`);
    }

    // 3. 使用 Claude AI 生成思维导图结构
    console.log('[INFO] 正在生成思维导图结构...');
    const structure = await claudeService.generateApplicationMindMap({
      schoolName,
      programName,
      websiteContent,
      userMaterials,
      sampleContent
    });

    console.log('[INFO] 思维导图结构生成完成');

    // 4. 搜索并添加图片 URL
    console.log('[INFO] 正在搜索图片...');
    await attachImages(structure.structure);
    console.log('[INFO] 图片搜索完成');

    return NextResponse.json({
      success: true,
      data: structure
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败';
    console.error('[ERROR] 生成失败:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && error.message.includes('请填写') ? 400 : 500 }
    );
  }
}
