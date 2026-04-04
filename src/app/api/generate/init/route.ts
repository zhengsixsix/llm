import { NextRequest } from 'next/server';
import { validateRequired, validateUrl } from '@/lib/utils/validators';
import {
  createJob,
  getCheckpoint,
  getJob,
  makeJobId,
  saveCheckpoint,
  updateJob,
} from '@/lib/kvStore';
import {
  documentService,
  sampleService,
  sampleStyleService,
  webScraperService,
} from '@/lib/services';
import { claudeService } from '@/lib/services/claudeService';
import { enqueueQStash, isQStashConfigured } from '@/lib/qstashClient';
import type { ServiceFile } from '@/types/config';
import type { MindMapNode } from '@/types/mindmap';

export const dynamic = 'force-dynamic';

function shouldUseQStash(): boolean {
  return process.env.NODE_ENV === 'production'
    && isQStashConfigured()
    && Boolean(process.env.QSTASH_WEBHOOK_URL);
}

async function attachImages(nodes: MindMapNode[]): Promise<void> {
  const { imageSearchService } = await import('@/lib/services');
  for (const node of nodes) {
    if (node.imageKeyword) {
      try {
        const imageUrl = await imageSearchService.searchImage(node.imageKeyword);
        if (imageUrl) {
          node.imageUrl = imageUrl;
        }
      } catch {
        console.warn(`[WARN] image lookup failed: ${node.imageKeyword}`);
      }
    }
    if (node.children?.length) {
      await attachImages(node.children);
    }
  }
}

