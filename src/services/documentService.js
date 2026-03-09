const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

/**
 * 文档读取服务
 */
class DocumentService {
  /**
   * 读取 docs 目录下的所有文件内容
   * @param {string} docsPath - docs 目录路径
   * @returns {Promise<string>} 合并的文档内容
   */
  async readDocsFolder(docsPath = './docs') {
    const resolvedPath = path.resolve(docsPath);

    if (!fs.existsSync(resolvedPath)) {
      return '';
    }

    const files = fs.readdirSync(resolvedPath);
    const contents = [];

    for (const file of files) {
      const filePath = path.join(resolvedPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const content = await this._readFile(filePath, file);
        if (content) {
          contents.push(`=== ${file} ===\n${content}\n`);
        }
      }
    }

    return contents.join('\n');
  }

  /**
   * 读取单个文件
   */
  async _readFile(filePath, filename) {
    if (filename.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (this._isTextFile(filename)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return '';
  }

  /**
   * 判断是否为文本文件
   */
  _isTextFile(filename) {
    const textExtensions = ['.txt', '.md'];
    return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }
}

module.exports = new DocumentService();
