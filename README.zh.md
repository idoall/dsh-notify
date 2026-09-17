<h1 align="center">DSH Notify</h1>

<p align="center">为 DeepSeek Harness 提供页内任务通知：右上角一叠浮层、提示音，以及后台标签页标题闪动。只做实时投递，不存任何历史。</p>

<p align="center">
  <a href="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT"></a>
  <img src="https://img.shields.io/badge/DSH-0.1.6--alpha.1-4B6BFB" alt="DSH 0.1.6-alpha.1">
</p>

<p align="center"><a href="README.md">English</a> | 中文</p>

<p align="center">
  <a href="#能做什么">能做什么</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#使用">使用</a> ·
  <a href="#设置">设置</a> ·
  <a href="#兼容性">兼容性</a> ·
  <a href="#卸载">卸载</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

> DSH Notify 是 DeepSeek Harness 社区插件，挂在官方侧边栏动作行与设置区块里，不修改 DSH 源码。

会话**真正停下**、运行失败、向你提问或请求审批时，当前页面右上角弹出一张卡片。goal 自动续跑、排队的下一轮不会每轮弹一次。点卡片跳回产生该通知的会话（并定位到那一轮），提问与审批还能**直接在卡片上回答**。处理完关掉，它就没了——背后没有历史列表。

一切都发生在**你已经打开的这个页面里**。没有 Service Worker、没有 Web Push、不做宿主机系统通知、也不需要安装任何 App——浏览器与操作系统通知矩阵是被**故意删掉**的：它们失败时对用户不可见（提交成功却永远看不到横幅），且无法跨平台做可靠。

<p align="center">
  <img src="./assets/toast.png" width="70%" alt="右上角通知卡片：图标、标题、正文与关闭按钮">
</p>

## 能做什么

- **页内浮层**：右上角一叠卡片，新消息在最上方。每张卡有标题、正文、会话名、按类型着色的状态色和关闭按钮。点正文跳到该会话，点选项就地回答，回答期间卡片显示 loading，宿主确认后就地变成 ✓ 已完成或 ✗ 加「重试」。**没有任何东西按时间自动消失**：卡片会一直留着，直到你点 × 关闭、点正文跳会话、或在卡上回答成功；如果宿主那边这条记录已被清空/删除，卡片也会跟着退场。
- **堆叠与折叠**：角上常驻三张，新卡入场时把旧卡平滑往下推；**在等你的那张一定在其中**，其余的留在本页、以「+N」计数藏在后面。悬浮（或点「+N」）把整条队列展开成可滚动的卡片列，最新在上、一条都不丢。页面开着期间都会保留，刷新即清空。
- **在浮层里回答**：待回复的提问/审批会渲染与输入框一致的选项。在这里回答和在输入框里回答操作的是**同一个**待处理交互，两边实时同步。
- **精确跳到那一轮**：点一张卡片会打开对应会话，并滚动到（短暂高亮）产生该通知的那一轮。
- **后台也能听见的提示音**：用 WebAudio 在页面内合成（不带任何音频文件），也支持上传自定义音。**页面隐藏时照样响**——浏览器被别的应用挡住时，这是唯一能提醒到你的方式。
- **标签标题闪动**：标签在后台、且有你还#没看过的新卡片时，标题加 🔔 前缀、favicon 交替成红点；你一切回标签就停。
- **噪声默认关**：子任务与后台任务完成通知**默认关闭**（每个子代理、每个后台任务都会弹一条，开久了很乱）。
- **只有实时，没有历史**：通知最不让人意外的行为是「你处理完它就不存在了」，所以插件什么都不存。页面开着时发生的事才会告诉它；不会留一份给你事后翻，页面不在线时发生的事它也不会知道——这就是换来「没有队列、没有已读状态、没有面板要对账」的代价。

<p align="center">


</p>

## 快速开始

环境要求：

- 带 Web profile 的 DeepSeek Harness
- Node.js 20 或更新
- 已验证的 DSH 版本：`0.1.6-alpha.1`（插件 `0.1.2`）

从 GitHub 装进 Web profile：

```sh
dsh plugin --profile web add "github:idoall/dsh-notify"
```

从本地克隆安装（本仓库的开发方式）：