export async function runProcessJob(jobId: string): Promise<void> {
  let latestProgress = '正在读取材料…';
  const heartbeatTimer = setInterval(() => {
    updateJob(jobId, { status: 'processing', progress: latestProgress }).catch(() => undefined);
  }, 5_000);

  const setProgress = async (progress: string): Promise<void> => {
    latestProgress = progress;
    await updateJob(jobId, { status: 'processing', progress });
  };

  try {
    await setProgress('正在读取材料…');

    const job = await getJob(jobId);
    if (!job?.input) {
      await updateJob(jobId, { status: 'error', error: '任务数据不存在' });
      return;
    }

    const { input } = job;
    let websiteContent = input.websiteContent ?? '';
    if (!websiteContent) {
      const urls = [input.projectWebsite, input.curriculumLink, input.activitiesLink].filter(Boolean);
      if (urls.length > 0) {
        try {
          websiteContent = await webScraperService.fetchMultipleUrls(urls);
        } catch (error) {
          console.warn('[WARN] website scraping failed, continuing with existing materials', error);
        }
      }
    }

    const checkpoint = await getCheckpoint(jobId);
    await setProgress(checkpoint ? `继续生成中（恢复到步骤 ${checkpoint.step}）…` : '总览AI生成中…');

    const structure = await claudeService.generateApplicationMindMap(
      {
        schoolName: input.schoolName,
        programName: input.programName,
        websiteContent,
        userMaterials: input.userMaterials,
        sampleContent: input.sampleContent,
        styleProfile: input.styleProfile,
        detailLevel: input.detailLevel,
        stylePreference: input.stylePreference,
        targetWords: input.targetWords,
      },
      (step, charCount) => {
        const isBoardStep = step.startsWith('板块:');
        const progress = isBoardStep
          ? `AI 生成中（${step}）`
          : charCount > 0
            ? `AI 生成中（${step} - ${charCount}字）`
            : `AI 生成中（${step}）`;
        latestProgress = progress;
        updateJob(jobId, { status: 'processing', progress }).catch(() => undefined);
      },
      checkpoint ?? undefined,
      async (cp) => {
        await saveCheckpoint(jobId, cp);
      },
    );

    await setProgress('正在搜索配图…');
    await attachImages(structure.structure);

    await updateJob(jobId, {
      status: 'completed',
      progress: '生成完成',
      result: structure,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败';
    console.error('[ERROR] processJob failed:', message);
    await updateJob(jobId, { status: 'error', error: message });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const schoolName = formData.get('schoolName') as string;
  const programName = formData.get('programName') as string;
  const projectWebsite = (formData.get('projectWebsite') as string) || '';
  const curriculumLink = (formData.get('curriculumLink') as string) || '';
  const activitiesLink = (formData.get('activitiesLink') as string) || '';
  const detailLevel = Number(formData.get('detailLevel')) || 50;
  const stylePreference = Number(formData.get('stylePreference') || '50') || 50;
  const targetWords = Number(formData.get('targetWords')) || 1000;
  const existingJobId = (formData.get('jobId') as string) || '';

  try {
    validateRequired(schoolName, '学校名称');
    validateRequired(programName, '专业名称');
    if (projectWebsite) validateUrl(projectWebsite, '项目官网链接');
    if (curriculumLink) validateUrl(curriculumLink, '课程链接');
    if (activitiesLink) validateUrl(activitiesLink, '活动链接');
  } catch (error) {
    const message = error instanceof Error ? error.message : '参数校验失败';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const files: ServiceFile[] = [];
  const uploadedFiles = formData.getAll('files') as File[];
  let sampleContent = '';
  let styleProfile = undefined;

  if (uploadedFiles.length > 0) {
    for (const file of uploadedFiles) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (file.name.endsWith('.xmind')) {
        try {
          const parsed = await sampleService.parseXMindBufferDetailed(buffer, file.name);
          if (parsed) {
            sampleContent = parsed.renderedText;
            styleProfile = sampleStyleService.buildProfile(parsed, sampleContent);
          }
        } catch (error) {
          console.warn('[WARN] sample xmind parse failed:', error);
        }
        continue;
      }

      if (documentService.isSupportedFile(file.name)) {
        files.push({ filename: file.name, content: buffer });
      }
    }
  }

  if (!sampleContent) {
    const defaultSample = await sampleService.getDefaultSampleDocument();
    sampleContent = defaultSample?.renderedText || '';
    styleProfile = sampleStyleService.buildProfile(defaultSample || undefined, sampleContent);
  } else if (!styleProfile) {
    styleProfile = sampleStyleService.buildProfile(undefined, sampleContent);
  }

  let userMaterials = '';
  if (files.length > 0) {
    try {
      userMaterials = await documentService.readFiles(files);
    } catch (error) {
      console.warn('[WARN] document reading failed, continuing without extracted text', error);
    }
  }

  const jobId = existingJobId || makeJobId();
  if (existingJobId) {
    const existingJob = await getJob(jobId);
    if (existingJob?.checkpoint) {
      await updateJob(jobId, {
        status: 'processing',
        progress: `继续生成中（恢复到步骤 ${existingJob.checkpoint.step}）…`,
      });
      await enqueueJob(jobId, { force: true });
      return json({ success: true, jobId });
    }
  }

  try {
    await createJob(jobId, {
      schoolName,
      programName,
      projectWebsite,
      curriculumLink,
      activitiesLink,
      detailLevel,
      stylePreference,
      targetWords,
      userMaterials,
      sampleContent,
      styleProfile,
      websiteContent: '',
    });
  } catch (error) {
    console.error('[ERROR] create job failed:', error);
    return json({ success: false, error: '任务存储服务异常，请检查 Redis 配置' }, 503);
  }

  if (!shouldUseQStash()) {
    const { waitUntil } = request as NextRequest & { waitUntil?: (promise: Promise<void>) => void };
    if (waitUntil) {
      waitUntil(runProcessJob(jobId));
    } else {
      runProcessJob(jobId).catch((error) => console.error('[ERROR] background job failed:', error));
    }
  } else {
    await enqueueJob(jobId);
  }

  return json({ success: true, jobId });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return json({ success: false, error: '缺少 jobId' }, 400);
  }

  let job = await getJob(jobId);
  if (!job) {
    return json({ success: false, error: '任务不存在' }, 404);
  }

  const heartbeatTimeoutMs = 3 * 60 * 1000;
  if (job.status === 'processing') {
    const lastActive = job.lastHeartbeat ?? job.updatedAt;
    if (Date.now() - lastActive > heartbeatTimeoutMs) {
      await updateJob(jobId, {
        status: 'processing',
        progress: '检测到任务中断，正在自动恢复…',
      });
      await enqueueJob(jobId, { force: true });
      job = await getJob(jobId);
      if (!job) {
        return json({ success: false, error: '任务不存在' }, 404);
      }
    }
  }

  return json({
    success: true,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function enqueueJob(jobId: string, options?: { force?: boolean }): Promise<void> {
  const existing = await getJob(jobId);
  if (!options?.force && existing?.status === 'processing') {
    const active = existing.lastHeartbeat ?? existing.updatedAt;
    if (Date.now() - active < 3 * 60 * 1000) {
      return;
    }
  }

  if (!shouldUseQStash()) {
    await runProcessJob(jobId);
    return;
  }

  const webhookUrl = process.env.QSTASH_WEBHOOK_URL;
  if (!webhookUrl) {
    await runProcessJob(jobId);
    return;
  }

  const targetUrl = `${webhookUrl.trim().replace(/\/+$/, '')}/api/qstash`;
  try {
    await enqueueQStash(targetUrl, { jobId }, 3);
  } catch (error) {
    console.error('[ERROR] qstash enqueue failed, falling back to direct execution', error);
    await runProcessJob(jobId);
  }
}
