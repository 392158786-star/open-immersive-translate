# 华为云部署与演示指南

## 部署目标

将比赛版本的云端 API 和可视化 Demo 部署到华为云，并通过公网地址在线演示核心功能。

## 推荐部署方式

### 方式一：ECS + Docker Compose

适合首次部署和比赛快速演示。

1. 创建与应用资源处于同一区域的 ECS。
2. 将比赛分支拉取到 ECS。
3. 配置 RDS、Redis 和 API 环境变量。
4. 使用 Docker Compose 启动云端 API 和 Demo。
5. 配置安全组开放 Demo 所需端口。
6. 通过公网 URL 验证演示页面。

### 方式二：CCE

适合需要容器编排和弹性扩缩容的部署方式。比赛阶段如需保证快速交付，优先选择 ECS + Docker Compose。

## 部署前检查

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

同时检查：

- RDS 和 Redis 已创建并可连通。
- 应用服务器与数据库位于同一 VPC。
- 数据库初始化或迁移脚本已执行。
- `.env.local` 未提交到 Git。
- `/health` 接口能够检查 API、RDS 和 Redis 状态。

## 部署提示词

```text
使用已有 auto-deploy Skill，将 cloud-demo 部署到华为云。

先检查 Dockerfile、环境变量、健康检查和数据库初始化脚本。需要处理费用、权限或安全组时停下来让我确认。

部署完成后提供：
1. 公网访问 URL；
2. 健康检查地址；
3. 部署日志位置；
4. 回滚方式。
```

## 部署后验证

1. 打开公网 Demo 页面。
2. 输入测试文本并触发翻译。
3. 第一次请求应显示 Redis 未命中并写入 RDS。
4. 第二次相同请求应显示 Redis 命中。
5. 在 RDS 中确认业务记录已写入。
6. 在 Redis 中确认缓存 Key 已创建。
7. 截图并登记到 `05-evidence-index.md`。

## 回滚方案

- 应用回滚：重新部署上一个已验证的 Git 提交或镜像版本。
- 配置回滚：恢复上一版本环境变量。
- 数据回滚：执行数据库备份恢复，不使用未经确认的破坏性命令。
- 资源变更：保留华为云操作记录和本次部署使用的资源参数。

## 证据采集

- 部署过程和成功日志：`evidence/09-deployment.png`
- 公网 Demo 页面：`evidence/10-public-demo.png`
- 健康检查结果：`evidence/11-health-check.png`
- 回滚说明或演练记录：`evidence/12-rollback.png`

## 网站翻译 Demo 的部署

网站翻译 Demo 是静态产物，与云端 API 分开托管，便于单独更新页面而不用重启服务。

1. 构建：`pnpm build:web-demo`，产物在 `dist-web-demo/`（`index.html` + `assets/`，资源为相对路径，可放在任意子目录）。
2. 将 `dist-web-demo/` 上传到 ECS，由 Nginx 作为静态站点根目录托管。
3. 在页面顶部「API 地址」填入云端 API 的公网地址；也可以让 Nginx 把 API 反代到同域，页面填同域地址即可，避免跨域配置。
4. 演示前确认云端 API 与 RDS、Redis 已连通（`/health` 中 `checks.rds`、`checks.redis` 为 `up`）。

### 接入真实大模型

`cloud-demo` 默认使用确定性占位上游（`UPSTREAM_KIND=mock`），译文会带 `[源->目标]` 前缀，用来证明链路连通。正式演示与截图前必须切换成真实模型：

```dotenv
UPSTREAM_KIND=http
UPSTREAM_BASE_URL=https://<模型或网关地址>
UPSTREAM_API_KEY=<访问令牌>
```

上游契约：`POST {UPSTREAM_BASE_URL}/translate`，请求体 `{ "texts": ["..."], "from": "en", "to": "zh-CN" }`，响应体 `{ "translations": ["..."] }`。华为云 MaaS 等 OpenAI 兼容接口可以套一层该契约的适配服务。

部署后访问 `/health`，`checks.upstream.status` 为 `up` 且 `detail` 显示「真实上游（UPSTREAM_KIND=http）」即表示已切换到真实模型；页面「缓存与健康状态」面板会同步显示该状态。
