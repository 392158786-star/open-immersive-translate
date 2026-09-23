# 交接状态（给下一个会话看）

> 新会话先读本文件，再读 `docs/competition/06-implementation-log.md`，即可无缝接续。

## 仓库与分支

- 仓库：`C:\Users\39215\Documents\Codex\2026-09-10\wo\work\open-immersive-translate`
- 分支：`competition/huawei-codearts`（已推送到 GitHub）
- 比赛云端包：`cloud-demo/`（Fastify + PostgreSQL/RDS + Redis/DCS + 上游模型）
- 网站翻译 Demo：`src/web-demo/`（复用扩展的抽取与渲染引擎）

## 已完成并验证

- 云端后端 P1–P7、网站翻译与云端融合、E2E 回归、云端自检脚本、一键部署脚本、CI 三组作业
- **卡死修复**：`translationIntegrityMode` 默认 true 导致失败段落无限重试 → 已加最大重试次数（普通 3 / 完整性 5）
- **限流退避**：`scheduler` 对 `RATE_LIMIT` 指数退避 + 降速恢复
- **默认链路改为 Transmart 主**（原生批量 15 段 / 2500 字，实测 15 段 1.5 秒返回）；有道免费降为备用；占位符守卫改为"按数量校验"
- **校验放宽**：大模型服务保持严格校验，普通机器翻译接口放宽（不再因为译文含 JavaScript/ECMA-262 等英文词而丢弃）
- 真实页面实测：MDN JavaScript 页 35 秒内渲染 68 段中文（修复前仅 1 段）
- **分层翻译已提交**：`dc2427e`（`feat(controller): add layered translation with secondary service`），失败段落重试与次级服务均按批发送，次级失败会直接收尾，不再重新回到主服务死循环
- **全量校验**：TypeScript、ESLint、Vitest（91 文件 / 553 测试）、Vite build 全通过

## 分层翻译（已完成）

- 已加：`secondaryService` 配置项（默认 `cloud`，未启用时回退 `local-model`）、控制器分层逻辑、分层服务测试
- 已整理：合并重复的 `translateParagraphIds`，删除未使用的 `PendingRequest.failedParagraphIds` 类型。
- 根因不是 `plainFallbackAttempted`，而是失败段落的重试分别起定时器并发成多个单段请求，导致同批失败段的计数、渲染队列和测试响应错位。
- 修法：新增重试批处理和次级回退批处理，同一时间片内失败的段落合并成一个请求；次级服务失败后标记终态并隐藏原文，不再重置为主服务重试。

## 下一步（按顺序）

1. ~~修上述 4 个测试 → `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全绿 → 提交 `feat(controller): add layered translation with secondary service`~~（已完成，提交 `dc2427e`）
2. 真实页面验证：MDN 页面可见英文接近 0（用 `document.querySelector("main").innerText` 计数，注意不要用 `textContent`，隐藏原文会被误计）
3. 排版与兼容：译文撑破窄容器、标题换行、表格错位、SPA 路由、Shadow DOM、iframe、深色主题
4. 云端：RDS/DCS/ECS 开通后跑 `bash deploy/deploy-ecs.sh`，公网部署 `/`（网站翻译 Demo）与 `/workbench/`（云端工作台），切 `UPSTREAM_KIND=http` 接 MaaS，录视频、打 Tag

## 当前阻塞（2026-09-23）

- 第 2 步暂无法执行：本机 Playwright 完整 Chromium 启动报 Windows side-by-side 配置错误；`chrome-headless-shell` 可启动但不加载扩展；in-app Browser 未加载本项目扩展，Chrome 控制通道不可用。
- 需要先修复/重装 Playwright Chromium，或提供已加载本扩展的 Chrome，再继续 MDN 真实验证。已尝试 MDN 页面打开成功，但扩展注入为 0（`targetCount=0`、无 `style[data-imt="style"]`）。

## 关键事实与坑

- 有道免费接口：3 段即 411 限流，1171 字返回 errorCode 103，不适合做主力
- Transmart：原生数组批量、保留 `{0}` 占位符，是当前最优免费方案
- 提示词（`promptSystem`/`promptUser`）只对模型类服务生效；Transmart 不吃提示词，这是"引导词好像失效了"的原因
- Art（CodeArts）常犯的错：把类型加到错的接口上导致 tsc 失败、留下未使用 import、声称测试通过但实际跳过 tsc/ESLint——**每次都要自己跑一遍全量校验**
- 别提交：`$null`、`artifacts/`、`artifacts-edge-segmentation.png`
