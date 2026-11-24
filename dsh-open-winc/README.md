# dsh-open-winc

在会话头部加一个 **Winc** 按钮：点击用 [Winc](https://winc.si) 打开当前会话**实际**的工作目录。

## 为什么需要它

DSH 0.2.2-rc.2 起，`dsh-client-ui-open-in-app` 不再向
`conversation.session.header.utilities` 注册控件，「打开文件夹」按钮被移到了会话头部
的「更多」菜单、会话右键菜单，以及快捷键（桌面 `Ctrl+Alt+O` / Web `Ctrl+Shift+O`）。
本插件把「打开」这件事放回头部，并且只做一件事：用 Winc 打开目录。

另外它修掉一个旧行为：会话头部的 `cwd` 在会话创建时固定，会话搬进 worktree 后仍
指向原目录；本插件优先读 `workingDirectory` 投影（跟随 agent），`cwd` 只作兜底。

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半边：`GET /__dsh-open-winc/status`（是否有编辑器）、`POST /__dsh-open-winc/open`（`{path}` → 启动）、`GET /__dsh-open-winc/icon`（编辑器自带图标） |
| `lib/client.js` | 浏览器半边：向 `conversation.session.header.utilities` 注册一个 `[<Winc 图标> Winc]` 按钮 |
| `cordis.patch.yml` | 把本包插入 profile 的 loader 树（`id: open-winc`） |

## 行为细节

- **目录校验**：只接受绝对路径且必须是已存在的目录，长度上限 4096；失败返回 `{reason: 'bad-path'}`。
- **编辑器查找**：`DSH_OPEN_WINC_EDITOR` → `%LOCALAPPDATA%\Programs\winc\winc.exe` →
  `%ProgramFiles%\winc\winc.exe` → macOS `/Applications/winc.app/Contents/MacOS/winc` →
  `PATH` 上的 `winc`（Windows 为 `winc.exe`）。每进程只探测一次，新装 Winc 需重启 DSH。
- **启动**：`spawn(<winc> , [<dir>])`，`detached` + `stdio: 'ignore'` + `unref()`，编辑器独立于
  DSH 存活；不需要 `-n`（Winc 默认在已有窗口里开文件夹）。
- **安全**：三条路由先问 `ctx.connection.requestRejection(req)`（Host/Origin fence，
  挡 DNS rebinding 与跨站调用，也拒绝未认证的 peer）；请求体上限 64 KiB，必须是 JSON 对象。
- **无编辑器时**：浏览器半边拿到 `available: false` 就不渲染按钮，不留死控件。
- **图标**：宿主从编辑器安装目录读 `winc.ico`，挑其中「≥32px 的最小正方形 PNG 帧」原样返回
  （`image/png`，缓存 5 分钟）。浏览器半边按三级兜底：宿主路由 → 内嵌在 bundle 里的同一帧
  （data URI，宿主还没重启时用它）→ 内置文件夹图标。任何一级失败都不会出现破图。

## 安装位置

```
D:\dsh\plugins\dsh-open-winc                                  ← 本目录（源码即安装目标）
C:\Users\fm\.dsh\profiles\desktop\node_modules\dsh-open-winc ← 指向上面的 Junction
```

`profiles/desktop/package.json` 里登记 `dependencies["dsh-open-winc"] = "link:D:/dsh/plugins/dsh-open-winc"`
与 `dsh.profile.bundles` 里的 `dsh-open-winc`。浏览器半边改动由 client HMR 直接热替换；
宿主半边（`lib/index.js`）改动后需要一次 profile 重组（触碰 profile 的 `cordis.patch.yml`）或重启 DSH 才生效。

## 测试

```powershell
cd D:\dsh\plugins\dsh-open-winc
node test/smoke-host.mjs     # 15 个用例：路径校验、编辑器探测、路由方法/报文/fence、图标提取、挂载
node test/smoke-client.mjs   # 16 个用例：bundle 装载、槽位注册、投影优先的目录选择、图标三级兜底
```
