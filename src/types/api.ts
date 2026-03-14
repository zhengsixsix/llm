/**
 * API 相关类型定义
 */

import type { MindMapData } from './mindmap';

/** API 通用响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** 生成思维导图请求参数 */
export interface GenerateMindMapParams {
  schoolName: string;
  programName: string;
  projectWebsite?: string;
  curriculumLink?: string;
  activitiesLink?: string;
  files?: File[];
  targetWords?: string;
}

/** 生成思维导图响应数据 */
export interface GenerateMindMapResponse {
  data: MindMapData;
}

/** 下载 XMind 请求参数 */
export interface DownloadXMindParams {
  structure: MindMapData;
}

/** XMind 文件响应 */
export interface XMindFileResponse {
  buffer: Buffer;
  filename: string;
}
