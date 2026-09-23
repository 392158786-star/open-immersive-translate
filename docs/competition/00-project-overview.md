# 华为云 AI 创新应用比赛项目说明

## 项目名称

开源沉浸式翻译（Open Immersive Translate）

## 项目定位

本项目是一款可安装到 Chrome、Edge 等浏览器的开源双语翻译扩展。现有版本以浏览器本地能力为核心，支持网页双语对照、PDF 翻译、字幕翻译、学术术语辅助和本地模型兜底。

比赛版本将在不破坏现有扩展能力的前提下，增加可部署到华为云的云端能力：

- 使用华为云 RDS 保存翻译记忆、调用记录和演示数据。
- 使用华为云 DCS Redis 缓存热点翻译和访问状态。
- 新增可视化 Demo 页面，直观展示 RDS 写入、Redis 缓存命中和未命中。
- 使用华为云码道 CodeArts 代码智能体完成需求分析、代码生成、问题修复和部署准备。
- 使用 CodeArts Skills 开通云资源和执行部署。

## 目标用户

- 需要频繁阅读英文资料的普通用户。
- 需要翻译论文、技术文档和视频字幕的学生及研究者。
- 希望使用开源、可审计翻译工具的开发者和企业用户。

## 比赛版本创新点

1. 将原本完全运行在浏览器中的翻译扩展扩展为“端侧能力 + 云侧服务”的组合架构。
2. 使用 Redis 提升热点翻译与状态接口响应速度。
3. 使用 RDS 提供可查询、可统计的持久化翻译记忆。
4. 保留离线或云端不可用时的本地回退能力，避免云服务故障影响核心翻译流程。
5. 通过可视化 Demo 明确展示华为云资源在业务链路中的实际作用。

## 当前分支

```text
competition/huawei-codearts
```

## 开源信息

- 项目许可证：MIT
- 源码仓库：https://github.com/392158786-star/open-immersive-translate
- 比赛分支：https://github.com/392158786-star/open-immersive-translate/tree/competition/huawei-codearts

## 证明材料

所有过程证据统一记录在：

- 文档索引：`docs/competition/05-evidence-index.md`
- 截图目录：`evidence/`
- 可视化图：`docs/competition/diagrams/`

任何密码、Access Key、Secret Key、Token、手机号和个人账号信息都不得进入仓库。
