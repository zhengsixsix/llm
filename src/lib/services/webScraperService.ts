/**
 * 网页抓取服务 - 使用 Jina Reader API
 */

import https from 'https';

class WebScraperService {
  async fetchWebContent(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

      https.get(apiUrl, (res) => {
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
      }).on('error', reject);
    });
  }

  async fetchMultipleUrls(urls: string[]): Promise<string> {
    const contents = await Promise.all(
      urls.filter(url => url).map(url => this.fetchWebContent(url).catch(() => ''))
    );
    return contents.join('\n\n');
  }
}

export const webScraperService = new WebScraperService();
