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
