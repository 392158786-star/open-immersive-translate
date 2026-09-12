# 国内 Chromium 浏览器兼容

项目现在生成三个包：

- `dist/`：Edge、Chrome 等支持 `offscreen` 和 `sidePanel` 的完整版。
- `dist-chromium-compat/`：面向 360、QQ、百度、夸克、搜狗等电脑版浏览器的兼容版。
- `dist-chromium-mv2/`：面向较旧 Chromium 内核的 Manifest V2 兼容版。

## 兼容策略

兼容版会从扩展清单中移除以下权限：

- `offscreen`
- `sidePanel`

运行时仍会检测真实能力，而不是根据浏览器名称判断。

### 本地模型

完整版通过离屏文档运行本地模型。

兼容版没有 `offscreen` 时会自动创建一个不可见的扩展后台标签页，并把本地模型运行在该标签页中。该标签页会固定，关闭后下一次翻译会自动重新创建。

### 侧边栏

完整版优先使用浏览器原生侧边栏。

兼容版没有 `sidePanel` 时会在普通标签页中打开知识页或 AI 页面。核心翻译、知识卡和独立知识页仍可使用。

## 构建

```bash
pnpm build
pnpm build:compat
pnpm build:mv2
```

输出目录：

- 完整版：`dist/`
- 兼容版：`dist-chromium-compat/`
- 旧内核兼容版：`dist-chromium-mv2/`

## 安装

在浏览器扩展管理页中打开开发者模式，然后加载已解压的兼容版目录。

如果某个国产浏览器完全不提供“加载已解压的扩展”入口，则不能仅靠扩展包解决，需要对应浏览器开放扩展安装能力或单独提交其扩展商店。
