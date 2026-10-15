# 海外长文适配与草稿边界

本文件用于 Substack、X Articles 与 Threads 的本期适配。先查看源稿、已审核图卡、本期语言选择和交付记录；不因扩展平台重新创作未经用户确认的事实或静默修改源稿。

## 内容适配

Substack 适合保留完整推理、案例和方法；X Articles 可形成独立完整的长文；Threads 选择能单独讲清楚的一点，正文作为文字附件候选，主帖由用户发布时另行补充。篇幅、大小标题和段落顺序由内容决定，不机械地凑字数或拆固定条数。

海外渠道不自动等于英文。遵循本期 `overseasLanguage` 设置（`en`、`zh` 或 `bilingual`，新建默认 `en`）；用户指定中文时保持中文，英文版本保留作者的第一人称和真实经验，解释陌生的国内产品、术语和背景，采用读者自然理解的措辞。翻译后的数字、效果、引用与边界仍与源稿一致。已发表文章链接只有真实存在且用户提供或核实后才加入，不编造导流地址。

标题承诺须由正文兑现。把源稿的核心判断和证据保留下来，再按平台阅读场景调整开头与节奏；不要用通用的夸张钩子替换具体价值。当前海外交付只处理文字，不自动上传图卡；需要配图时从原项目另行导出审核素材，由用户添加。平台不支持的排版应明确转换或交付，不用图片掩盖缺失的必要正文。

## Substack：Ego Lite 远程文章草稿

- 前置检查 Substack 登录与目标 publication；在工作台或本机 `STUDIO_SUBSTACK_URL` 配置自己的 publication URL，环境变量优先。未配置时可从 `https://substack.com/publish` 检查登录，但自动创建草稿前必须明确配置目标刊物，不能借用默认或第三方 publication。登录、验证码及安全确认由用户处理。
- 从实际页面识别 Article 编辑器，填入标题、可选副标题和正文。编辑器不把 Markdown 原样粘贴视作排版完成；根据当前驱动支持的方式保留段落、标题、列表与链接，并核对真实内容。复杂表格可改为列表或使用已有审核图卡，不必安装外部渲染服务。
- 当前只填写文字，不自动附加图卡。核对标题、副标题、完整正文和实际提供的话题；等待明确保存状态，再回读。话题或保存状态不能核对时保持“待处理”，不要宣称完整交付或重复创建多份。
- 保存 editor URL 以便用户继续检查。停在编辑草稿，不点击 Continue、发布、发送邮件或排期相关操作。
- 本项目采用网页自动化；不是 Substack 官方文章写入 API。只有核实远程保存后才能标记为“已写入草稿”。

## X Articles：官方 API 远程草稿

- 本机配置 `STUDIO_X_ACCESS_TOKEN` 或 `.local-data/overseas-config.json` 中的 `xAccessToken`，环境变量优先。使用用户授权的 OAuth 2.0 access token；需具备 `tweet.read`、`tweet.write` 与 `users.read` scopes。应用级 Bearer Token 不代表用户授权。令牌不写入项目 JSON、日志、网页或交付包，本机配置文件权限应为600。
- 仅使用 `POST https://api.x.com/2/articles/draft`。正文转换为 DraftJS `content_state`，保留有意义的段落与格式；不将 HTML 字符串当作正文格式。
- 成功以平台返回草稿编号为依据，保存编号与所用内容版本；收到编号不代表已回读或验收 X 的最终渲染。当前适配器不上传图片到 X；图片可从原项目另行导出后手动补入，不声称整套图文已上传。X 的独立 `tags` 数组为空；有意义的 hashtag 可按需写进正文，不凑话题。
- 账号权限、授权范围或计费限制以实际 API 响应为准。请求结果未知时先核对已有记录与 X 草稿，避免盲目重试创建；不得调用 `/publish`。

## Threads：本机待发布稿

- 当前只保存站内文案快照与审核版本指纹，状态为本机待发布；不保存额外图片副本、不发送平台 API，不宣称已登录、已上传或已写入 Threads 草稿箱。
- 本机标题只作队列标签，不拼入正文；正文按最长 10,000 字符的文字附件候选编辑，主帖需用户另行补充。平台支持文字附件不代表本项目已接入附件上传或远程草稿接口。
- 用户可以从本机待发布稿复制或下载文稿，图片按需从原项目另行导出，再自行在 Threads 处理上传与发布。

## 本机创作接力

`GET /api/projects/:id/overseas-input` 返回本期任务、`revision` 与 `inputFingerprint`。按任务组织三个平台的 `title`、`body` 与 `tags`；Substack 可另加 `subtitle`，X 的 `tags` 保持空数组。用 `POST /api/projects/:id/overseas-import` 导入完整 envelope：`{revision,inputFingerprint,platforms:{substack:{title,subtitle,body,tags},x:{title,body,tags:[]},threads:{title,body,tags}}}`。导入只保存文案，不代替用户审核，也不触发远程写入。

用户审核之后，`POST /api/projects/:id/overseas-draft` 接受 `{revision,platform,cardFingerprint}` 并使用当前审核快照。Substack / X 返回异步任务，Threads 返回 `queued:true` 并标记 `queued_local`；两种状态不能混用。标题200字符、正文100,000字符是本机资源保护上限，不是写作目标。Threads 按当前10,000字符文字附件和最多一个话题校验。

## 来源与取舍

核验日期：2026-10-15。平台能力会变化，修改适配器前优先重新核对官方文档与真实页面。

- [X Articles 官方介绍](https://docs.x.com/x-api/articles/introduction)：草稿接口、DraftJS 格式及用户授权 scopes。
- [Substack 官方文章与草稿指南](https://support.substack.com/hc/en-us/articles/360037831771-How-do-I-publish-a-new-post-on-Substack)：文章编辑、自动保存及草稿入口。
- [Substack Developer API 条款](https://substack.com/api-tos)：公开 creator / publication 信息范围，不作为文章写入接口文档。
- [Meta Threads 长文字说明](https://about.fb.com/news/2025/09/attach-text-threads-posts-share-longer-perspectives/)：10,000 字符文字附件能力。
- [publish-substack-article](https://github.com/sugarforever/01coder-agent-skills/tree/main/skills/publish-substack-article)（MIT，@sugarforever）：学习“保留长文排版、检查自动保存、交给用户发布”的流程，未复制上游脚本。上游的 Playwright / Chrome DevTools、剪贴板脚本和外部表格渲染依赖没有并入本项目。
- [content-repurposer-sms](https://github.com/blacktwist/social-media-skills/tree/main/skills/content-repurposer-sms)（MIT，BlackTwist）：学习同一事实按阅读场景独立适配的方法，未复制模板，未连接其排期或发布服务；不采用固定帖数、排期和未经证实的流量排名。
