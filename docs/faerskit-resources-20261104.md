# FAERS 通用药名范围流程客户端发布

正式插件目录已更新为 `@zerowallscience/plugin-mcp@0.2.55`，FAERSKit skill 保持已发布的 `zerowall-faerskit@0.1.17`。0.2.54 归档中的 Host 工作流源码与 GitHub `main` 当前源码不一致，本次重新构建并使用新版本发布；旧版本归档保持不可变。

本次客户端交付承接 `ddc8847` 的通用药名范围解析契约和 skill：先从数据库发现候选，按规则分类，解释并确认待审核项，冻结药物范围后分析。名称与成分关联来自同一药物记录；主药、比较药、联用药和排除条件使用对应范围。客户历史药名清单和 201 例仅作为固定范围的回归依据，不能替代通用范围审核。

| 资源 | 版本 | 字节数 | SHA-256 |
|---|---|---:|---|
| MCP 插件 | 0.2.55 | 419,361 | `df01c8ef77c41535fb0e86a75b32ee6be677e4d3bd4e48feffef63b51d285a36` |
| FAERSKit skill | 0.1.17 | 21,203 | `b103ae661e0d8e071820367eed73254bcde61b8e2f2d3a33c9b8f6414cf70a96` |

下载与更新入口：

- [MCP 插件 0.2.55](https://zerowall.chengxunkeji.cn/stable/plugins/plugin-mcp/0.2.55/zerowallscience-plugin-mcp-0.2.55.tgz)
- [FAERSKit skill 0.1.17](https://zerowall.chengxunkeji.cn/stable/skills/zerowall-faerskit/0.1.17/zerowall-faerskit.tgz)
- [插件更新指针](https://zerowall.chengxunkeji.cn/stable/catalogs/plugin-latest.json)
- [Skill 更新指针](https://zerowall.chengxunkeji.cn/stable/catalogs/skill-latest.json)
- [GitHub 发布资产](https://github.com/ccfwwm/zerowall-dsh-plugins/releases/tag/faerskit-resources-20261104)

验证结果：

- MCP Host 与 Client 类型检查通过；回归测试 128 passed、2 skipped。
- 对 MCP 独立 Host 模型进行带诊断的分析，重新生成的 5 个 Typert 文件与现有契约一致；Host 和 Client bundle 从当前源码重新生成。统一桌面构建入口在独立源码仓库中依赖未提供的根级 `typecheck` 命令，故本次使用 MCP 独立类型检查、契约分析、bundle、CSS 处理和定向 pack。没有把该入口失败记为构建通过，也没有修改桌面构建配置。
- 归档内 30 个源码、契约及编译文件与当前文件逐字节一致；包与插件清单的版本均为 0.2.55，编译后的 Host 包含新的药名范围工作流契约。
- stable-4 签名目录包含 40 个插件条目，与发布前目录相比仅 MCP 条目变化；skill 指针和其他插件签名条目保持原值。
- 七牛 `stage`、`promote`、`verify --kind plugin --reuse-published` 全部通过，核验 41 个不可变对象与 1 个签名指针。
- 发布后重新从正式公网指针获取目录与归档，核验 stable-4 签名、目录哈希、归档大小与 SHA-256；FAERSKit skill 的 7 个文件与当前分发源码一致。

GitHub 附件与七牛公开归档字节一致，并提供两个签名 catalog、指针、发布清单和 SHA256SUMS。原始发布回执位于 `artifacts/release/8.4.18/faerskit-resources-20261104/`；该路径沿用独立插件仓库的构建版本，不表示重新发布桌面应用。

用户通过扩展中心更新 MCP 和 skill；MCP 更新后需要重启 Host，skill 可热刷新。本次验证证明公开发布资产与当前源码一致，未代替用户本机 GUI 的加载验收。未增加 CPU 或内存配额，未重新构建桌面或修改无关工作区。
