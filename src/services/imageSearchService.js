const https = require('https');

/**
 * 图片搜索服务
 */
class ImageSearchService {
  constructor() {
    // Unsplash API (免费，需要注册获取 Access Key)
    this.unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY || '';
  }

  /**
   * 搜索图片
   * @param {string} query - 搜索关键词
   * @returns {Promise<string>} 图片URL
   */
  async searchImage(query) {
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
            console.error('[ERROR] 图片搜索失败:', error.message);
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }
}

module.exports = new ImageSearchService();
