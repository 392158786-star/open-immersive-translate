# CodeArts 代码智能体使用记录

## 使用目标

本记录用于证明项目在需求理解、代码生成、项目构建、问题修复和部署上线环节中实际使用了华为云码道 CodeArts 代码智能体。

## 操作环境

- 工具：华为云码道 CodeArts 代码智能体
- 本地项目：`open-immersive-translate`
- 工作分支：`competition/huawei-codearts`
- 开发技术栈：TypeScript、Node.js、Vite、Preact、Vitest

## 证据采集步骤

1. 在 CodeArts 中打开项目，确认窗口标题包含项目名，状态栏显示 `competition/huawei-codearts`。
2. 截图完整 CodeArts 窗口，保存为 `evidence/01-codearts-project.png`。
3. 在智能体中提交需求，截图需求描述和生成计划，保存为 `evidence/02-codearts-plan.png`。
4. 让智能体生成或修改代码，截图代码差异，保存为 `evidence/03-codearts-diff.png`。
5. 让智能体运行类型检查、测试和构建，截图执行结果，保存为 `evidence/04-codearts-validation.png`。
6. 出现问题时继续使用智能体修复，截图修复前后的错误和最终结果。
7. 把所有截图登记到 `05-evidence-index.md`。

## 建议使用提示词

### 需求理解

```text
当前仓库是 open-immersive-translate，分支是 competition/huawei-codearts。

请先只读分析现有项目架构，不要立即修改代码。目标是在保留现有扩展功能的前提下，增加可部署到华为云的云端能力：

1. 使用 RDS 保存翻译记忆和调用记录；
2. 使用 Redis 缓存热点翻译；
3. 提供可视化 Demo 页面；
4. 提供 Dockerfile、环境变量模板、数据库初始化脚本和部署文档。

先给出分阶段实施计划和需要开通的华为云资源，不要写代码。
```

### 代码实现

```text
按已确认的计划实施。每完成一个阶段运行 pnpm typecheck、pnpm lint、pnpm test 和 pnpm build。

不要修改 main，不要提交 .env、密码、AK/SK 或 Token。所有修改进入 competition/huawei-codearts。
```

### 验证命令（原生 Node 入口）

```text
完成后用直接 Node 入口逐条运行验证，不使用 npm/pnpm 包装：

node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run

每条单独执行，超时 120000 ms，无管道、无重定向、无 shell 包装。
```

### 问题修复

```text
请复现当前问题，定位根因，给出最小修复方案，并补充对应测试。修复后重新运行相关测试、类型检查和构建。
```

## 需要保留的关键截图

- CodeArts 已打开项目并识别比赛分支。
- 需求描述和智能体生成的实施计划。
- 智能体修改代码后的 Diff。
- 测试、类型检查、Lint 和构建结果。
- 问题修复过程及最终通过结果。
- 云端部署执行记录和成功状态。

## 注意事项

- 截图需要同时显示 CodeArts 标识、项目名或分支名，避免只截聊天文字而缺少上下文。
- 截图中的密钥和个人信息必须打码。
- 不使用无法复现的截图，不伪造运行结果。
- 关键操作完成后立即提交，提交信息应能对应截图中的操作。
## 命令执行约束

### 禁止 npm 包装

验证一律使用直接 Node 二进制入口，**不使用 `npm`、`pnpm`、`npx`、`yarn` 脚本包装**。原因：沙箱安全策略按命令形态拦截 shell 包装 + 包管理脚本，即使只读命令也会被判定为高危并禁止执行，拿不到退出码和输出。

正确方式：

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
```

### 禁止管道与重定向

不得使用 `|`、`>`、`>>`、`<`、`tail`、`tee`、`;`、`&&`、`||`、`cmd.exe`、`bash -c` 或后台进程。每条命令单独执行，超时 120000 毫秒。

### 内核与命令卡顿处理

Windows Bash 包装存在已知挂起问题：单次工具调用只运行一个原生命令，避免多命令链导致进程僵死。若命令无输出且退出码非零，优先怀疑编译缓存 shim 或沙箱拦截，而非代码问题：

- **typecheck 无输出**：可能是编译缓存 shim 拦截，改用 `node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/tsc.js` 直接调用绕过。
- **ESLint 报 `Cannot find module`**：pnpm 严格隔离导致模块解析失败，属环境问题非代码问题，可跳过 ESLint 只跑 typecheck / Vitest / Vite build。
- **`git push` 超时**：沙箱无外网，本地提交正常，推送留给用户本机执行。
