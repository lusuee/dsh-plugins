# dsh-agy-quota-chip

DeepSeek Harness (DSH) 插件：在输入框右侧（模型选择器左侧）紧凑展示 Google Antigravity (agy-link) 的 5小时滚动额度与周额度。

## 特性

1. **精确位置**：注册到 `conversation.input.right` 插槽，紧邻模型选择器左侧。
2. **仅选中模型显示**：当前会话选择 Antigravity 模型（Gemini / Claude / GPT 等）时展示；切换到其他模型（如 DeepSeek）时自动隐藏。
3. **详细额度信息**：
   - 表面紧凑展示：`🟢 5h: 100% · 周: 95%`
   - 配额状态颜色预警：绿色（正常）、黄色（<50%）、红色（<20% / 需重新登录）、橙色（冷却中带倒计时）
   - 悬停详细 Tooltip：显示当前账号、邮箱、5小时重置时间、7天周额度重置时间及 Argon 独立池
4. **一键呼出控制台**：点击该额度胶囊即可打开 Antigravity 控制台。
