# 第三方软件声明

下表记录直接依赖及其许可证。版本以 `package-lock.json` 为准；依赖仍由各自权利人拥有。

| 依赖 | 当前版本 | 许可证 | 用途 |
| --- | ---: | --- | --- |
| [@tabler/icons](https://github.com/tabler/tabler-icons) | 3.49.0 | MIT | 本机 SVG 素材字典 |
| [lucide-static](https://github.com/lucide-icons/lucide) | 1.52.0 | ISC | 本机 SVG 素材字典 |
| [html-to-image](https://github.com/bubkoo/html-to-image) | 1.11.13 | MIT | HTML 图卡导出 PNG |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.2 | MIT OR GPL-3.0-or-later；本项目按 MIT 选项使用 | 生成交付 ZIP |
| [esbuild](https://github.com/evanw/esbuild) | 0.28.2 | MIT | 构建浏览器资源 |

Lucide 和 Tabler 的完整许可证副本位于 `dist/licenses/`，并随图卡交付包输出。传递依赖的许可证可在 `package-lock.json` 和安装后的各包目录中查看。

本项目对第三方名称的使用仅用于说明兼容性和来源，不表示第三方对本项目提供背书。

浏览器操作通过用户本机安装的 Ego Lite（ego-browser）执行；项目不再捆绑或调用 Playwright 来启动 Chrome。Ego Lite 为外部运行工具，其授权以工具自身说明为准。
