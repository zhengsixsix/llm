# 留学申请文书思维导图生成器

基于 Claude AI 的智能申请文书思维导图生成工具。

## 功能特点

- ✅ 自动读取 docs 目录下的申请材料（CV、论文、证书等）
- ✅ 抓取项目官网、课程信息
- ✅ AI 智能生成符合申请逻辑的思维导图
- ✅ 按照"兴趣起源→思考进阶→能力匹配→心仪课程→衷心求学"框架
- ✅ 自动标注文献引用和插图位置

## 项目架构

```
├── src/
│   ├── config/                    # 配置管理
│   ├── services/
│   │   ├── claudeService.js       # Claude AI 服务
│   │   ├── documentService.js     # 文档读取服务
│   │   ├── webScraperService.js   # 网页抓取服务
│   │   └── xmindService.js        # XMind 生成服务
│   ├── utils/
│   │   └── logger.js              # 日志工具
│   └── index.js                   # 主入口
├── docs/                          # 放置申请材料
├── .env                           # 配置文件
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 准备申请材料

在 `docs/` 目录下放置你的申请材料：
- CV/简历
- 论文/研究
- 奖项/证书
- 项目/实习经历

### 3. 配置 .env

```env
SCHOOL_NAME=The University of Hong Kong
PROGRAM_NAME=Museum Studies
PROJECT_WEBSITE=https://portal.hku.hk/...
CURRICULUM_LINK=https://...
TARGET_WORD_COUNT=800
```

### 4. 运行生成

```bash
npm start
```

## 思维导图结构

生成的思维导图包含5个部分：

1. **兴趣起源（30%）** - 个人故事 + 理论分析 + 文献参考
2. **思考进阶（30%）** - 思考深化 + 理论分析 + 文献参考
3. **能力匹配（25%）** - 结合材料展示匹配度
4. **心仪课程（10%）** - 对项目课程的兴趣
5. **衷心求学（5%）** - 求学决心

每2-3句话一个分支，每隔2-3个分支标注插图位置。

## 技术栈

- Node.js
- @anthropic-ai/sdk (Claude API)
- xmind-sdk
- 原生 HTTP/HTTPS 模块
