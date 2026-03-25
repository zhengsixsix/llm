/**
 * 网页抓取服务 - 使用 Jina Reader API
 */

import https from 'https';

class WebScraperService {
  async fetchWebContent(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

      const req = https.get(apiUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const lines = data.split('\n');
            const contentStartIndex = lines.findIndex(line => line.startsWith('### '));
            if (contentStartIndex > 0) {
              data = lines.slice(contentStartIndex).join('\n');
            }

            const text = data
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
              .slice(0, 8000);

            resolve(text);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error(`请求超时: ${url}`));
      });
    });
  }

  async fetchMultipleUrls(urls: string[], timeoutMs = 10000): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const results = await Promise.allSettled(
        urls.filter(url => url).map(async (url) => {
          try {
            return await this.fetchWebContent(url);
          } catch {
            return '';
          }
        })
      );
      return results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<string>).value)
        .join('\n\n');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const webScraperService = new WebScraperService();
