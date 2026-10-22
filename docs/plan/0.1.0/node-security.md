# Node.js 安全基线（2026-10-22）

软件版本保持 `0.1.0`。本次从 `main/43d3f1fadc4930baa445aeb0cb832b3647aa08d7` 建立 `codex/0.1.0-node-security`，只调整 Node 运行时安全基线、启动检查、Windows 打包、CI 和当前使用指导；npm 依赖版本、DSH、Python 和翻译业务不变。

## 依据与修复边界

[Node.js 2026-10-21 安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)列出本轮修复，其中 CVE-2026-111497 涉及原生 Brotli 解码器。本项目的组件请求使用内置 `fetch`，模型 SDK 也存在自动解压响应的调用链；仅限制 HTTP 服务监听本机不能消除出站响应风险。

源码支持范围改为 `>=24.22.1 <25 || >=26.12.1 <27`，分别对应 [24.22.1](https://nodejs.org/en/blog/release/v24.22.1) 和 [26.12.1](https://nodejs.org/en/blog/release/v26.12.1) 安全发布。不能简写为 `>=24.22.1`，因为那会接受未修复的 `26.7.0`。后续稳定补丁版在各自主版本内可用；其他主版本和预发布版不在本次支持范围内。

`src/runtime.mjs` 读取包的 engines 范围并复用已有 semver，在公开 app 模块加载 DSH 前执行检查。CLI、本机及远程 CLI、launcher、MCP stdio 和公开 API 共用这条检查路径；不支持版本非零退出，诊断留在 stderr，协议 stdout 保持为空。锁文件只同步根包 engines 元数据。

Windows x64 构建固定 `26.12.1`。`scripts/NODE-LICENSE-v26.12.1.txt` 原样提取自官方同版本 Windows ZIP；构建探针和隔离 smoke 都读取实际包内可执行文件版本。升级系统 Node 不会替换已存在便携包的 `runtime/node.exe`，旧程序目录需另外替换并保留外置用户数据。

## 官方下载与本地安装

本次通过官方 HTTPS 地址取得固定发行物并匹配 `SHASUMS256.txt`：

| 发行物 | SHA-256 |
| --- | --- |
| `node-v26.12.1-x64.msi` | `f32a2844504ed8d73449ddb480385f69cb436bc9409a89e2049ae83447078457` |
| `node-v26.12.1-win-x64.zip` | `b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4` |

MSI 的 Authenticode 为 Valid，签名者为 OpenJS Foundation。系统级 MSI 升级返回 `1603 / Error 1730`：移除现有安装需要管理员权限；检查时 `C:\Program Files\nodejs\node.exe` 仍为 `26.7.0`。以下验证使用已校验官方 ZIP 中的 `26.12.1`，便携包则使用其自身目录内的运行时，不依赖系统 PATH。

## 观察到的验证

Windows x64、Node.js `26.12.1`；Python 夹具使用既有 `3.13.12`，未更换 Python 环境。

| 检查 | 观察结果 |
| --- | --- |
| `npm test` | 最终 **258/258**；包含构建、版本范围边界、五类入口的启动拒绝、既有业务及 sidecar 协议测试 |
| 既有 Python 夹具 | sidecar **14/14**，release archive audit **4/4**；没有安装或更新 Python 依赖 |
| 启动拒绝 | 在修复版可执行文件上仅模拟 `process.versions.node=26.7.0`；五类入口 stdout 为空，未向本机接收器发请求，也未创建数据目录或 SQLite 文件 |
| 正常 Brotli 响应 | 本机模型 SSE 响应经过 DSH/pi-ai SDK；组件目录 JSON 和附件经过实际 fetch 解码及现有摘要校验，均通过；没有外部模型、真实凭据或漏洞载荷 |
| `npm run smoke:package` | **68 文件**，隔离安装、同版本替换、持久设置、冻结导出、MCP 与静态 UI 通过 |
| `npm run build:distribution` | Windows 目录 ZIP 构建及 System32-only PATH 启动、启动器、settings/SQLite 探针通过；实际包内 `v26.12.1`，配套许可证与官方 ZIP 原文字节一致 |
| `scripts/smoke-distribution.mjs` | 隔离用户目录和 PATH，程序目录替换、实例复用、重启读回与冻结 MD/JSON 导出通过；模型调用 **0** |

首轮完整测试因新增模型响应夹具变量重名而失败（250 通过、1 个测试文件无法解析）；修正夹具变量后完整重跑得到上述 258/258。

本地详细输出保存在忽略目录 `evaluation/runs/node-security-0.1.0/`，Windows 构建位于 `evaluation/runs/distribution-0.1.0/`。便携包 smoke 是产物隔离验证，`cleanVmAcceptance: false`；未新增 Windows Sandbox、原生 PDF 排版、真实用户库迁移或攻击利用验证。系统 MSI 安装和 ZIP/包内运行时结果分别记录。

CI 配置为三平台 `24.22.1`，另加 Windows `26.12.1`，运行已有 Python 夹具、完整 Node 测试和 npm 包 smoke。配置变更不等于远端检查已通过，结果需按 PR 的实际 head SHA 核对。以上验证不包含要求干净 tag 的正式 Release 校验。
