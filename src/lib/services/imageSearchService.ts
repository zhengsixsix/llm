/**
 * 图片搜索服务
 */

import https from 'https';

class ImageSearchService {
  private unsplashAccessKey: string;

  constructor() {
    this.unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY || '';
  }

  async searchImage(query: string): Promise<string | null> {
    if (!this.unsplashAccessKey) {
      console.warn('[WARN] 未配置 UNSPLASH_ACCESS_KEY，跳过图片搜索');
      return null;
    }

    return new Promise((resolve) => {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1`;

      const options = {
        headers: {
          'Authorization': `Client-ID ${this.unsplashAccessKey}`
        }
      };

      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.results && result.results.length > 0) {
              resolve(result.results[0].urls.small);
            } else {
              resolve(null);
            }
          } catch (error) {
            console.error('[ERROR] 图片搜索失败:', error instanceof Error ? error.message : '未知错误');
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }
}

export const imageSearchService = new ImageSearchService();
