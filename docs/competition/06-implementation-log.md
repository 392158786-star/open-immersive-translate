# 实施日志

记录 P1–P7、运行时修复、部署修复、命令稳定性以及 P8 云端部署前置各阶段的目标、产出、验证与提交号。

## P1 — 项目隔离与配置基线

- **目标**：将 `cloud-demo/` 作为独立包隔离，不污染根扩展构建。
- **产出**：`cloud-demo/package.json`、`cloud-demo/tsconfig.json`、`cloud-demo/eslint.config.js`、`cloud-demo/vitest.config.ts`、根 `vitest.config.ts` 排除 `cloud-demo/**`。
- **验证**：根项目 typecheck / ESLint / Vitest / Vite build 全通过。
- **提交**：`2b8475e`

## P2 — RDS 持久化层

- **目标**：PostgreSQL 仓储实现翻译记忆与请求记录。
- **产出**：`cloud-demo/db/migrations/001_init.sql`、`cloud-demo/src/services/db.ts`、`cloud-demo/src/services/memory-repo.ts`、`cloud-demo/tests/memory-repo.test.ts`。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过（19 测试）。
- **提交**：`982d1f2`

## P3 — Redis 缓存层

- **目标**：ioredis 热点缓存，支持 TTL 与 ping 探针。
- **产出**：`cloud-demo/src/services/cache.ts`、`cloud-demo/tests/cache.test.ts`。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过。
- **提交**：`6e375fa`

## P4a — 上游与编排器

- **目标**：确定性 mock 上游 + 三层编排器（Redis → RDS → upstream）。
- **产出**：`cloud-demo/src/services/upstream.ts`、`cloud-demo/src/services/orchestrator.ts`、`cloud-demo/tests/orchestrator.test.ts`。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过（50 测试）。
- **提交**：`6a1caae`

## P4b — Fastify API 路由

- **目标**：将编排器接入 HTTP 路由，含鉴权与健康检查。
- **产出**：`cloud-demo/src/routes/translate.ts`、`memory.ts`、`stats.ts`、`requests.ts`、`cloud-demo/src/app.ts`、`cloud-demo/src/auth.ts`、`cloud-demo/src/config.ts`、`cloud-demo/src/server.ts`、对应测试。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过。
- **提交**：`e16626f`

## P5 — 可视化 Demo

- **目标**：纯 HTML/CSS/JS 工作台页面，展示翻译输入、结果、缓存统计、调用记录与健康状态。
- **产出**：`cloud-demo/web/index.html`、`styles.css`、`app.js`、`cloud-demo/src/routes/demo.ts`、`cloud-demo/tests/demo.test.ts`、更新 `app.ts` 注册静态路由。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过（63 测试）。
- **提交**：`ed47f4e`

## P6 — 扩展侧 cloud 服务接入

- **目标**：扩展新增可选 cloud 翻译服务，默认 disabled，失败回退 fallbackService。
- **产出**：`src/background/services/cloud.ts`、更新 `types.ts`、`config.ts`、`services/index.ts`、`service-fields.ts`、`ui/shared/i18n.ts`、`tests/background/cloud.test.ts`。
- **验证**：根项目 typecheck 通过、Vitest 486 测试通过、Vite build 成功（ESLint 因 pnpm 环境跳过）。
- **提交**：`c3f4f38`

## P7 — 容器与部署配置

- **目标**：Dockerfile、docker-compose、nginx 反向代理、ECS 部署文档。
- **产出**：`cloud-demo/Dockerfile`、`docker-compose.yml`、`.dockerignore`、`README.md`、`deploy/nginx.conf`、`deploy/ecs-compose.md`。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过。
- **提交**：`53ff407`

## 运行时修复 — Node 原生 TS 兼容

- **目标**：修复 `memory-repo.ts` 构造函数参数属性在 Node type stripping 下报错。
- **产出**：改为显式字段声明与构造函数赋值；全量检查确认 `cloud-demo/src` 无其他参数属性或 TS enum。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过（63 测试）。
- **提交**：`85a7488`

## 部署配置修复 — 本地与华为云隔离

- **目标**：docker-compose.yml 覆盖 HOST 导致 ECS 无法连接外部 RDS/DCS。
- **产出**：新增 `docker-compose.huawei.yml`（仅 app、不覆盖 HOST）；原 compose 加注释标记本地专用；更新 `ecs-compose.md` 与 `README.md`。
- **验证**：cloud-demo typecheck / ESLint / Vitest 通过。
- **提交**：`47855c3`

