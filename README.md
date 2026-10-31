# 水果小院

适合 iPad Safari 的个人水果合成小游戏，使用静态 HTML、CSS、JavaScript 和 Matter.js。

游戏入口：https://lxy32167.github.io/fruit-courtyard/

箭头出逃入口：https://lxy32167.github.io/fruit-courtyard/arrows/

`arrows/` 是独立的 iPad 箭头解谜游戏，包含 4,852 个从用户提供安装包提取的关卡布局，支持经典闯关、每日一题、三分钟挑战、提示、缩放平移、存档与深色模式。所有关卡已在本实现的基础碰撞规则下验证可解；主线重新排序，特殊箭头连锁行为尚未还原。运行 `python3 arrows/serve.py` 可在本地启动，完整说明见 `arrows/README.txt`。

## 本地运行

```sh
cd game
python3 serve.py
```

电脑打开 http://localhost:5173。iPad 连接同一 Wi-Fi 后，打开终端显示的局域网地址。

## 玩法

- 拖动瞄准，松手投放，相同水果碰撞后合成。
- 四种道具每局各一次：炸掉指定水果、移除一颗最小水果、指定水果升级、摇晃容器。
- 自动保存当前进度、最高分和声音设置到当前浏览器。
- HTTPS 下支持缓存核心资源，并可添加到 iPad 主屏幕。

## 部署

当前使用 GitHub Pages，从 `main` 分支根目录发布，首页自动进入 `game/`。推送更新后由 GitHub 自动发布。
也可以将 `game/` 作为静态网站目录部署到其他托管服务，无需构建或后端。背景音乐按需加载。
原 Sites 地址当前出现 Cloudflare 拦截，暂不作为可用游戏入口。

## 素材与依赖

游戏逻辑重新实现。水果、道具图像及音频来自用户提供的 Fruit Merge: Match Game 2.85 安装包，原有权利归属不变；本仓库不授予这些素材的再分发或商业使用许可。
Matter.js 0.20.0 的 MIT 许可见 `game/vendor/MATTER-LICENSE.txt`。
仓库仅包含运行游戏所需资源；原始提取目录与托管临时文件未上传。

详细操作说明见 `game/README.txt`。
