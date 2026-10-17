# 0.1.0 GitHub 最低维护配置草案

记录于 2026-10-17，适用于 [公开准备计划](public-readiness.md) 的 F-G／P5／P7。本页是可审阅的配置方案和只读快照；尚未修改 GitHub 远端设置、选择项目许可证或承诺安全响应时限。公开授权、发行物许可与历史贡献同意分别属于 F-A／F-B／F-C，不能由维护文件代替。

## 已落盘的入口

- 根目录 [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) 说明源码准备、报告所需信息、原创或获授权样本、测试证据和当前无项目许可证的边界。
- 根目录 [`SECURITY.md`](../../../SECURITY.md) 说明私密报告入口的条件；如 GitHub 私密报告不可用，只允许创建不含漏洞细节的请求私密联系渠道 Issue。用户于 2026-10-17 指定仓库管理员团队负责漏洞及依赖告警，公开后使用 GitHub 私密漏洞报告；具体轮值、通知订阅和渠道可达性尚待管理员实际配置与验收。
- `.github/ISSUE_TEMPLATE/` 提供 bug／功能请求模板与安全指引链接；`.github/pull_request_template.md` 提醒验证范围、内容授权与凭据检查。模板只有进入默认分支后才会出现在新建页面。

这些文件不授予代码或资产的再发布许可。外部代码接收流程必须等待项目许可与贡献条款决定。

## 只读设置与检查名

本次只读查询目标为 `KongouAirlines/ivaraige`。`GET /repos/{owner}/{repo}` 显示 `private=true`、默认分支 `main`、当前调用身份为 maintain 而非 admin；`GET /branches/main` 显示 `protected=false`、HEAD `c8a146dd9b434773c9c149e4fe67ed0a6da3bb1f`。`GET /rulesets` 返回 403，提示需要升级套餐或将仓库设为公开；`GET /branches/main/protection` 返回 404。Actions 权限、默认 token 权限、外部分支运行审批接口本次均返回 404；这些结果不能确认设置值，应由管理员在应用前复核。`GET /dependabot/alerts` 返回 403 且提示告警未启用。`GET /security-advisories` 返回 404，不能据此判定私密漏洞报告已启用或没有历史报告。仓库当前仍是私有，私密漏洞报告的公开仓库入口尚不能由此验证。

现有唯一工作流是 [Kernel distribution smoke](../../../.github/workflows/kernel-smoke.yml)，触发于 push 和 pull_request，显式 `contents: read`，使用 GitHub 托管的 Ubuntu／Windows／macOS runner；没有 `pull_request_target`。从 main HEAD 的实际 check runs 读取到以下**精确检查名**，提供者均为 `github-actions`：

| 所需检查名 | main HEAD 状态（2026-10-17） |
| --- | --- |
| `ubuntu-latest / Node 24` | failure |
| `windows-latest / Node 24` | failure |
| `macos-latest / Node 24` | failure |

