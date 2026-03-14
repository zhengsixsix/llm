export type Language = 'en' | 'zh';

export interface TranslationKeys {
  appName: string;
  appSubtitle: string;
  schoolName: string;
  programName: string;
  required: string;
  targetWords: string;
  referenceLinks: string;
  optional: string;
  projectUrl: string;
  curriculumUrl: string;
  activitiesUrl: string;
  supplementaryMaterials: string;
  supportedFormats: string;
  uploadHint: string;
  generateMindMap: string;
  reset: string;
  downloadXMind: string;
  systemRunning: string;
  ready: string;
  noMindMap: string;
  emptyStateDescription: string;
  generationTime: string;
  remainingUses: string;
  dailyLimit: string;
  usageTips: string;
  tip1: string;
  tip2: string;
  tip3: string;
  dataSecurity: string;
  dragDropFiles: string;
  orClickToBrowse: string;
  word500: string;
  word750: string;
  word1000: string;
  word1500: string;
  word2000: string;
}

export type Translations = {
  [key in Language]: TranslationKeys;
};

export const translations: Translations = {
  en: {
    appName: 'PS Mind Map',
    appSubtitle: 'AI Personal Statement Generator',
    schoolName: 'School Name',
    programName: 'Program Name',
    required: '*',
    targetWords: 'Target Words',
    referenceLinks: 'Reference Links',
    optional: '(optional)',
    projectUrl: 'Program Website URL',
    curriculumUrl: 'Curriculum Page URL',
    activitiesUrl: 'Activities Page URL',
    supplementaryMaterials: 'Supplementary Materials',
    supportedFormats: 'PDF/Word supported',
    uploadHint: 'Click to upload or drag files',
    generateMindMap: 'Generate Mind Map',
    reset: 'Reset',
    downloadXMind: 'Download XMind',
    systemRunning: 'System Running',
    ready: 'Ready',
    noMindMap: 'No Mind Map Yet',
    emptyStateDescription: 'Fill in the form on the left and click Generate, AI will create a structured Personal Statement mind map for you.',
    generationTime: 'Estimated generation time 30-60 seconds',
    remainingUses: '3 left today',
    dailyLimit: '3 free generations per day',
    usageTips: 'Usage Tips:',
    tip1: 'Generate 5 structured sections based on Bee Logic framework',
    tip2: 'Upload CV, papers, awards etc. to enhance content',
    tip3: 'Export to Word or image format after generation',
    dragDropFiles: 'Drag & drop files here',
    orClickToBrowse: 'or click to browse',
    dataSecurity: 'Data Secure',
    word500: '500 words (Brief)',
    word750: '750 words (Standard)',
    word1000: '1000 words (Detailed)',
    word1500: '1500 words (In-depth)',
    word2000: '2000 words (Complete)',
  },
  zh: {
    appName: 'PS Mind Map',
    appSubtitle: 'AI 个人陈述生成器',
    schoolName: '学校名称',
    programName: '项目名称',
    required: '*',
    targetWords: '目标字数',
    referenceLinks: '参考链接',
    optional: '（可选）',
    projectUrl: '项目网站 URL',
    curriculumUrl: '课程页面 URL',
    activitiesUrl: '活动页面 URL',
    supplementaryMaterials: '补充材料',
    supportedFormats: '支持 PDF/Word',
    uploadHint: '点击上传或拖拽文件',
    generateMindMap: '生成思维导图',
    reset: '重置',
    downloadXMind: '下载 XMind',
    systemRunning: '系统运行正常',
    ready: '准备就绪',
    noMindMap: '暂无思维导图',
    emptyStateDescription: '填写左侧表单信息并点击生成按钮，AI 将为您创建结构化的 Personal Statement 思维导图',
    generationTime: '预计生成时间 30-60 秒',
    remainingUses: '今日剩余 3 次',
    dailyLimit: '免费用户每日 3 次生成机会',
    usageTips: '使用提示：',
    tip1: '基于 Bee Logic 框架生成 5 个结构化部分',
    tip2: '可上传简历、论文、奖项等材料增强内容',
    tip3: '生成后可导出为 Word 或图片格式',
    dragDropFiles: '拖拽文件到此处',
    orClickToBrowse: '或点击浏览',
    dataSecurity: '数据安全',
    word500: '500 字（简短版）',
    word750: '750 字（标准版）',
    word1000: '1000 字（详细版）',
    word1500: '1500 字（深度版）',
    word2000: '2000 字（完整版）',
  },
};
