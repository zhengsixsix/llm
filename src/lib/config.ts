/**
 * 应用配置
 * 在 .env.local.local 文件中配置以下环境变量
 */

import type { AppConfig } from '@/types/config';

export const config: AppConfig = {
  claude: {
    apiKey: process.env.CLAUDE_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    baseURL: process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com',
    timeout: 120000,
    maxRetries: 2
  }
};
