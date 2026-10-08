# 小苋内容工作台 · Xiaoxian Content Studio

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-EA3F10.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-314E3F.svg)](package.json)
[![CI](https://github.com/rosehahah/xiaoxian-content-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/rosehahah/xiaoxian-content-studio/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/rosehahah/xiaoxian-content-studio?style=flat-square&color=EA3F10)](https://github.com/rosehahah/xiaoxian-content-studio/stargazers)
[![All Contributors](https://img.shields.io/badge/all_contributors-9-EA3F10.svg?style=flat-square)](#contributors-)

一个给个人创作者使用的本机内容工作台：灵感来了先记下来，一次整理成内容和图卡，再分别写入微信公众号、小红书和抖音草稿。最后检查和正式发布，仍然由你自己完成。

![小苋内容工作台](preview-workspace.jpg)

## 为什么我做它

我自己就是一个同时维护微信公众号、小红书和抖音的博主。

很多内容最开始只是突然冒出来的一个点子。如果当时没有赶紧记下来、整理出来，过几个小时可能就没有感觉了。但真正准备发布时，我又要反复做这些事情：重新组织文字、制作图卡、改三套标题和说明、检查各平台字数，再去三个创作中心重复上传和粘贴。

灵感可能只花一分钟，后面的搬运却要花很久。事情一多，原本想讲的内容就很容易被拖掉。

所以我做了这个工作台，希望把最麻烦的重复劳动接起来：**我只需要先抓住那个点子，系统帮助我把它推进到三个平台的草稿箱；最终发不发、什么时候发，仍然由我决定。**

## 一个点子怎样变成三端草稿

```mermaid
flowchart LR
    A[记下一个点子] --> B[整理成小白能懂的内容]
    B --> C[制作并审核图卡]
    C --> D[适配三端标题、正文和话题]
    D --> E[写入公众号、小红书、抖音草稿]
    E --> F[自己检查并正式发布]
```

这里的每一步只负责自己的事情：内容没确认，不进入正式内页制作；图卡没审核，不进入平台草稿；平台草稿写好后，系统停在发布按钮之前。

## 它主要替我省掉什么

- 一个灵感只整理一次，不必在三个平台重新从头写。
- 一套审核后的图卡可以继续用于三端，不再反复导出、找图和上传。
- 自动适配不同平台的标题、正文字数和话题数量。
- 登录状态提前检查，准备好后再自动填写创作中心。
- 所有内容先进入草稿箱，保留最后一次人工检查。

它适合同时经营多个内容平台的个人博主、个人 IP 和小团队，尤其适合“点子很多，但容易卡在整理与发布流程”的创作者。

## 能力

- 独立封面制作：可视参考、身份与构图分离、多候选生成导入与用户挑选。
- 按主题组织的原创社媒参考，与独立的HTML/SVG教程内页设计。
- 自由编排的 1080 × 1440 HTML 图卡，可导出 PNG 与交付 ZIP。
- 内容确认、逐图审核、版本指纹和上游修改失效机制。
- Lucide 与 Tabler 共 8,104 个本机 SVG 素材，支持中文同义词搜索。
- 微信公众号草稿接口，以及小红书、抖音的本机浏览器草稿自动化。
- 小红书和抖音先校验 Ego Lite 登录状态，再开放自动填写。
- 只填写草稿；代码没有正式发布端点，浏览器脚本不点击“发布”。


## 选题策划与账号偏好

第一步“选题与内容”新增策划与正文两个页签。新建一期可沿用账号偏好，选择讲懂概念、照着操作或讨论观点，再复制策划任务到 Codex。多个方向返回页面后，由用户选定并进入正文创作；也可直接编辑已有正文。

侧栏“账号偏好”保存常用受众、口吻、内容方式与视觉偏好，只影响之后新建的内容。偏好保存在本机 `.local-data/account-preferences.json`；静态版保存在当前浏览器。

策划接口：`GET /api/projects/:id/planning-input`、`POST /api/projects/:id/planning-import`、`POST /api/projects/:id/planning-select`；偏好接口：`GET/PUT /api/account-preferences`。写入需使用当前revision，策划导入还需inputFingerprint。导入只保存方向，选择后更新简报并撤销旧审核；已有图卡保留。网页尚未接入自动模型生成。

封面页改为看参考、准备素材、挑选封面三段，默认推荐3张参考，支持展开全部参考。候选生成、导入和选择仍不等于用户审核。

## 独立封面制作

新建内容只需主题，不要求先选真人或风格。侧栏“封面制作”与每期“封面”环节独立开放，正文与内页可以继续推进。

1. **先看图**：默认推荐3张参考，可展开全部9类原创社媒参考，也可上传自己的参考。示例介绍可借鉴的信息结构，不强制按风格分类选题。
2. **准备这期素材**：选择使用本人照片或不使用真人。身份照片与构图参考分开保存；参考中的人物不作为用户身份。
3. **组织封面文案**：主标题默认沿用首图标题，也可独立改写；引题、辅助要点、收益条可选。修改只影响封面，不修改已确认正文。
4. **生成候选**：复制任务到当前Codex对话，内置imagegen根据主题与参考逐张生成默认3张不同构图的候选，保存并导入。
5. **挑选成品**：放大检查脸部、文字、构图和承诺，明确选择“本期封面”。导入不自动选中，选择后仍需整期图卡审核。

参考示例学习自然场景、描边标题、清单、收益条、手绘引导、拼贴与文字主视觉等方法。并非开拍官方模板，不承诺点击率或“爆款”效果。研究与约束见[九组参考拆解](research/社媒封面参考拆解-20261007.md)。用户提供的截图只保留在本机研究目录，不作为公开版权素材打包。

**网页按钮复制执行任务，不会自行调用生图模型。** 生图依赖当前Codex环境的内置图片工具，不需要项目API密钥或第三方skill；工具不可用时如实说明。真人生成前查看照片，缺少可辨认真人时引导上传或改为无真人。不会用随机人物或HTML占位代替本人生成结果。

照片与候选保存在本机项目中，支持PNG/JPEG/WebP，单张6MB以内，最多6张候选。更换身份、参考、封面文字或偏好会使旧候选失效并要求重新生成；仍保留对比。内页配色独立调整，不要求重生封面。旧项目和已确认记录继续兼容。

本机接力接口：

- `GET /api/projects/:id/creative-input` 返回portraitPath、独立referencePath、prompt、inputFingerprint、revision及导入/选择地址。
- `POST /api/projects/:id/cover-import` 接受data/name/inputFingerprint/revision，只追加候选；每次导入使用最新响应revision。
- `POST /api/projects/:id/cover-select` 接受candidateId/revision，只能选当前输入的候选，不产生审核。

逻辑见[creative.mjs](creative.mjs)、[cover-library.mjs](cover-library.mjs)与[封面界面](dist/cover-ui.js)。教程内页继续使用可编辑HTML/SVG，不强制与封面同一种风格。最终发布由用户执行，评审前不创建新tag或release。

## 本机启动

需要 Node.js 20+。浏览器登录、草稿填写和页面验收统一使用已安装并连接的 Ego Lite（`ego-browser`），不需要 Google Chrome。

```sh
npm install
npm run build
npm start
```

打开 <http://localhost:4318>。服务只绑定 `127.0.0.1`，不会开放到局域网。macOS 也可以双击 `启动小苋工作台.command`。

本机数据保存在 `.local-data/`，该目录已加入 `.gitignore`：

- `projects.json`：项目内容与审核记录
- 登录会话由本机 Ego Lite 管理；旧 `browser-profiles/` 保留但不再读取或迁移
- `draft-jobs/`：草稿任务状态

`npm start` 会先构建所需资源。大型图标数据、依赖包和复制的运行模块由 `npm run build` 生成，不再提交到 Git；应用源文件仍保存在 `dist/`，请勿整目录删除。双击启动脚本也只拉起 Ego Lite。

项目不会读取或导出平台密码。公众号凭证从本机环境读取，不进入网页、项目 JSON 或 Git 仓库。

## 工作流

1. **选题与内容**：比较方向、确定收益，再完成正文图卡。
2. **封面**：看参考、准备素材、比较并选择候选。
3. **内页**：选择编排、配色和素材，实际导出检查可读性。
4. **审核**：用户逐张检查，确认最终成图。
5. **草稿**：适配各平台配文，写入草稿或下载交付包。

更完整的职责、确认和失效条件见 [WORKFLOW.md](WORKFLOW.md)。项目内 Agent Skills 位于 [.agents/skills](.agents/skills)，创作方法和研究取舍见 [research/创作方法研究.md](research/创作方法研究.md)。

## 平台边界

- **微信公众号**：调用现有本机草稿接口，只创建和读回草稿。
- **小红书 / 抖音**：使用 Ego Lite 的任务页面，上传审核图片并填写标题、正文和话题。会话失效、验证码或页面结构变化时停止并交给用户。
- **所有平台**：没有自动发布功能。

平台页面会变化，浏览器自动化应视为可维护的适配器，而不是平台官方 API。使用者需要遵守对应平台条款。使用 Ego Lite 不意味着平台允许自动化，也不保证免于风控。驱动不可用时明确报错，没有 Chrome 或隐蔽自动化的兜底。

## 开发与验证

```sh
npm run build
npm test
# 封面浏览器验收（Ego Lite；仅使用隔离本机数据）
npm run test:cover-ui
npm run test:topics-ui
npm run test:draft-ui
```

测试覆盖审核约束、版本冲突、同源限制、平台字数、自动草稿状态和正式发布端点缺失。测试使用隔离数据和模拟草稿驱动，不调用内容平台远程接口。

## 开源、致谢与贡献者

项目代码、文档和项目内原创 Skills 使用 [Apache License 2.0](LICENSE)。选择它是因为它允许复用与商用，同时包含明确的专利授权、变更说明和贡献条款。

“小苋AI圈”名称、Logo、人物照片和个人形象不在 Apache-2.0 授权范围内，详见 [BRAND.md](BRAND.md)。第三方项目、Agent Skills 和运行时依赖的作者与许可证记录在 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目采用 [All Contributors](https://allcontributors.org/en/reference/specification/) 规范，同时承认代码、内容方法、设计思路和工具贡献。GitHub 内置 Contributors 图表仍只反映真实 commit；下方表格展示更完整的贡献类型。提交代码、设计、文档、测试或研究都欢迎，参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Contributors ✨

感谢这些创作者、维护者和组织为项目提供代码、内容方法、设计思路或工具。每个符号的含义见 [贡献类型说明](https://allcontributors.org/en/reference/emoji-key/)，具体采用范围和许可证见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<table>
  <tr>
    <td align="center" valign="top" width="20%"><a href="https://github.com/rosehahah"><img src="https://avatars.githubusercontent.com/u/156568457?s=100&v=4" width="100px;" alt="Rose Han"/><br /><sub><b>Rose Han</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#code" title="Code">💻</a> <a href="https://allcontributors.org/en/reference/emoji-key/#design" title="Design">🎨</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a> <a href="https://allcontributors.org/en/reference/emoji-key/#doc" title="Documentation">📖</a> <a href="https://allcontributors.org/en/reference/emoji-key/#maintenance" title="Maintenance">🚧</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/op7418"><img src="https://avatars.githubusercontent.com/u/13505770?s=100&v=4" width="100px;" alt="歸藏"/><br /><sub><b>歸藏</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#design" title="Design">🎨</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/whitthose"><img src="https://avatars.githubusercontent.com/u/293574225?s=100&v=4" width="100px;" alt="whitthose"/><br /><sub><b>whitthose</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/adjfks"><img src="https://avatars.githubusercontent.com/u/91618999?s=100&v=4" width="100px;" alt="corner"/><br /><sub><b>corner</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/classfang"><img src="https://avatars.githubusercontent.com/u/27616248?s=100&v=4" width="100px;" alt="Junki"/><br /><sub><b>Junki</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
  </tr>
  <tr>
    <td align="center" valign="top" width="20%"><a href="https://github.com/aaron-he-zhu"><img src="https://avatars.githubusercontent.com/u/139607425?s=100&v=4" width="100px;" alt="Aaron Zhu"/><br /><sub><b>Aaron Zhu</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/nashsu"><img src="https://avatars.githubusercontent.com/u/2127280?s=100&v=4" width="100px;" alt="nash_su"/><br /><sub><b>nash_su</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#content" title="Content">🖋</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/anthropics"><img src="https://avatars.githubusercontent.com/u/76263028?s=100&v=4" width="100px;" alt="Anthropic"/><br /><sub><b>Anthropic</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#design" title="Design">🎨</a></td>
    <td align="center" valign="top" width="20%"><a href="https://github.com/nextlevelbuilder"><img src="https://avatars.githubusercontent.com/u/246974152?s=100&v=4" width="100px;" alt="Next Level Builder"/><br /><sub><b>Next Level Builder</b></sub></a><br /><a href="https://allcontributors.org/en/reference/emoji-key/#ideas" title="Ideas & Planning">🤔</a> <a href="https://allcontributors.org/en/reference/emoji-key/#design" title="Design">🎨</a></td>
  </tr>
</table>

<!-- ALL-CONTRIBUTORS-LIST:END -->

## Star History

星标曲线从 GitHub 读取后在本机生成，不会把访问令牌交给第三方服务。维护者可运行 `npm run star-history` 刷新明暗两版 SVG。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/star-history-dark.svg" />
    <img alt="Xiaoxian Content Studio Star History" src="assets/star-history.svg" />
  </picture>
</p>

## License

Copyright 2026 Xiaoxian AI Circle contributors.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## 联系小苋

项目使用、内容创作或合作交流，可以扫码添加小苋企业微信。

<p align="center">
  <img src="assets/xiaoxian-wecom-qr.jpg" width="240" alt="小苋企业微信二维码" />
</p>
