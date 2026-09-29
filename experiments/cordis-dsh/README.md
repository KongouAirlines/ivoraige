# M1 Cordis + DSH 模型模块复用实验

2026-09-29，Windows / PowerShell，Node v26.7.0。`run.mjs` 10项检查通过，只请求动态端口的 `127.0.0.1` HTTP模拟服务，不需要真实密钥或模型。

## 实际复用

`bridge.ts` 导入固定DSH源码的Cordis `Context/Service`、`LlmRuntime`、`llm-pi-ai`插件、请求构造器和`BlockAssembler`。esbuild打包真实源码依赖闭包（本次58个上游文件），外部SDK由局部npm安装；没有自行实现框架接口冒充复用，没有安装完整DSH工作区或启动agent/UI。

唯一打包适配：保持`llm/src/attribution.ts`的`import.meta.url`为原文件URL，让它读取真实上游package版本。未修改上游源码或调用行为。这是实验构建路径；生产应采用固定包或正式的小闭包构建。

## 重跑

从仓库根目录开始；已有固定提交checkout时直接从`Set-Location`开始：

```powershell
git init experiments/vendor/deepseek-harness
git -C experiments/vendor/deepseek-harness fetch --depth 1 https://github.com/deepseek-ai/deepseek-harness.git 639ed015397290b3745d163aafe02ffee4aa3f84
git -C experiments/vendor/deepseek-harness checkout --detach FETCH_HEAD
Set-Location experiments/cordis-dsh
npm ci --registry=https://registry.npmjs.org --offline=false --cache=.npm-cache --no-audit --no-fund
npm test
```

构建拒绝不同HEAD；局部lock固定传递依赖。Codex Windows沙箱中本地子进程启动曾被`EPERM`限制，经已授权构建升级通过，不是DSH错误。无需给真实模型密钥。

生成bundle、build-evidence、results、npm-cache和node_modules被本目录`.gitignore`排除，可重跑生成。研究记录保留检查结论。

## 实测

| 检查 | 结果 |
|---|---|
| 真实DSH→HTTP SSE | `/v1/chat/completions`，模型与128预算生效；`A:自旋波`；usage 3/2/5 |
| 卸载与换端点重载 | 卸载后NO_ADAPTER；相同调用得到`B:自旋波`，A无新增请求 |
| 凭据引用缺失 | MISSING_CREDENTIAL，无HTTP请求 |
| HTTP 401 | terminal error / AUTH |
| 服务端省略usage | SDK补0/0/0，不能当成已测真实用量 |
| caller取消 | aborted / ABORTED；服务端连接关闭；业务guard阻止下一单位 |
| 消费者iterator.return | HTTP连接关闭 |
| 40ms流空闲超时 | TIMEOUT；HTTP关闭 |
| consumer缺terms | PENDING，apply未执行 |
| 依赖卸载重载 | 活跃计数回0；无重复或残留事件监听 |

未测真实模型、计费、OAuth、凭据文件、settings热更新、图像、tool-call或真实LLM部署。取消下一单位、保存部分流和重启恢复属于业务层；用量未知必须另标unknown。详细模块依赖与源码证据见[研究记录](../../docs/mvp/m1/cordis-harness.md)。
