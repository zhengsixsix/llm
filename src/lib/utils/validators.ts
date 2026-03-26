/**
 * 请求验证工具函数
 */

import { ValidationError } from './errorHandler';

/**
 * 验证必填字符串
 */
export function validateRequired(value: string | null | undefined, fieldName: string): void {
  if (!value || value.trim() === '') {
    throw new ValidationError(`请填写${fieldName}`);
  }
}

/**
 * 验证 URL 格式
 */
export function validateUrl(url: string | null | undefined, fieldName: string): void {
  if (url && url.trim() !== '') {
    try {
      new URL(url);
    } catch {
      throw new ValidationError(`${fieldName}格式不正确`);
    }
  }
}