```sh
git clone https://github.com/idoall/dsh-notify.git
cd dsh-notify
npm install
npm run build
dsh plugin --profile web add "link:$(pwd)"
```

重启 DSH，刷新 Web UI。客户端半边把设置卡片挂到 `settings.section`、浮层挂到 `shell.overlay`；宿主半边通过 `cordis.patch.yml` 挂载。

> **命名提醒**：npm 上的 `dsh-notify` 属于**另一位作者**（一个 Windows 托盘通知插件）。本插件没有发布到 npm——请只按上面的 GitHub 或本地克隆方式安装，避免 `dsh plugin add dsh-notify` 装错成别人的插件。

## 使用

1. 跑一个任务。任务**真正停下**、失败或向你提问时，右上角出现一张卡片。
2. 点浮层正文跳到对应会话；点选项就地回答；点 **×** 关闭（会标记为已读）。
3. 点卡片跳到它的会话与轮次，点 **×** 关掉它；提问和审批可以直接在卡片上回答。
4. 切到别的标签继续干活：有待处理、或你离开期间新到的未读时标题会闪，任务完成时会响提示音——即使 DSH 页面在后台。
5. 一切都按 profile 持久化，刷新不会丢历史。

## 设置

**设置 → 通知**：

<p align="center">
  <img src="./assets/settings.png" width="60%" alt="通知设置：Toast 位置、子任务通知、仅剩的一项自测与提示音卡片">
</p>

| 设置项 | 默认 | 作用 |
| --- | --- | --- |
| 已读通知保留 | 一直保留 | 从「已读」列表里隐藏更早的条目（1 / 7 / 30 天）。**永远不会因此隐藏未读**；宿主侧仍按容量上限淘汰最早的已读记录。 |
| Toast 位置 | 会话区右上 | 让浮层跟随会话栏右边缘——无论右侧栏展开还是收起都贴着会话区。 |
| 子任务 / 后台任务完成时通知 | **关** | 否则每个子代理、每个后台任务都会记一条（标题常常是命令行原文）。 |
| 页内提示音 | **开** | 每条新通知响一次，**窗口不在最前也响**。内置 chime / ping / alert / 静音，另可上传自定义音。 |
| 自测 | — | 只有一条通道，所以只有一张卡片；另有高级自测（持久历史、导航与未读、存储往返、去重）。页面加载**不会**自动发送测试。 |

自定义提示音上传到 profile 数据目录下的 `<dataDir>/sounds/`（**不是**插件安装目录），所以重装插件不会丢。上传上限 1 MB，仅支持 `mp3 / m4a / aac / wav / ogg / flac`；文件名必须是单段（不允许 `../` 或子目录）。

## 兼容性

当前发布：插件 **`0.1.2`** 已在 DeepSeek Harness **`0.1.6-alpha.1`** 上验证。

| 插件 | 已验证的 DeepSeek Harness |
| --- | --- |
| `0.1.2` | `0.1.6-alpha.1` |
| `0.1.1` | `0.1.5-rc.1` |
| `0.1.0` | `0.1.5-rc.1` |

更新的 DSH 版本不会自动声明兼容。若将来 DSH 变更导致插件失效，请停用或卸载它——不要去改 DSH 核心。

已在 macOS（Chrome 与 DSH 桌面壳）以及同一 Host 下的手机浏览器远程访问中验证。窄屏会自适应：浮层变成全宽，并被提升到浏览器顶层。

<p align="center">
  <img src="./assets/mobile.png" width="34%" alt="390px 手机视口下的通知卡片：全宽，浮在移动端侧栏之上">
</p>

## 卸载

```sh
dsh plugin --profile web remove dsh-notify
```

卸载**不会**删除通知历史与已上传的提示音；它们在你自己 profile patch 指定的数据目录（`config.dataDir`）里。要清空就删掉那个目录。

## 开发

```sh
npm install
npm run verify     # typecheck + 测试 + 构建 + 打包检查
npm run test       # node --test test/*.test.js
npm run build      # dist/index.js、dist/client.js
```

仓库包含宿主半边（`src/index.js`、`src/core.js`、`src/storage.js`、`src/sounds.js`）、客户端半边（`src/client.js`）以及一套零依赖测试（`test/`）。`dist/` 是构建产物，不入库。

## 许可证

MIT，见 [LICENSE](LICENSE)。
