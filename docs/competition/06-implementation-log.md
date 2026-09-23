# 实施日志

记录 P1–P7、运行时修复、部署修复与命令稳定性各阶段的目标、产出、验证与提交号。

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