# 小苋内容工作台 · Xiaoxian Content Studio

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-EA3F10.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-314E3F.svg)](package.json)

一个本机优先的多平台内容工作台：把选题和文字变成 HTML 图卡，经过人工审核后，写入微信公众号、小红书和抖音草稿。最终发布始终由用户完成。

![小苋内容工作台](preview-workspace.jpg)

## 为什么做它

内容创作不缺生成按钮，缺的是清楚的边界：内容、图卡、审核和平台草稿各自负责一件事。这个项目把四个阶段放在同一个本机工作台中，同时保留人工审核、版本失效和平台发布边界。

## 能力

- 自由编排的 1080 × 1440 HTML 图卡，可导出 PNG 与交付 ZIP。
- 内容确认、逐图审核、版本指纹和上游修改失效机制。
- Lucide 与 Tabler 共 8,104 个本机 SVG 素材，支持中文同义词搜索。
- 微信公众号草稿接口，以及小红书、抖音的本机浏览器草稿自动化。
- 小红书和抖音先校验独立浏览器登录状态，再开放自动填写。
- 只填写草稿；代码没有正式发布端点，浏览器脚本不点击“发布”。

## 本机启动

需要 Node.js 20+ 和 Google Chrome。

```sh
npm install
npm run build
npm start
```

打开 <http://localhost:4318>。服务只绑定 `127.0.0.1`，不会开放到局域网。macOS 也可以双击 `启动小苋工作台.command`。

本机数据保存在 `.local-data/`，该目录已加入 `.gitignore`：

- `projects.json`：项目内容与审核记录
- `browser-profiles/`：小红书、抖音的独立 Chrome 登录会话
- `draft-jobs/`：草稿任务状态

项目不会读取或导出平台密码。公众号凭证从本机环境读取，不进入网页、项目 JSON 或 Git 仓库。

## 工作流

1. **内容**：明确主题、读者收益、事实和必要解释。
2. **图卡**：选择编排、配色和素材，实际导出检查裁切与可读性。
3. **审核**：用户逐张检查，确认最终成图。
4. **草稿**：适配各平台标题、说明和话题，写入草稿或下载交付包。

更完整的职责、确认和失效条件见 [WORKFLOW.md](WORKFLOW.md)。项目内 Agent Skills 位于 [.agents/skills](.agents/skills)，创作方法和研究取舍见 [research/创作方法研究.md](research/创作方法研究.md)。

## 平台边界

- **微信公众号**：调用现有本机草稿接口，只创建和读回草稿。
- **小红书 / 抖音**：使用 Playwright 打开独立 Chrome，上传审核图片并填写标题、正文和话题。会话失效、验证码或页面结构变化时停止并交给用户。
- **所有平台**：没有自动发布功能。

平台页面会变化，浏览器自动化应视为可维护的适配器，而不是平台官方 API。使用者需要遵守对应平台条款。

## 开发与验证

```sh
npm run build
npm test
```

测试覆盖审核约束、版本冲突、同源限制、平台字数、自动草稿状态和正式发布端点缺失。测试使用隔离数据和模拟草稿驱动，不调用内容平台远程接口。

## 开源、致谢与贡献者

项目代码、文档和项目内原创 Skills 使用 [Apache License 2.0](LICENSE)。选择它是因为它允许复用与商用，同时包含明确的专利授权、变更说明和贡献条款。

“小苋AI圈”名称、Logo、人物照片和个人形象不在 Apache-2.0 授权范围内，详见 [BRAND.md](BRAND.md)。第三方项目、Agent Skills 和运行时依赖的作者与许可证记录在 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

GitHub 的 Contributors 图表来自真实 commit。灵感来源不会被伪装成代码作者；我们用可核实的仓库链接和许可证认真致谢。提交代码、设计、文档、测试或研究都欢迎，参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

Copyright 2026 Xiaoxian AI Circle contributors.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
