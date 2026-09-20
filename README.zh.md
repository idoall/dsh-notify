<h1 align="center">DSH Notify</h1>

<p align="center">为 DeepSeek Harness 提供页内任务通知：清晰状态色、可折叠通知堆叠、提示音与后台标签页提醒。只做实时投递，不保存通知历史。</p>

<p align="center">
  <a href="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@idoall/dsh-notify"><img src="https://img.shields.io/npm/v/@idoall/dsh-notify?label=npm&color=CB3837" alt="npm 版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT"></a>
  <img src="https://img.shields.io/badge/DSH-0.1.6--alpha.1-4B6BFB" alt="DSH 0.1.6-alpha.1">
</p>

<p align="center"><a href="README.md">English</a> | 中文</p>

<p align="center">
  <a href="#能做什么">能做什么</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#设置">设置</a> ·
  <a href="#兼容性">兼容性</a> ·
  <a href="#卸载">卸载</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

> DSH Notify 是 DeepSeek Harness 社区插件，只注册设置区块与页内浮层，不修改 DSH 源码。

会话真正停下、运行失败、向你提问或请求审批时，当前页面右上角会出现通知卡片。goal 自动续跑和排队的下一轮保持安静。一切发生在你已打开的页面内：没有 Service Worker、Web Push、宿主机系统通知或通知历史。

<p align="center">
  <img src="./assets/toast.png" width="70%" alt="增强版通知堆叠：最新的失败通知完整显示，较早的蓝色、橙色和绿色通知等距露出下边缘">
</p>

## 能做什么

- **增强版或柔和版通知样式**：默认的**增强版**使用清晰状态色与四秒短暂提醒条；提醒条只用于吸引注意，不负责关闭通知。**柔和版**提供更克制的视觉效果。卡片会保留到你关闭、打开对应会话或完成卡片内回答为止。
- **可折叠的页内通知栈**：开启默认的**多条通知折叠显示**后，从第 2 条起会折叠：最新卡片完整可读，早期卡片仍保留完整内容并在下方等距露出 `18px` 边缘。鼠标移入或键盘焦点进入时会展开。本页最多保存 50 条活跃卡片；待处理通知优先，其余按最新优先。
- **可追溯的会话跳转**：点通知会打开对应会话并定位到来源轮次。宿主选中会话后，左侧会话树会自动平滑滚动并展示已选行，即使它位于另一个屏幕外工作区。跳转失败时卡片会留在原地说明原因。
- **在卡片内回答**：待回复问题或审批会显示可兼容的输入框选项；卡片内回答与输入框操作同一份宿主交互。
- **提示音与后台提醒**：新通知可以播放内置 WebAudio 或经过校验的自定义提示音，页面在后台时仍可播放。后台标签有未查看通知时，标题和 favicon 会短暂提示。
- **任务噪声控制**：子任务、后台任务和工作流完成通知默认关闭。
- **无历史设计**：通知仅保存在当前页面内存中；刷新即清空，未打开的页面不会收到旧消息回放。

## 快速开始

环境要求：

- 带 Web profile 的 DeepSeek Harness
- Node.js 20 或更新
- 已验证的 DeepSeek Harness：`0.1.6-alpha.1`

从 npm 安装：

```sh
dsh plugin --profile web add @idoall/dsh-notify@latest
```

从 GitHub 安装：

```sh
dsh plugin --profile web add "github:idoall/dsh-notify"
```

从本地克隆安装：

```sh
git clone https://github.com/idoall/dsh-notify.git
cd dsh-notify
npm install
dsh plugin --profile web add "link:$(pwd)"
```

若插件宿主没有热重载客户端，请重新加载 profile 或重启 DSH。客户端注册到 `settings.section` 与 `shell.overlay`，宿主通过 `cordis.patch.yml` 挂载。

> **命名提醒**：无 scope 的 npm 名 `dsh-notify` 属于另一位作者。请安装 **`@idoall/dsh-notify`**。内部 Cordis 名、挂载 id 和 `/plugins/dsh-notify/*` 路由仍保持 `dsh-notify`。

## 设置

**设置 → 通知**提供以预览为先的紧凑控制区：

<p align="center">
  <img src="./assets/settings.png" width="60%" alt="DSH 通知设置：增强版与柔和版选择、折叠通知开关、提示音与任务提醒">
</p>

| 设置项 | 默认 | 作用 |
| --- | --- | --- |
| Toast 位置 | 会话区右上 | 浮层贴在聊天区，并跟随左右侧栏布局变化。 |
| 通知样式 | **增强版** | 增强版使用清晰状态色和短提醒条；柔和版更克制。 |
| 多条通知折叠显示 | **开** | 从两条开始完整显示最新一条，旧卡叠在下方；悬停或聚焦即可展开。 |
| 页内提示音 | **开** | 每条新通知播放提示音，即使 DSH 标签在后台。内置 chime / ping / alert / 静音，也可上传自定义声音。 |
| 子任务 / 后台任务完成时通知 | **关** | 开启子代理、后台任务与工作流的完成通知；默认避免噪声。 |
| 预览与自测 | — | 仅发送当前页面的完成、确认、失败、信息示例；也可重播四种状态、折叠当前示例或清空。不会发系统通知，也不影响真实任务。 |

自定义提示音保存在 profile 数据目录的 `<dataDir>/sounds/`，而非插件安装目录。上传限制 1 MB，支持 `mp3 / m4a / aac / wav / ogg / flac`，文件名必须是单段路径。

## 兼容性

当前发布目标：插件 **`0.3.0`** 已在 DeepSeek Harness **`0.1.6-alpha.1`** 上验证。

| 插件 | 已验证的 DeepSeek Harness |
| --- | --- |
| `0.3.0` | `0.1.6-alpha.1` |
| `0.2.2` | `0.1.6-alpha.1` |
| `0.2.1` | `0.1.6-alpha.1` |
| `0.2.0` | `0.1.6-alpha.1` |
| `0.1.2` | `0.1.6-alpha.1` |

同时在 390px 手机视口检查：设置控件会重排，Toast 会满宽显示且不会被移动端侧栏遮挡。

<p align="center">
  <img src="./assets/mobile.png" width="34%" alt="390px 手机视口：增强版通知栈满宽显示，最新通知下方有等距状态色边缘">
</p>

## 卸载

```sh
dsh plugin --profile web remove @idoall/dsh-notify
```

卸载不会删除 profile 数据目录里的自定义声音或 `settings.json`。通知记录从不写入磁盘。

## 开发

```sh
npm install
npm run verify     # typecheck + 测试 + 构建 + 打包检查
npm run test       # node --test test/*.test.js
npm run build      # dist/index.js、dist/client.js
npm run pack:check # 发布前置条件 + 客户端注册校验
```

## 发版

发版由 tag 驱动。更新 `package.json`、将对应 CHANGELOG 段落移出 `Unreleased`、编写 `release-notes/v<版本>.md` 后，推送发版提交与 tag：

```sh
git tag v0.3.0
git push origin v0.3.0
```

发版工作流会运行 `npm run verify`、打包插件、通过 npm trusted publishing（OIDC）发布，并创建附带 tarball 与 sha256 的 GitHub Release。

## 许可证

MIT，见 [LICENSE](LICENSE)。