## 命令稳定性 — AGENTS.md 规则

- **目标**：固化终端命令约束，避免 Windows Bash 包装挂起与沙箱拦截。
- **产出**：更新 `AGENTS.md` 与 `cloud-demo/AGENTS.md`，限定单条原生命令、禁用管道/重定向/shell 包装/npm 脚本。
- **验证**：无代码变更，文档提交。
- **提交**：`32cad8c`、`da37a92`

## P8 前置 — 网站翻译完整融合到云端 Demo

- **目标**：把浏览器扩展的网站翻译能力（正文抽取、渲染注入、模式切换、术语标注、动态内容、云端调用与回退）完整搬进可在云上托管的 Demo 页面，而不是另写一套简化算法。
- **产出**：`src/web-demo/page-translator.ts`（直接复用 `extractParagraphs`、`findMainContent`、`detectTextLanguage`、`decode`、`renderTranslation`、`setMode`、`removeAll`、`injectStyles`、`observeMutations` 与学术术语模块）、`src/web-demo/index.tsx`（真实文章 DOM + 原文/双语/仅中文 + 逐段元数据表）、`src/web-demo/translator.ts`、`vite.web-demo.config.ts`、`tests/web-demo/*`、`docs/competition/07-web-demo-capabilities.md`。
- **验证**：根项目 typecheck / ESLint / Vitest（89 文件 518 测试）/ Vite build / `pnpm build:web-demo` 全通过；cloud-demo 直接 Node 入口 typecheck、ESLint、Vitest（65 测试）通过；浏览器实测 7→8 段落、三种模式、回退与移动端布局。
- **提交**：`694cfc4`（融合）、`abef303`（健康检查增加上游探针）、`f37e375`（语言采样范围、字幕序列化、构建产物忽略、移动端表格）、`1573ff9`（构建与真实模型接入文档）、`195b04c`（E16–E19 证据截图）

## P8 前置 — 稳定性与可验证性加固

- **目标**：让云端对接阶段可以"一键验证、一键部署"，任何改动都能立刻确认是否破坏功能。
- **产出**：`tests/e2e/web-demo.spec.ts` + `playwright.web-demo.config.ts`（6 条端到端用例：渲染与元数据、三模式与 DOM 还原、云端不可达回退、动态段落、移动端无横向溢出、`?api=` 地址注入）；`cloud-demo/scripts/preflight.ts`（RDS/Redis/上游逐项自检，FAIL 时退出码 1）；根 `pnpm verify` 与 cloud-demo `npm run verify`；`cloud-demo/src/services/cache.ts` 增加连接超时、重试上限与错误监听，消除 ioredis 断连刷屏。
- **验证**：`pnpm verify` 全通过；`pnpm test:e2e:web-demo` 6/6 通过；cloud-demo `npm run verify` 65 测试通过；preflight 在未配置时 5 项 WARN、退出码 0，在故意填错地址时 3 项 FAIL、退出码 1。
- **提交**：`d94de1b`、`6457088`、`222983f`

## P8 前置 — 一键部署与公网路由

- **目标**：ECS 上一条命令完成部署；公网同时提供网站翻译 Demo 与云端工作台。
- **产出**：`deploy/deploy-ecs.sh`（拉代码→检查 `.env`→preflight→`docker compose -f docker-compose.huawei.yml up -d --build`→轮询 `/health` 四项 up→输出访问地址与日志命令，并记录实际部署的提交号）；`deploy/nginx.conf`（`/` 静态托管 `dist-web-demo`，`/workbench/` 反代到 Fastify 工作台，`/v1/`、`/health` 反代 API）；`src/web-demo/config.ts`（`?api=` > `VITE_CLOUD_API_BASE` > 默认值）；部署文档与演示脚本更新。
- **验证**：`bash -n deploy/deploy-ecs.sh` 通过；实跑脚本在缺少 `.env` 时给出明确提示并以退出码 1 停止，离线时打印警告并记录当前部署提交；`pnpm verify`、`pnpm test:e2e:web-demo`（6 条含 `?api=`）、cloud-demo `npm run verify`、`npm run preflight` 全通过。
- **提交**：`da88318`、`e21d6dd`
