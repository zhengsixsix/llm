/**
 * QStash Webhook 接收端点
 * QStash 在收到消息后 POST 到此端点，由它触发任务执行
 *
 * 配置步骤：
 * 1. 在 Upstash QStash 控制台创建 receiver endpoint：
 *    URL = https://你的域名/api/qstash
 * 2. 将 QSTASH_WEBHOOK_URL=https://你的域名 添加到 vercel env
 * 3. 将 QSTASH_TOKEN / QSTASH_CURRENT_SIGNING_KEY / QSTASH_VERIFIER_KEY
 *    添加到 vercel env（从 QStash 控制台获取）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getQStashReceiver } from '@/lib/qstashClient';
import { runProcessJob } from '@/app/api/generate/init/route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const receiver = getQStashReceiver();

  // 验证 QStash 签名（生产环境必须开启）
  if (receiver) {
    const body = await request.text();
    const signature = request.headers.get('upstash-signature');
    const delay = request.headers.get('upstash-delay');
    const maxRetries = request.headers.get('upstash-max-retries');

    if (!signature) {
      console.error('[ERROR] QStash webhook: 缺少签名');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
      const isValid = await receiver.verify({
        signature,
        body,
      });

      if (!isValid) {
        console.error('[ERROR] QStash webhook: 签名验证失败');
        return new NextResponse('Forbidden', { status: 403 });
      }
    } catch (err) {
      console.error('[ERROR] QStash webhook: 验证异常', err);
      return new NextResponse('Internal Server Error', { status: 500 });
    }

    // 签名验证通过，解析消息体
    let jobId: string;
    try {
      const parsed = JSON.parse(body);
      jobId = parsed.body ?? parsed.jobId ?? '';
    } catch {
      console.error('[ERROR] QStash webhook: body 解析失败');
      return new NextResponse('Bad Request', { status: 400 });
    }

    if (!jobId) {
      console.error('[ERROR] QStash webhook: 缺少 jobId');
      return new NextResponse('Bad Request', { status: 400 });
    }

    console.log(`[INFO] QStash webhook 触发 jobId=${jobId}`);
    await runProcessJob(jobId);
    return new NextResponse('OK', { status: 200 });
  }

  // receiver 未配置（不应该发生）
  console.error('[ERROR] QStash receiver 未配置');
  return new NextResponse('Service Unavailable', { status: 503 });
}
