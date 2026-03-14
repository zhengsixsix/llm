/**
 * 配置类型定义
 */

/** Claude API 配置 */
export interface ClaudeConfig {
  apiKey?: string;
  model: string;
  baseURL: string;
  timeout?: number;
  maxRetries?: number;
}

/** 应用配置 */
export interface AppConfig {
  claude: ClaudeConfig;
}

/** 服务层文件类型 */
export interface ServiceFile {
  filename: string;
  content: Buffer;
}
