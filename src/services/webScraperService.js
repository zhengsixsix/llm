const https = require('https');

/**
 * 网页抓取服务 - 使用 Jina Reader API（免费，无需服务器渲染）
 * API文档: https://jina.ai/reader
 */
class WebScraperService {
  /**
   * 使用 Jina Reader API 抓取网页
   * @param {string} url - 网页 URL
   * @returns {Promise<string>} 网页文本内容
   */
  async fetchWebContent(url) {
    return new Promise((resolve, reject) => {
      const apiUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

      https.get(apiUrl, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Jina API 返回 Markdown 格式内容
            // 移除标题行（URL来源说明）
            const lines = data.split('\n');
            const contentStartIndex = lines.findIndex(line => line.startsWith('### '));
            if (contentStartIndex > 0) {
              data = lines.slice(contentStartIndex).join('\n');
            }

            // 清理内容
            const text = data
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 保留链接文字，移除链接
              .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // 移除图片
              .slice(0, 8000); // 限制长度

            resolve(text);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 批量抓取多个 URL
   * @param {Array<string>} urls - URL 列表
   * @returns {Promise<string>} 合并的内容
   */
  async fetchMultipleUrls(urls) {
    const contents = await Promise.all(
      urls.filter(url => url).map(url => this.fetchWebContent(url).catch(() => ''))
    );
    return contents.join('\n\n');
  }
}

module.exports = new WebScraperService();
