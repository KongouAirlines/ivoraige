import React from 'react'

const statusLabels = { unchecked: '已配置，尚未验证', ready: '已验证', unavailable: '不可用' }
export function PdfSettings({ capabilities, refreshCapabilities, available = true }) {
  const status = capabilities?.components?.babeldoc
  return <div className="page"><div className="page-head"><div><span className="eyebrow">PDF COMPONENT</span><h2>PDF</h2>
    <p>查看组件状态与本机准备方式。</p></div><button disabled={!available} onClick={refreshCapabilities}>刷新状态</button></div>
    <section className="settings-card"><h3>组件状态</h3><p role="status">{statusLabels[status?.state] || '状态暂不可读'}</p>
      {status?.message && <p className="hint">{status.message}</p>}
      <p>刷新只读取当前状态。首次实际导入或导出时，组件才会验证环境和资产。</p>
      <dl><dt>当前输入格式</dt><dd>{capabilities?.inputFormats?.join('、') || '无'}</dd>
        <dt>当前输出格式</dt><dd>{capabilities?.outputFormats?.join('、') || '无'}</dd></dl></section>
    <section className="settings-card"><h3>准备与启动</h3><p>当前支持原生文本英文 PDF → 中文单语 PDF。模型和密钥在“模型”页管理。</p>
      <p>Windows 开发环境在仓库目录运行准备脚本，再使用 PDF 配置启动服务：</p>
      <pre>./scripts/setup-pdf.ps1{'\n'}node src/cli.mjs serve --store ./evaluation/runs/workbench-0.1.0/store.sqlite --pdf-config ./examples/pdf-windows.json</pre>
      <p>配置文件负责组件命令、超时及资源目录，修改后须重启服务。详细说明见安装包或仓库的 docs/plan/0.1.0/pdf-guide.md。</p>
      <p className="hint">准备脚本首次可能联网下载资源。此页面不会执行脚本、安装组件或启动翻译。</p></section>
  </div>
}
