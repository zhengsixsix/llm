# PS MindMap - 申请文书思维导图生成器

AI 驱动的留学申请文书思维导图生成工具，已整合 LLM 项目的高级功能。

## 新增功能

### 从 llm 项目迁移的功能：
- ✅ 图片搜索和自动嵌入（Unsplash API）
- ✅ XMind 样例文件解析和参考
- ✅ 更完善的 Claude prompt 和 JSON 修复
- ✅ 支持关联线和概要（Summary）
- ✅ 图片节点支持

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env.example` 到 `.env.local` 并填入你的 API 密钥：

```env
CLAUDE_API_KEY=your_claude_api_key
CLAUDE_BASE_URL=https://api.anthropic.com
UNSPLASH_ACCESS_KEY=your_unsplash_key  # 可选，用于图片搜索
```

### 3. 运行开发服务器
```bash
npm run dev
```

访问 http://localhost:3000

## 使用说明

### 基础使用
1. 填写学校名称和专业名称（必填）
2. 可选：填写项目官网、课程链接、活动链接
3. 上传背景材料文件（支持 .txt, .md, .docx）
4. 可选：上传 .xmind 样例文件作为风格参考
5. 点击生成，等待 AI 生成思维导图
6. 下载 XMind 文件

### 样例文件
- 将 .xmind 样例文件放在 `sample/` 目录，或通过界面上传
- AI 会模仿样例的语气、风格和结构

### 图片功能
- 需要配置 `UNSPLASH_ACCESS_KEY`
- AI 生成的节点如果包含 `imageKeyword` 字段，会自动搜索并嵌入图片

## 技术栈

- Next.js 14
- TypeScript
- Anthropic Claude API
- xmind-generator
- Unsplash API（可选）

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── generate/          # 生成思维导图 API
│   │   └── generate-xmind/    # 下载 XMind 文件 API
│   └── page.tsx               # 主页面
├── lib/
│   ├── services/
│   │   ├── claudeService.ts       # Claude AI 服务
│   │   ├── xmindService.ts        # XMind 生成服务
│   │   ├── imageSearchService.ts  # 图片搜索服务（新增）
│   │   ├── sampleService.ts       # 样例解析服务（新增）
│   │   ├── documentService.ts     # 文档处理服务
│   │   └── webScraperService.ts   # 网页抓取服务
│   └── config.ts
└── types/
```

## 迁移说明

已从 `E:\xianyu\llm` 项目迁移以下功能：
- 图片搜索和嵌入功能
- XMind 样例文件解析
- 更完善的 prompt 工程
- JSON 自动修复逻辑
- 关联线和概要支持
