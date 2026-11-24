# 面板固定状态持久化（panel-pin-persist）

## 问题

左侧栏的插件启动器（面板列表）允许取消固定（unpin）某个面板，但这个选择只存在
内存里（`@deepseek-ai/dsh-client-ui-sidebar` 的 `panel-pins.ts` 用的是
`createSnapshotStore` 纯内存 store，官方 README 也注明这是故意的设计），所以每次
重启后所有面板都会回到固定状态。

## 原理

本插件不修改任何官方文件，而是用"遮蔽重建"的方式接管 `sidebar` 槽位：

1. 官方 bundle 先于用户插件 apply，所以在本插件 apply 时，官方 `SidebarRoot`
   组件已经注册进 `sidebar` 槽，可以直接从 `ctx.slots.entries('sidebar')` 拿到
   原组件引用。
2. 本插件以 `priority: -1` 在同一槽位再次注册（槽位选举规则 lowest renders，
   重复 priority 会抛错，所以必须用不同的、更小的值），渲染时本条目胜出，
   使用的组件仍是原版 `SidebarRoot`。
3. 注入 props 是官方 `injectProps` 的完整复刻（startSession / toggleSidebar /
   selectPanel / trackEntryClick / hooks.panels / hooks.shortcuts /
   hooks.entryActions），唯独 `setPinned` 与 `hooks.entryPins` 换成了本插件自建、
   带 localStorage 持久化的 pin store。
4. 持久化键：`localStorage['dsh.panel-pins.unpinned.v1']`，值为字符串数组
   （unpinned 的面板 id）。启动时读入作为初始状态，因此恢复发生在首帧渲染之前，
   没有闪烁。

## 行为说明

- 与官方逻辑一致：`plugins`（插件启动器）永远固定；取消固定一个已固定的面板、
  或固定一个未固定的面板会直接忽略（幂等）。
- 已卸载/不再注册的面板 id 会留在列表里（官方注释也如此设计），无害。
- 卸载本插件后立即恢复官方行为（内存态，重启即还原）。

## 调试

浏览器控制台：`__panelPinPersist.unpinned()` 查看当前持久化的未固定列表。
