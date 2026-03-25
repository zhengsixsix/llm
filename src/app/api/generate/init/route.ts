/**
 * POST /api/generate/init
 * 初始化生成任务，投递到 QStash 后立即返回 jobId
 * GET  /api/generate/init
 * 查询任务状态 + 自动续跑兜底（万无一失）
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateRequired, validateUrl } from '@/lib/utils/validators';
import { makeJobId, createJob, updateJob, getJob, getCheckpoint } from '@/lib/kvStore';
import { webScraperService, documentService, sampleService } from '@/lib/services';
import { claudeService } from '@/lib/services/claudeService';
import {
  isQStashConfigured,
  enqueueQStash,
} from '@/lib/qstashClient';
import type { ServiceFile } from '@/types/config';
import type { MindMapNode } from '@/types/mindmap';

export const dynamic = 'force-dynamic';

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function attachImages(nodes: MindMapNode[]): Promise<void> {
  const { imageSearchService } = await import('@/lib/services');
  for (const node of nodes) {
    if (node.imageKeyword) {
      try {
        const imageUrl = await imageSearchService.searchImage(node.imageKeyword);
        if (imageUrl) node.imageUrl = imageUrl;
      } catch {
        console.warn(`[WARN] 图片搜索失败: ${node.imageKeyword}`);
      }
    }
    if (node.children?.length) await attachImages(node.children);
  }
}

export async function runProcessJob(jobId: string): Promise<void> {
  try {
    await updateJob(jobId, { status: 'processing', progress: '正在读取材料…' });

    const job = await getJob(jobId);
    if (!job?.input) {
      await updateJob(jobId, { status: 'error', error: '任务数据不存在' });
      return;
    }
    const { input } = job;

    // 抓取网页（失败不影响主流程）
    let websiteContent = input.websiteContent ?? '';
    if (!websiteContent) {
      const urls = [input.projectWebsite, input.curriculumLink, input.activitiesLink].filter(Boolean);
      if (urls.length > 0) {
        try {
          websiteContent = await webScraperService.fetchMultipleUrls(urls);
        } catch (scrapeErr) {
          console.warn('[WARN] 网页抓取失败，继续用已有材料:', scrapeErr);
        }
      }
    }

    const checkpoint = await getCheckpoint(jobId);

    await updateJob(jobId, {
      progress: checkpoint ? `继续生成（上一步: ${checkpoint.step}）…` : '总览AI 生成中…',
    });

    const structure = await claudeService.generateApplicationMindMap(
      {
        schoolName: input.schoolName,
        programName: input.programName,
        websiteContent,
        userMaterials: input.userMaterials,
        sampleContent: input.sampleContent,
        detailLevel: input.detailLevel,
        stylePreference: input.stylePreference,
      },
      (step, charCount) => {
        updateJob(jobId, {
          progress: `AI 生成中（${step} - ${charCount} 字）`,
        }).catch(() => { });
      },
      checkpoint ?? undefined,
      async (cp) => {
        await import('@/lib/kvStore').then(m => m.saveCheckpoint(jobId, cp));
        console.log(`[CHECKPOINT] step=${cp.step} 已保存`);
      },
    );

    await updateJob(jobId, { progress: '正在搜索配图…' });
    await attachImages(structure.structure);

    await updateJob(jobId, {
      status: 'completed',
      progress: '生成完成',
      result: structure,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : '生成失败';
    console.error('[ERROR] processJob 失败:', message);
    await updateJob(jobId, { status: 'error', error: message });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const schoolName = formData.get('schoolName') as string;
  const programName = formData.get('programName') as string;
  const projectWebsite = (formData.get('projectWebsite') as string) || '';
  const curriculumLink = (formData.get('curriculumLink') as string) || '';
  const activitiesLink = (formData.get('activitiesLink') as string) || '';
  const detailLevel = Number(formData.get('detailLevel')) || 50;
  const stylePreference = Number(formData.get('stylePreference') || '50') || 50;
  const existingJobId = (formData.get('jobId') as string) || '';

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

  const files: ServiceFile[] = [];
  const uploadedFiles = formData.getAll('files') as File[];
  let sampleContent = '';

  if (uploadedFiles?.length) {
    for (const file of uploadedFiles) {
      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        if (file.name.endsWith('.xmind')) {
          try {
            const parsed = await sampleService.parseXMindBuffer(buffer, file.name);
            if (parsed) sampleContent = parsed;
          } catch (e) {
            console.warn('[WARN] XMind 样例解析失败:', e);
          }
        } else if (documentService.isSupportedFile(file.name)) {
          files.push({ filename: file.name, content: buffer });
        }
      }
    }
  }

  let userMaterials = '';
  if (files.length > 0) {
    try {
      userMaterials = await documentService.readFiles(files);
    } catch (e) {
      console.warn('[WARN] 材料读取失败，继续生成:', e);
    }
  }

  const jobId = existingJobId || makeJobId();

  // retry 场景：已有 checkpoint，直接续跑
  if (existingJobId) {
    const existingJob = await getJob(jobId);
    if (existingJob?.checkpoint) {
      await updateJob(jobId, {
        status: 'processing',
        progress: `继续生成（上一步: ${existingJob.checkpoint.step}）…`,
      });
      await enqueueJob(jobId);
      return json({ success: true, jobId });
    }
  }

  try {
    await createJob(jobId, {
      schoolName, programName,
      projectWebsite, curriculumLink, activitiesLink,
      detailLevel, stylePreference,
      userMaterials, sampleContent,
      websiteContent: '',
    });
  } catch (error) {
    console.error('[ERROR] Redis 创建任务失败:', error);
    return json({ success: false, error: '任务存储服务异常，请检查 Redis 环境变量配置' }, 503);
  }

  // QStash 投递（无 QStash 时直接运行）
  await enqueueJob(jobId);

  return json({ success: true, jobId });
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return json({ success: false, error: '缺少 jobId' }, 400);
  }

  const job = await getJob(jobId);
  if (!job) {
    return json({ success: false, error: '任务不存在' }, 404);
  }

  // ── 自动续跑兜底：processing 超过 N 秒没心跳，视为中断，立即重新投递 ──
  // 注意：总览/板块/审核AI 可能耗时 3-5 分钟，阈值太低会导致误判反复重投
  const HEARTBEAT_TIMEOUT_MS = 3 * 60 * 1000; // 3分钟
  if (job.status === 'processing') {
    const lastActive = job.lastHeartbeat ?? job.updatedAt;
    if (Date.now() - lastActive > HEARTBEAT_TIMEOUT_MS) {
      console.warn(`[WARN] 任务 ${jobId} 心跳超时（${Date.now() - lastActive}ms），重新投递…`);
      await updateJob(jobId, {
        status: 'processing',
        progress: '检测到任务中断，自动恢复中…',
      });
      await enqueueJob(jobId);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function enqueueJob(jobId: string): Promise<void> {
  // ── 防重锁：如果任务正在处理中且心跳较新，跳过重复投递 ──
  const existing = await getJob(jobId);
  if (existing?.status === 'processing') {
    const active = existing.lastHeartbeat ?? existing.updatedAt;
    // 3分钟内有活跃心跳，说明任务还在跑，不再投递
    if (Date.now() - active < 3 * 60 * 1000) {
      console.log(`[INFO] 任务 ${jobId} 仍在处理中（心跳正常），跳过重复投递`);
      return;
    }
    // 心跳超时才继续投递
    console.warn(`[WARN] 任务 ${jobId} 心跳超时，准备重新投递`);
  }

  // 打印 QStash 环境变量诊断（不打印 token 值）
  console.log('[DIAG] QStash 配置诊断:', {
    hasToken: !!process.env.QSTASH_TOKEN,
    hasSigningKey: !!process.env.QSTASH_CURRENT_SIGNING_KEY,
    hasWebhookUrl: !!process.env.QSTASH_WEBHOOK_URL,
    webhookUrl: process.env.QSTASH_WEBHOOK_URL ?? '(未定义)',
    qstashUrl: process.env.QSTASH_URL ?? '(使用默认)',
  });

  if (!isQStashConfigured()) {
    console.log('[INFO] QStash 未配置，直接运行 processJob');
    await runProcessJob(jobId);
    return;
  }

  const webhookUrl = process.env.QSTASH_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[WARN] QSTASH_WEBHOOK_URL 未配置，降级为直接调用');
    await runProcessJob(jobId);
    return;
  }

  const base = webhookUrl.trim().replace(/\/+$/, '');
  const targetUrl = `${base}/api/qstash`;
  console.log('[DIAG] QStash 投递目标 URL:', targetUrl);

  try {
    await enqueueQStash(targetUrl, { jobId }, 3);
    console.log(`[INFO] 任务 ${jobId} 已投递到 QStash`);
  } catch (err) {
    console.error('[ERROR] QStash 投递失败，降级为直接调用:', err);
    await runProcessJob(jobId);
  }
}
