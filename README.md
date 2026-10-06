# ZeroWall DSH Plugins

ZeroWall Science 的独立插件、Skills 和 MCP 源码总仓库。每个包使用自己的 semver，Windows Desktop 8.0.2 提供统一资源桥接；日常扩展更新无需重新安装整个桌面。

## 使用

- [安装与单独更新教程](docs/extensions-update-guide.md)
- [GitHub 独立插件 Releases](https://github.com/ccfwwm/zerowall-dsh-plugins/releases)
- [ZeroWall Desktop 8.0.2](https://github.com/ccfwwm/zerowallscience/releases/tag/v8.0.2)
- 正式资源通过 `https://zerowall.chengxunkeji.cn/stable/catalogs/` 的 `plugin-latest.json`、`skill-latest.json`、`mcp-latest.json` 查询。

先升级桌面一次，再使用设置内的扩展中心，或启动桌面后运行：

```powershell
zws plugin check
zws plugin update plugin-files
zws skill check
zws skill update zerowall-presentation
zws mcp check
```

默认只检查更新；安装和升级由用户明确触发。使用正式 Ed25519 签名和 SHA-256 校验，版本对象不可覆盖。

## 目录与来源

```text
plugins/       自有插件源码、独立版本、DSH bundle patch 和权限声明
packages/      science 组合 bundle、自定义第三方适配和支持包
store/         科研数据服务支持包
skills/        281 个已适配 Skill 的实际发布内容
mcp/           Server 源码/launcher 与连接模板
catalogs/      正式签名 catalog、pointer 和公钥
config/        兼容清单、源资源版本和集成配置
tools/         插件构建、打包、签名和验证工具
schemas/       资源发布合同
docs/          独立资源管理教程
deepseek-harness/ 固定版本的 DSH 构建接口（Git 子模块）
```

`source-provenance.json` 记录源仓库提交、EXE 构建提交和 DSH 提交。8.0.2 桌面集成仓库保留历史源码以重现该次构建；后续扩展改动在此仓库维护，再同步固定提交到桌面集成，避免两边分别改同一份代码。

## 开发与发布

需要 Node 24.9.0、pnpm 11.7.0 和固定的 DSH 子模块：

```powershell
git clone --recurse-submodules https://github.com/ccfwwm/zerowall-dsh-plugins.git
cd zerowall-dsh-plugins
pnpm install --ignore-scripts
pnpm source:verify
```

插件构建依赖 DSH 的 generator 和共享接口；需要先按 DSH 当前构建合同准备 generator。Desktop 内部共享类型仅作为接口来源保留在 `desktop/src/shared/`，本仓库不打包 Electron。

插件发布使用 `<包名>-v<semver>` 独立 tag/Release；首批 Skills、MCP 与四类 catalog 放在 `resources-8.0.2` 基线 Release 中，之后只发布变化资源的新版本。GitHub tarball 和七牛对象使用相同字节。未变化包不提升版本或重打包覆盖。

`pnpm source:verify` 检查源码版本、DSH 兼容范围及正式 catalog 的签名；它不代替插件类型检查、运行测试和隔离 profile 验收。签名私钥、七牛凭据和用户配置不进入仓库或 Release。

自有代码遵循各包许可证，第三方代码和 Skills 保留原有许可证与来源；不要移除第三方许可说明。
