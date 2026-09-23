# ECS Docker Compose 部署指南

华为云 ECS 上使用 Docker Compose 部署 cloud-demo 的操作手册。

## 1. 前置条件

- ECS 实例已创建，操作系统 Linux（推荐 Ubuntu 22.04 或 EulerOS 2.12）
- 已安装 Docker Engine 24+ 与 Docker Compose v2
- 已创建华为云 RDS（PostgreSQL 16）与 DCS（Redis 7）实例
- 已通过 VPC 内网打通 ECS ↔ RDS、ECS ↔ DCS

## 2. 安全组规则

### ECS 安全组（入方向）

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 80 | 0.0.0.0/0 | Nginx 公网入口 |
| TCP | 22 | 管理网段 | SSH 运维 |

### RDS 安全组（入方向）

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 5432 | ECS 内网 IP 段 | 仅允许 ECS 访问 |

### DCS 安全组（入方向）

| 协议 | 端口 | 来源 | 说明 |
|------|------|------|------|
| TCP | 6379 | ECS 内网 IP 段 | 仅允许 ECS 访问 |

## 3. RDS / DCS 内网连接

RDS 与 DCS 必须与 ECS 在同一 VPC，通过内网地址连接：

```ini
# .env 中配置内网地址
RDS_HOST=192.168.x.x    # RDS 内网 IP
RDS_PORT=5432
RDS_DATABASE=cloud_demo
RDS_USER=cloud_demo
RDS_PASSWORD=<strong-password>
RDS_SSL=true

REDIS_HOST=192.168.x.x  # DCS 内网 IP
REDIS_PORT=6379
REDIS_PASSWORD=<dcs-password>
```

> 切勿使用公网地址连接 RDS/DCS，既不安全也增加延迟。

## 4. 数据库迁移

首次部署或版本升级时执行迁移：

```bash
# 方式一：容器启动时自动执行（docker-compose 已挂载 migrations 到 entrypoint）
docker compose up -d postgres

# 方式二：手动执行
docker exec -i cloud-demo-postgres psql -U cloud_demo -d cloud_demo < db/migrations/001_init.sql
```

## 5. 启动

```bash
cd cloud-demo
cp .env.example .env
# 编辑 .env，填入 RDS/DCS 内网地址与密码、API_TOKEN

docker compose up -d
docker compose ps    # 确认三个容器均为 healthy
```

Nginx 反向代理配置参见 `deploy/nginx.conf`，将 80 端口流量转发到 8787。

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/cloud-demo
sudo ln -s /etc/nginx/sites-available/cloud-demo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. 健康检查

```bash
# 容器级
docker compose ps

# 应用级
curl http://127.0.0.1:8787/health

# 预期响应
# {"status":"ok","service":"cloud-demo","checks":{"api":{"status":"up"},"rds":{"status":"up"},"redis":{"status":"up"}}}
```

若 `status` 为 `degraded`，检查 `checks.rds` 与 `checks.redis` 的 `detail` 字段。

## 7. 回滚

```bash
# 查看历史镜像
docker images cloud-demo-app

# 回滚到上一版本
docker tag cloud-demo-app:<prev-tag> cloud-demo-app:latest
docker compose up -d

# 数据库回滚（如有需要）
# 1. 备份当前数据库
docker exec cloud-demo-postgres pg_dump -U cloud_demo cloud_demo > backup.sql
# 2. 恢复到上一版本迁移
# 3. 重启应用
docker compose restart app
```

## 8. 日志与排查

```bash
# 查看应用日志
docker compose logs -f app

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 进入容器排查
docker exec -it cloud-demo-app sh
```