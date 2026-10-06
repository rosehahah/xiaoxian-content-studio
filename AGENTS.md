# 小苋内容工作台

修改本项目先读 WORKFLOW.md；用户最新要求优先。工作流以质量标准和交付边界为主，标题、信息量、页数与模板根据内容决定。

用户要求“新建一期内容”或完成一期创作时，先读 `.agents/skills/xiaoxian-create-issue/SKILL.md`，自主选择需要的内容、HTML排版与平台skill。不在每个内部步骤让用户决策。新建内容不等于代替用户确认成图或发布。

做内容读取 `.agents/skills/xiaoxian-content-cards/SKILL.md`；做图卡读取 `.agents/skills/xiaoxian-html-layout/SKILL.md`；平台配文读取 `.agents/skills/xiaoxian-platform-copy/SKILL.md`。均为项目原创规则，研究取舍见 `research/创作方法研究.md`。

本机端口4318，数据 `.local-data`。测试必须使用独立数据目录，不把测试审核写进正式数据。修改后运行 npm run build 和 npm test，视觉功能在浏览器检查。不代替用户审核正式样例，不执行正式发布。
