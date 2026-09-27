# Window seam PR draft — `deepseek-ai/deepseek-harness`

**状态：实现与验证已完成，暂无法提交。** 上游仓库目前不接受外部 PR（`CONTRIBUTING.zh.md`：“很抱歉，我们目前无法接受外部 PR”），GitHub 也拒绝 `CreatePullRequest`（“An owner of this repository has disabled the ability to open pull requests”）。

- 讨论（提案与进展同步）：<https://github.com/deepseek-ai/deepseek-harness/discussions/8044>
- 实现分支：`BotHarness/deepseek-harness` → `feat/desktop-window-contribution`（commit `aa43257`）
- Host 协议代际：4 → 5（新增 IPC 消息类型）
- 第一个 consumer：<https://github.com/BotHarness/dsh-companion-example>

## 上游开放 PR 后如何提交

1. 把上游 `master` 合入分支，重跑检查：

   ```sh
   pnpm exec vitest run apps/desktop/tests apps/desktop-host/tests apps/web/tests
   pnpm run lint:contracts-ready
   pnpm run verify-translation-pairing
   pnpm run build
   ```

2. 提交 PR（正文取下方 “PR description” 一节）：

   ```sh
   gh pr create --repo deepseek-ai/deepseek-harness \
     --head BotHarness:feat/desktop-window-contribution \
     --base master \
     --title "feat(desktop): plugin-contributed windows via a Host service (desktopWindows)" \
     --body-file docs/window-seam-pr-draft.md
   ```

   若 API 仍被拒（组织级策略），改用 compare 页面手动创建：
   <https://github.com/deepseek-ai/deepseek-harness/compare/master...BotHarness:feat/desktop-window-contribution?expand=1>

---

## PR description

实现 [讨论 #8044](https://github.com/deepseek-ai/deepseek-harness/discussions/8044) 提出的 **desktop shell window contribution seam**：插件可以贡献独立桌面窗口（桌面伙伴 / 悬浮球 / 状态 HUD），窗口由 shell 创建并持有，插件接触不到 Electron 窗口 API，也没有新的 manifest 格式。

第一个真实 consumer：[BotHarness/dsh-companion-example](https://github.com/BotHarness/dsh-companion-example)（纯现有插件 API 的主窗口 Slot 版本 + 本 PR 的独立窗口版本，README 里有截图）。

### 改动

**Host 侧**

- `apps/desktop-host/src/windows.ts`（新）：`ctx.desktopWindows` 服务 —— `open(spec)` / `close(id)`，关闭以 `desktop-window/closed` Cordis 事件广播；请求经私有 IPC 与 Electron 主进程通信，带请求超时与错误回传。
- `apps/desktop-host/src/index.ts`：路由 `window-open-result` / `window-close-result` / `window-closed` 到服务。
- `apps/desktop/src/host-process.ts`：`window-open` / `window-close` 消息类型 + 严格校验 + 回复通道；`notifyWindowClosed`。

**Shell 侧**

- `apps/desktop/src/window-contributions.ts`（新）：按 spec 建窗并持有 —— 无边框、透明、置顶（`floating`）、可选点击穿透（`setIgnoreMouseEvents(true, { forward: true })`）、锚点/边距、`skipTaskbar`、最多 8 个；每个字段在进入 Electron 前校验，重复 id / 非法 spec 以拒绝消息返回而不是抛出。
- `apps/desktop/src/preload-surface.ts`（新）：surface 专用 preload，只暴露 surface id 与 boot readiness。
- `apps/desktop/src/main.ts`：接线 manager；把贡献窗口加入 WebSocket 握手放行（否则 surface 的实时流会死）；`bootFailed` 对 surface 只记录日志、不拖垮应用；退出时 `closeAll()`。
- `apps/desktop/src/host-protocol.ts`：协议代际 4 → 5（新增 IPC 消息类型）。

**Client 侧**

- `apps/web/src/surface-boot.ts`（新）：当 URL 带 `?dsh-surface=<package>` 时，把注入的 boot graph 裁剪到该包的**包名依赖闭包**（保留 bootstrap `dsh-client-modules`），surface 窗口只激活自己的 surface 而不是整套 UI。示例中从 66 个条目降到 10 个；surface 插件通过 shadow `root` slot 渲染。

**文档与测试**

- `apps/desktop/README.md` / `README.zh.md` 新增 "Contributed windows"（含 i18n 配对记录）。
- 新增 3 个 spec / 13 个用例：`apps/desktop-host/tests/windows.spec.ts`、`apps/desktop/tests/window-contributions.spec.ts`、`apps/web/tests/surface-boot.spec.ts`。

### 验证

```sh
pnpm exec vitest run apps/desktop/tests apps/desktop-host/tests apps/web/tests   # 1306 passed
pnpm run lint:contracts-ready                                                     # 0 errors
pnpm run verify-translation-pairing                                               # 1134 pairs consistent
pnpm run build
```

手工：`pnpm run dev:desktop` → 插件页安装 `github:BotHarness/dsh-companion-example`（或本地路径）→ 重启 → 出现独立置顶窗口，URL 为 `dsh-app://app/?dsh-surface=dsh-companion-example`。

### 边界与非目标

- 只加 seam，不含任何产品；没有插件 `open()` 时不会产生窗口。
- 初始 combo 脚本仍会整段下载（激活已按闭包过滤）；服务端按 surface 组合、`excludeFromCapture` 与 Computer Use 的窗口 id 注册留作后续。
- 暂不提供 per-window preload API（目前只有 surface id + boot readiness）。
- Linux 没有 Desktop 应用，本 seam 自然只存在于 macOS/Windows 的 Desktop 组合。

### Special things to note

- **可逆性**：纯增量、默认无窗口；不引入新的持久化格式。
- **爆炸半径**：新增私有 IPC 消息类型与 shell 校验；host protocol 代际 +1，因此旧壳配新 runtime（或反向）会在 release metadata 校验处显式拒绝，而不是运行期静默失败。
- **评审重点**：`window-contributions.ts` 的 spec 校验与窗口选项、`main.ts` 的 WebSocket 放行范围、`surface-boot.ts` 的闭包过滤语义（batches 保留原 combo URL，仅收窄条目）。
