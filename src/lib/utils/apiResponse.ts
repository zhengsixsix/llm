/**
 * API 响应工具函数
 */

import type { ApiResponse } from '@/types/api';

/**
 * 创建成功响应
 */
export function successResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    message
  };
}

/**
 * 创建错误响应
 */
export function errorResponse<T>(error: string, statusCode: number = 500): ApiResponse<T> {
  return {
    success: false,
    error
  };
}
