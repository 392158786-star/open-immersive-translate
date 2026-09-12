# 国外主流浏览器兼容说明

## Chromium 浏览器

Chrome、Edge、Brave、Opera、Vivaldi 和 Arc 使用标准构建：

```bash
pnpm build
```

输出目录为 `dist/`。这一版本保留 `offscreen`、`sidePanel` 和原生侧边栏能力。

如果某个较旧的 Chromium 浏览器拒绝可选权限，可以改用：

```bash
pnpm build:compat
```

## Firefox

构建命令：

```bash
pnpm build:firefox
pnpm lint:firefox
```

Firefox 版本会移除 `offscreen` 和 `sidePanel`。本地模型改在后台扩展标签页运行，侧栏改在普通标签页打开。

Firefox 没有安装在本机时无法执行真机测试，因此发布前仍应使用 `web-ext lint` 并通过 Firefox 临时加载验证。

## Safari

构建命令：

```bash
pnpm build:safari
```

输出目录为 `dist-safari/`。它移除了 Safari Web Extension 不支持或支持不稳定的可选 API，并保留标签页降级逻辑。

Safari 不允许在 Windows 上直接加载解压扩展。最终安装必须由 macOS 上的 Xcode 将 `dist-safari/` 包装成 Safari Web Extension App，再进行签名和分发。没有 Xcode 工程时，这个目录只能作为 Safari 扩展资源，不能直接双击安装。

## 本地模型

所有版本都使用同一套能力检测：

- 支持 `offscreen` 时使用离屏文档。
- 不支持 `offscreen` 时使用后台扩展标签页。
- 支持 WebGPU 时优先使用 WebGPU。
- WebGPU 初始化失败时回退 WASM。