本次进一步读取 [`main` 的运行 38744374368](https://github.com/KongouAirlines/ivaraige/actions/runs/38744374368)：三个 job 的步骤数均为 0；各自 check-run 注释都指出因近期账户付款失败或消费限额需增加，作业未启动。可确定是启动前的账户计费门槛，不能当作测试断言失败，也不能从注释进一步判定欠款或具体额度。[公开准备计划 §3.2](public-readiness.md#32-最近红灯的实际根因) 保留其他证据。应用“必需检查”之前，要让目标提交上的三个检查真正执行并成功，并确认 GitHub 设置页提供这些检查名；GitHub 要求必需检查曾在仓库内最近七天成功运行。工作流如改名、增减矩阵或过滤触发路径，必须同步更新规则，否则 PR 可能无法合并。

## 拟应用的 main 规则

所有者确认维护角色和权限后，在仓库满足对应套餐条件时，为**精确分支 `main`** 建立一条分支保护规则。建议设置如下，最终例外策略见下文待决项：

| 项目 | 建议值及原因 |
| --- | --- |
| PR 流程 | 合并前需要 PR、1 位有权限者批准；避免直接推送未经审阅的外部变更。暂不要求 CODEOWNERS、多级审批或 merge queue。 |
| 检查 | 必需 `ubuntu-latest / Node 24`、`windows-latest / Node 24`、`macos-latest / Node 24`；绑定实际 GitHub Actions App ID `15368`（应用前复核）。`strict=false`（不强制每次随 main 更新重跑），减少三系统重复运行，合并者仍应检查基线冲突。 |
| 审阅状态 | 要求解决对话；启用“新提交使旧批准失效”，确保批准后的实质改动重新经过审阅。 |
| 历史保护 | 禁止强推和删除 main。 |
| 管理员 | **建议包含管理员**执行检查和 PR 规则；若所有者需要紧急绕过，应先确定谁可执行、记录方式及事后复核，再决定是否保留默认管理员例外。不得把默认例外误写成已启用保护。 |

GitHub Free 的私有仓库不提供这类分支保护；官方文档说明 GitHub Free 公开仓库可用。因而当前仅保存配置意图，公开且 CI 成功后才应用并读回验证。若在私有状态维持更久，需要升级套餐或接受规则暂不可用的事实；不通过移除必需检查或改用高权限 token 绕过。

当前只读调用身份只有 maintain 权限，不能执行该管理设置；即使所有者批准方案，也必须由具有仓库 admin 权限或相应规则管理权限的执行者操作，并在执行时重新确认套餐与分支状态。

下列是对应 `PUT /repos/KongouAirlines/ivaraige/branches/main/protection` 的**拟议请求体**，仅用于审阅；管理员例外若被所有者另行选定，应在执行前修改 `enforce_admins` 并记录理由。执行前还须核对当前 API 字段、检查来源及成功记录。

```json
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "ubuntu-latest / Node 24", "app_id": 15368 },
      { "context": "windows-latest / Node 24", "app_id": 15368 },
      { "context": "macos-latest / Node 24", "app_id": 15368 }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

## Actions、依赖与安全设置

公开后在 **Settings → Actions → General** 选择 **Require approval for all external contributors**；对应 API 值为 `all_external_contributors`。外部 fork 的工作流需由具有 write 权限的维护者先查看改动再批准。保持 `GITHUB_TOKEN` 默认只读、现有工作流的 `contents: read`，不向 fork PR 传送 secrets、variables 或写 token；若组织策略更严格，以组织策略为准。当前调用身份无法读取这些远端设置，应用后必须由管理员读回并用外部 fork PR 验证审批效果。外部 PR 从 fork 使用 `pull_request`，该工作流没有自托管 runner 或发布步骤；日后新增部署、凭据或触发器时重新审阅边界。

在 **Settings → Security and analysis / Advanced Security** 中启用 Dependency graph、Dependabot alerts；由已指定的负责人订阅仓库安全告警并定期分流。建议同时开启 Dependabot security updates，让有可用修复的告警生成 PR，仍由人审阅、跑三系统检查后合并。此配置不需要 `.github/dependabot.yml`；该文件主要用于定期版本更新或自定义行为，当前不增加日常更新 PR 噪声。启用后先检查真实告警与通知能否送达，不把先前的 403 当作零告警。对原生 PDF 组件、冻结包和非依赖图覆盖内容继续按 F-B 核验。

公开且接收人就位后，在 **Security → Advisories → Private vulnerability reporting** 启用私密漏洞报告，并从无权限用户视角确认 **Report a vulnerability** 可见且能提交；在此之前 `SECURITY.md` 仅提供不公开漏洞细节的联系请求路径。指定主接收者和替补、各自查看安全报告与 Dependabot 告警的权限；通过私密渠道进行一次不含真实漏洞的路由演练。不要填造邮箱、承诺 SLA 或把未验证的 GitHub 功能写成已开通。

## 应用及验收记录要求

远端设置变化需单独授权。执行前记录目标仓库、可见性、main SHA、GitHub 套餐与负责人；复核协作者和现有 App 的权限边界，但不要在公开文档列出个人身份或凭据。执行后读回规则、fork 审批与安全开关，保留设置差异、变更日期和执行者角色。用原创小样的外部 Issue／PR 验证模板和安全路由；确认外部 PR 运行前需要审批，审批后只有只读 token，三系统标准 runner 真正运行。检查预算／费用与安全告警通知，记录失败类型；不要将待审批或计费阻断写成测试通过。

P7 还需独立验证公开可见的源码、Release、下载和安装路径，及 F-A／F-B／F-C 的授权边界；本页不表示公开准备完成。

## 所有者尚需决定

1. **已决定（2026-10-17）：**漏洞与 Dependabot 告警由仓库管理员团队负责，公开后使用 GitHub 私密漏洞报告。团队安排主接收者／替补轮值并验证通知可达，普通 Issue／PR 由现有维护者分流。
2. 确认 main 管理员是否与其他人一样受 PR／检查约束，及紧急修复需要的例外流程。上表建议默认包括管理员，待所有者选择。
3. 当前私有期间未提供额外私密地址，维持“可访问仓库的报告者仅以无敏感细节的 Issue 请求联系方式”的临时文案；公开后按已决定的 GitHub 私密报告方案启用并验证。

## GitHub 官方依据

- [受保护分支的功能、可用套餐与状态检查](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [分支保护 REST 字段](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection)
- [必需检查最近七天成功的要求](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [公开 fork 工作流审批选项](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Dependabot 告警与安全更新](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)
- [私密漏洞报告的启用条件](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)
- [Issue 模板选择器](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
