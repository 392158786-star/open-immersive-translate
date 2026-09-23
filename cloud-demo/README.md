# cloud-demo

Open Immersive Translate 比赛版云端 API 与可视化 Demo。

## 架构

- **Fastify** HTTP 服务，Node 原生 type stripping 直接运行 TypeScript
- **PostgreSQL**（华为云 RDS）持久化翻译记忆与请求记录
- **Redis**（华为云 DCS）热点翻译缓存
- **Mock 上游**确定性离线翻译，可配置为 HTTP 上游

## 快速开始

### 本地开发

```bash
cp .env.example .env
node src/server.ts
```

服务默认监听 `http://0.0.0.0:8787`，健康检查 `GET /health`。

### Docker Compose（本地全栈）

```bash
cp .env.example .env
docker compose up -d
```

启动 app + PostgreSQL + Redis 三个容器，含健康检查与持久化卷。
`RDS_HOST` / `REDIS_HOST` 被强制指向本地容器，仅用于本地开发。
PostgreSQL 初始化脚本从 `db/migrations/` 自动加载。

### Docker Compose（华为云 ECS）

```bash
cp .env.example .env
# 编辑 .env，填入 RDS/DCS 内网地址
docker compose -f docker-compose.huawei.yml up -d
```

仅启动 app 容器，RDS/DCS 地址从 `.env` 读取，不覆盖 `RDS_HOST` / `REDIS_HOST`。
详见 `../deploy/ecs-compose.md`。

## API 端点

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 无 | 健康检查，含 RDS/Redis 探针 |
| GET | `/` | 无 | 可视化 Demo 页面 |
| GET | `/styles.css` | 无 | Demo 样式 |
| GET | `/app.js` | 无 | Demo 脚本 |
| POST | `/v1/translate` | Bearer | 翻译请求 |
| GET | `/v1/memory` | Bearer | 翻译记忆列表 |
| GET | `/v1/stats` | Bearer | 缓存命中统计 |
| GET | `/v1/requests` | Bearer | 调用记录列表 |

## 环境变量

参见 `.env.example`。关键变量：

- `API_TOKEN`：Bearer 鉴权令牌，至少 8 位
- `RDS_HOST` / `RDS_DATABASE` / `RDS_USER`：同时提供才启用 RDS
- `REDIS_HOST`：提供才启用 Redis 缓存
- `UPSTREAM_KIND`：`mock` 或 `http`

## 验证

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
```

## 部署

参见 `../deploy/ecs-compose.md` 了解华为云 ECS 部署流程。
参见 `../deploy/nginx.conf` 了解 Nginx 反向代理配置。