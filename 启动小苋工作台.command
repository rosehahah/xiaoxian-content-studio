#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
studio_url="http://localhost:4318"
if ! curl -fsS --max-time 2 "$studio_url/api/projects" >/dev/null 2>&1; then
  if ! command -v node >/dev/null; then
    print '未找到 Node.js，请先安装 Node.js 22 或更高版本。'
    read -r '?按回车退出…'
    exit 1
  fi
  if ! npm run build; then
    print '构建未完成，请先在项目中执行 npm ci，再重试。'
    read -r '?按回车退出…'
    exit 1
  fi
  mkdir -p .local-data
  nohup node server.mjs >> .local-data/server.log 2>&1 < /dev/null &!
  for attempt in 1 2 3 4 5 6; do
    curl -fsS --max-time 1 "$studio_url/api/projects" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi
if curl -fsS --max-time 2 "$studio_url/api/projects" >/dev/null 2>&1; then
  if ! command -v ego-browser >/dev/null; then
    print '服务已启动。请安装并连接 Ego Lite（ego-browser）；不会改用其他浏览器。'
    read -r '?按回车退出…'
    exit 1
  fi
  ego-browser nodejs -e 'const task=await taskSpace("小苋内容工作台");const page=task.page("p1");await page.goto("http://localhost:4318/");await task.finish({keep:["p1"]});' || exit 1
  print '小苋内容工作台已启动，浏览器关闭后内容仍保存在本机。'
else
  print '启动未完成，请检查 .local-data/server.log。'
  read -r '?按回车退出…'
  exit 1
fi
