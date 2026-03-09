const config = require('./config');
const claudeService = require('./services/claudeService');
const xmindService = require('./services/xmindService');
const webScraperService = require('./services/webScraperService');
const documentService = require('./services/documentService');
const sampleService = require('./services/sampleService');
const logger = require('./utils/logger');
const fs = require('fs');

/**
 * 主应用类
 */
class App {
  async run() {
    try {
      logger.info('开始生成申请文书思维导图...');

      // 1. 读取 docs 目录下的用户材料
      logger.info('正在读取 docs 目录...');
      const userMaterials = await documentService.readDocsFolder('./docs');
      logger.success('用户材料读取完成');

      // 1.5 读取 sample 目录下的 xmind 样例，作为 AI 生成的参考
      logger.info('正在读取 sample 目录中的 xmind 样例...');
      const sampleContent = await sampleService.readSamples('./sample');
      if (sampleContent) {
        logger.success('样例读取完成，将作为生成参考');
      } else {
        logger.info('未读取到样例，跳过');
      }

      // 2. 获取申请信息（从配置或命令行参数）
      const applicationInfo = this._getApplicationInfo();
      logger.info('申请项目:', `${applicationInfo.schoolName} - ${applicationInfo.programName}`);

      // 3. 抓取项目网页内容
      logger.info('正在抓取项目网页...');

      // 单独抓取每个 URL，以便分别保存
      const urls = {
        projectWebsite: applicationInfo.projectWebsite,
        curriculumLink: applicationInfo.curriculumLink,
        activitiesLink: applicationInfo.activitiesLink
      };

      const websiteContents = {};
      for (const [key, url] of Object.entries(urls)) {
        if (url) {
          logger.info(`抓取 ${key}: ${url}`);
          websiteContents[key] = await webScraperService.fetchWebContent(url);
          logger.success(`${key} 抓取完成，内容长度: ${websiteContents[key].length} 字符`);
        }
      }

      // 保存抓取的网页内容到文件
      const websiteContentStr = Object.entries(websiteContents)
        .map(([key, content]) => `=== ${key} ===\n${content}`)
        .join('\n\n');
      fs.writeFileSync('./website-content.txt', websiteContentStr, 'utf-8');
      logger.success('网页内容已保存到 website-content.txt');

      // 合并所有内容
      const websiteContent = Object.values(websiteContents).join('\n\n');

      // 4. 使用 Claude 服务生成思维导图结构
      logger.info('正在生成思维导图结构...');
      const structure = await claudeService.generateApplicationMindMap({
        schoolName: applicationInfo.schoolName,
        programName: applicationInfo.programName,
        websiteContent,
        curriculumContent: websiteContent,
        targetWordCount: applicationInfo.targetWordCount,
        userMaterials,
        sampleContent
      });

      if (!structure) {
        throw new Error('AI 生成失败');
      }
      logger.success('思维导图结构生成完成');

      // 5. 生成 XMind 文件
      logger.info('正在生成 XMind 文件...');
      await xmindService.generateXMind(structure, config.files.xmindPath);
      logger.success('思维导图生成完成！');
      logger.success('输出文件:', config.files.xmindPath);

    } catch (error) {
      logger.error('生成失败:', error.message);
      process.exit(1);
    }
  }

  _getApplicationInfo() {
    return {
      schoolName: process.env.SCHOOL_NAME || 'The University of Hong Kong',
      programName: process.env.PROGRAM_NAME || 'Museum Studies',
      projectWebsite: process.env.PROJECT_WEBSITE || 'https://portal.hku.hk/tpg-admissions/programme-details?programme=master-of-arts-in-the-field-of-museum-studies-arts&mode=1',
      curriculumLink: process.env.CURRICULUM_LINK || 'https://mamuseumstudies.arts.hku.hk/',
      activitiesLink: process.env.ACTIVITIES_LINK || 'https://mamuseumstudies.arts.hku.hk/our-programme',
      targetWordCount: parseInt(process.env.TARGET_WORD_COUNT || '1000')
    };
  }
}

const app = new App();
app.run();
