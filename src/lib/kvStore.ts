/**
 * Upstash Redis 任务状态存储
 * 用于异步任务队列：init → waitUntil 后台处理 → status polling
 * 支持断点续传（retry 时跳过已完成步骤）
 */

import { Redis } from '@upstash/redis';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface BoardResult {
  boardName: string;
  boardId: string;
  data: unknown;
  writingGuide: string;
  keyPoints: string[];
}

export interface JobCheckpoint {
  step: number; // 0=总览完成, 1=板块完成, 2=审核完成, 3=关联完成, 4=全部完成
  overview?: unknown;
  boardResults?: BoardResult[];
  reviewResults?: unknown;
  relationships?: unknown;
}

export interface JobData {
  status: JobStatus;
  progress?: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** 心跳：后台任务最后活跃时间，用于检测是否卡死 */
  lastHeartbeat?: number;
  input?: {
    schoolName: string;
    programName: string;
    projectWebsite: string;
    curriculumLink: string;
    activitiesLink: string;
    detailLevel: number;
    stylePreference: number;
    userMaterials: string;
    sampleContent: string;
    websiteContent: string;
  };
  checkpoint?: JobCheckpoint;
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const PREFIX = 'mindmap:job:';
const JOB_TTL = 60 * 60 * 24; // 24小时过期

export function makeJobId(): string {
  return crypto.randomUUID();
}

export async function createJob(jobId: string, input: JobData['input']): Promise<void> {
  const job: JobData = {
    status: 'pending',
    progress: '任务已创建，等待处理…',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input,
  };
  await redis.set(`${PREFIX}${jobId}`, job, { ex: JOB_TTL });
}

export async function getJob(jobId: string): Promise<JobData | null> {
  const job = await redis.get<JobData>(`${PREFIX}${jobId}`);
  return job;
}

export async function updateJob(
  jobId: string,
  updates: Partial<Pick<JobData, 'status' | 'progress' | 'result' | 'error'>>
): Promise<void> {
  const existing = await getJob(jobId);
  if (!existing) return;

  const updated: JobData = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
    lastHeartbeat: Date.now(),
  };
  await redis.set(`${PREFIX}${jobId}`, updated, { ex: JOB_TTL });
}

export async function saveCheckpoint(
  jobId: string,
  checkpoint: JobCheckpoint
): Promise<void> {
  const existing = await getJob(jobId);
  if (!existing) return;

  // 只写入有实际值的字段，避免 [] / null 覆盖已有 checkpoint
  const patch: Partial<JobData> = {
    checkpoint: {
      ...existing.checkpoint,
      step: checkpoint.step,
    },
    updatedAt: Date.now(),
    lastHeartbeat: Date.now(),
  };
  if (checkpoint.overview !== undefined) patch.checkpoint!.overview = checkpoint.overview;
  if (checkpoint.boardResults !== undefined) patch.checkpoint!.boardResults = checkpoint.boardResults as any;
  if (checkpoint.reviewResults !== undefined) patch.checkpoint!.reviewResults = checkpoint.reviewResults as any;
  if (checkpoint.relationships !== undefined) patch.checkpoint!.relationships = checkpoint.relationships as any;

  await redis.set(`${PREFIX}${jobId}`, {
    ...existing,
    ...patch,
  }, { ex: JOB_TTL });
}

export async function getCheckpoint(jobId: string): Promise<JobCheckpoint | null> {
  const job = await getJob(jobId);
  return job?.checkpoint ?? null;
}
