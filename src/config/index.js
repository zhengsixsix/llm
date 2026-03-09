require('dotenv').config();

/**
 * 应用配置
 */
module.exports = {
  // Claude API 配置
  claude: {
    apiKey: process.env.CLAUDE_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    baseURL: process.env.CLAUDE_BASE_URL || 'https://terminal.pub/v1'
  },

  // 文件路径配置
  files: {
    excelPath: process.env.EXCEL_FILE_PATH || './input.xlsx',
    xmindPath: process.env.XMIND_OUTPUT_PATH || './output.xmind',
    sheetName: process.env.SHEET_NAME || ''
  }
};
