# 致谢

这个项目建立在开源社区已经公开的方法、工具和经验之上。下面区分“方法研究”和“直接依赖”，避免把灵感来源误写成代码作者，也避免把第三方许可证混入本项目许可证。

## 内容创作与图卡方法

项目阅读并独立总结了以下公开 Agent Skills。我们借鉴其问题拆解、平台表达和视觉检查思路；除特别说明外，没有复制其模板、脚本或素材。

| 项目与作者 | 本项目学习的部分 | 上游许可证 / 使用边界 |
| --- | --- | --- |
| [Guizang Social Card Skill](https://github.com/op7418/guizang-social-card-skill) · [@op7418](https://github.com/op7418) | 核心观点压缩、HTML 图卡、视觉层级与真实渲染检查 | AGPL-3.0；仅研究方法，未并入上游模板或代码 |
| [Redbook Director Skill](https://github.com/whitthose/redbook-director-skill) · [@whitthose](https://github.com/whitthose) | 封面、内页和结尾承担不同阅读任务 | MIT |
| [Write Xiaohongshu](https://github.com/adjfks/corner-skills/tree/main/skills/write-xiaohongshu) · [@adjfks](https://github.com/adjfks) | 朋友式短句、具体困扰和段落节奏 | 研究时未检测到仓库许可证；只做思想层面的独立总结 |
| [Weixin MP Skills](https://github.com/classfang/weixin-mp-skills/tree/main/wechat-article-write) · [@classfang](https://github.com/classfang) | 术语解释、例子支撑和短段落 | 研究时未检测到仓库许可证；未复制上游文件 |
| [Short Video Scripter](https://github.com/aaron-he-zhu/aaron-marketing-skills/tree/main/social/craft/short-video-scripter) · [@aaron-he-zhu](https://github.com/aaron-he-zhu) | 钩子、承诺、实用内容和单一行动的节拍 | Apache-2.0 |
| [Viral Writer](https://github.com/nashsu/Viral_Writer_Skill) · [@nashsu](https://github.com/nashsu) | 内容洞见、平台差异和标题方向 | MIT |

具体的采用与舍弃记录在 [research/创作方法研究.md](research/创作方法研究.md)，并保留了研究时的 GitHub API 快照。

## 产品与界面方法

- [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) by [Anthropic](https://github.com/anthropics)，Apache-2.0。用于建立清晰的视觉方向和前端完成度标准。
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) by [@nextlevelbuilder](https://github.com/nextlevelbuilder)，MIT。用于可访问性、排版、间距、反馈状态和响应式检查。
- [OpenAI Codex](https://openai.com/codex/) 参与本项目的研究、实现、测试和文档整理。最终产品判断、内容审核和发布边界由项目维护者决定。

## 图标、渲染与自动化

感谢 [Lucide](https://github.com/lucide-icons/lucide)、[Tabler Icons](https://github.com/tabler/tabler-icons)、[html-to-image](https://github.com/bubkoo/html-to-image)、[JSZip](https://github.com/Stuk/jszip)、[Playwright](https://github.com/microsoft/playwright) 和 [esbuild](https://github.com/evanw/esbuild)。版本和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 关于 GitHub Contributors

GitHub 的贡献者图表应当反映真实提交。只有实际共同创作某个 commit、并提供与 GitHub 账户关联邮箱的人，才应使用 `Co-authored-by`。方法来源通过本文件和研究记录长期保留；如果上游作者未来通过 issue、PR、设计或文档参与本项目，会按照真实贡献方式记录。

如果这里的姓名、仓库、许可证或贡献说明不准确，请提交 issue，我们会优先修正。
