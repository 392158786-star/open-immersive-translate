# 华为云 RDS 与 Redis 开通记录

## 目标架构

```text
可视化 Demo / 浏览器扩展
            |
            v
      云端 API 服务
        |        |
        v        v
DCS Redis       RDS
热点缓存        持久化翻译记忆
```

## 资源开通要求

### RDS

- 服务：华为云关系型数据库 RDS
- 用途：保存翻译记忆、调用记录和 Demo 演示数据
- 网络：与应用服务位于同一区域和同一 VPC
- 访问方式：优先使用内网地址
- 安全要求：仅允许应用所在安全组访问数据库端口

### DCS Redis

- 服务：华为云分布式缓存服务 DCS Redis
- 用途：缓存热点翻译、缓存状态和短期统计数据
- 网络：与应用服务位于同一区域和同一 VPC
- 访问方式：优先使用内网地址
- 安全要求：仅允许应用所在安全组访问 Redis 端口，并启用密码认证

## 开通方式

优先通过 CodeArts 已有 Skills 完成资源创建，避免手动遗漏网络和安全组配置。

建议提示词：

```text
使用当前项目和已有 Skills，帮我创建华为云 RDS 与 DCS Redis。

区域和规格先让我确认。创建完成后只提供资源名称、内网地址、端口、数据库名、VPC、安全组和连接测试方式。

不要在对话或代码中回显密码。
```

## 需要记录的信息

| 项目 | RDS | Redis |
| --- | --- | --- |
| 资源名称 | 待补充 | 待补充 |
| 区域 | 待补充 | 待补充 |
| VPC | 待补充 | 待补充 |
| 子网 | 待补充 | 待补充 |
| 内网地址 | 待补充 | 待补充 |
| 端口 | 待补充 | 待补充 |
| 数据库名 | 待补充 | 不适用 |
| 安全组 | 待补充 | 待补充 |
| 创建时间 | 待补充 | 待补充 |

密码只保存在本机 `.env.local` 或部署平台的环境变量中，不写入本文档。

## 环境变量模板

```env
RDS_HOST=
RDS_PORT=5432
RDS_DATABASE=
RDS_USER=
RDS_PASSWORD=

REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

API_BASE_URL=
```

## 连通性验证

应用服务需要能够访问 RDS 和 Redis。建议执行：

1. 检查应用安全组能否访问 RDS 数据库端口。
2. 检查应用安全组能否访问 Redis `6379` 端口。
3. 调用云端 `/health` 健康检查接口。
4. 执行一次翻译请求，确认 Redis 和 RDS 均参与处理。

## 证据采集

- Skills 调用和资源创建过程：`evidence/05-skills-rds-redis.png`
- RDS 控制台实例状态：`evidence/06-rds-console.png`
- Redis 控制台实例状态：`evidence/07-redis-console.png`
- 连通性测试结果：`evidence/08-rds-redis-health.png`

截图必须隐藏密码、AK/SK、Token、手机号和账单信息。
