/**
 * QStash 客户端
 * 使用官方 @upstash/qstash SDK，投递后台任务替代 waitUntil（不受 Serverless 时间限制）
 */

import { Client, Receiver } from '@upstash/qstash';

let _client: Client | null = null;
let _receiver: Receiver | null = null;

export function getQStashClient(): Client {
  if (!_client) {
    _client = new Client({
      token: process.env.QSTASH_TOKEN!,
    });
  }
  return _client;
}

/** QStash webhook 签名验证器（用于 /api/qstash 接收端） */
export function getQStashReceiver(): Receiver {
  if (!_receiver) {
    _receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    });
  }
  return _receiver;
}

export function isQStashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

/**
 * QStash 要求目标 URL 必须带 http:// 或 https://。
 * 兜底：若漏写协议则自动补上。
 */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * 投递任务到 QStash
 * 使用官方 SDK，自动处理延迟验证、URL 编码等细节。
 */
export async function enqueueQStash(url: string, body: unknown, retries = 3): Promise<void> {
  if (!isQStashConfigured()) throw new Error('QStash 未配置');

  const normalizedUrl = normalizeUrl(url);

  const result = await getQStashClient().publish({
    url: normalizedUrl,
    body: JSON.stringify(body),
    retries,
  });

  console.log(`[INFO] QStash messageId: ${result.messageId}`);
  console.log(`[INFO] QStash 投递成功，URL: ${normalizedUrl}`);
}
