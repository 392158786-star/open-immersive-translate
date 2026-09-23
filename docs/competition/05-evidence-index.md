# 比赛证据索引

本文件是比赛材料的唯一证据索引。每完成一项关键操作，立即补充一行记录并提交到 `competition/huawei-codearts`。

| 证据编号 | 证明内容 | 截图或链接 | 操作时间 | 对应 Git 提交 |
| --- | --- | --- | --- | --- |
| E00 | 创建并发布比赛分支 | https://github.com/392158786-star/open-immersive-translate/tree/competition/huawei-codearts | 2026-09-23 | 待补充 |
| E01 | CodeArts 已打开项目并识别比赛分支 | `evidence/01-codearts-project.png` | 2026-09-23 | 截图待补 |
| E02 | CodeArts 完成需求理解和实施计划 | `evidence/02-codearts-plan.png` | 2026-09-23 | 截图待补 |
| E03 | CodeArts 生成或修改业务代码 | `evidence/03-codearts-diff.png` | 2026-09-23 | `2b8475e` `982d1f2` `6e375fa` `6a1caae` `e16626f` `ed47f4e` `c3f4f38` `53ff407` `694cfc4` 截图待补 |
| E04 | CodeArts 修复问题并通过检查 | `evidence/04-codearts-validation.png` | 2026-09-23 | `85a7488` `47855c3` `abef303` `f37e375` 截图待补 |
| E05 | 使用 Skills 创建 RDS 与 Redis | `evidence/05-skills-rds-redis.png` | 待完成 | 待完成 |
| E06 | RDS 实例运行正常 | `evidence/06-rds-console.png` | 待完成 | 待完成 |
| E07 | Redis 实例运行正常 | `evidence/07-redis-console.png` | 待完成 | 待完成 |
| E08 | 应用可以访问 RDS 与 Redis | `evidence/08-rds-redis-health.png` | 待完成 | 待完成 |
| E09 | 应用成功部署到华为云 | `evidence/09-deployment.png` | 待完成 | 待完成 |
| E10 | 可视化 Demo 可通过公网访问 | `evidence/10-public-demo.png` | 待完成 | 待完成 |
| E11 | 健康检查全部通过 | `evidence/11-health-check.png` | 待完成 | 待完成 |
| E12 | Redis 未命中、RDS 写入、再次命中 | `evidence/12-cache-flow.png` | 待完成 | 待完成 |
| E13 | 测试、Lint、类型检查和构建通过 | `evidence/13-validation.png` | 2026-09-23 | `2b8475e` `982d1f2` `6e375fa` `6a1caae` `e16626f` `ed47f4e` `c3f4f38` `53ff407` `85a7488` `47855c3` `694cfc4` `abef303` `f37e375` `1573ff9` 截图待补 |
| E14 | 三分钟演示视频 | 待完成 | 待完成 | 待完成 |
| E15 | 最终版本和 Tag | 待完成 | 待完成 | 待完成 |
| E16 | 网站翻译 Demo 逐段渲染译文并展示缓存层/延迟/服务/回退 | `evidence/16-web-demo-translation.png` | 2026-09-23 | `694cfc4` `f37e375` |
| E17 | Demo「仅中文」模式：替换原文并隐藏源文本 | `evidence/17-web-demo-zh-only.png` | 2026-09-23 | `694cfc4` `f37e375` |
| E18 | 云端 API 不可用时逐段回退本地 Mock（回退=是） | `evidence/18-web-demo-fallback.png` | 2026-09-23 | `694cfc4` `f37e375` |
| E19 | Demo 移动端布局无横向溢出，元数据表格容器内滚动 | `evidence/19-web-demo-mobile.png` | 2026-09-23 | `f37e375` |

## 记录规则

1. 截图先保存到 `evidence/`，文件名与证据编号对应。
2. 提交代码后，将实际提交短 SHA 填写到“对应 Git 提交”列。
3. 外部视频或大文件只记录链接，不直接提交到 Git。
4. 截图必须保留 CodeArts、华为云控制台或应用页面的上下文。
5. 所有密钥、AK/SK、Token、手机号和个人账号信息必须打码。
6. 未实际完成的项目不得提前标记为完成。
