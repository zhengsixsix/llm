/**
 * 应用常量定义
 */

export const APP_NAME = 'PS MindMap';
export const APP_VERSION = '1.0.0';

/** 目标字数选项 */
export const WORD_COUNT_OPTIONS = [
  { value: '500', label: '500 词' },
  { value: '750', label: '750 词' },
  { value: '1000', label: '1000 词' },
  { value: '1500', label: '1500 词' },
  { value: '2000', label: '2000 词' },
] as const;

/** 支持的文件类型 */
export const SUPPORTED_FILE_TYPES = ['.txt', '.md', '.docx'] as const;

/** 默认超时设置 */
export const DEFAULT_TIMEOUT = 120000;
export const DEFAULT_MAX_RETRIES = 2;

/** 五大文书板块 */
export const FIVE_SECTIONS = [
  '兴趣起源',
  '进阶思考',
  '能力匹配',
  '心仪课程',
  '衷心求学',
] as const;
