// SPDX-License-Identifier: MIT
// Optional local synthetic validation; no model downloads or installation.
import { createApp } from '../src/app.mjs'
import MinerUSource, { verifyMineruBundle } from '../plugins/mineru/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
if (process.argv.length !== 3) throw new Error('usage: node scripts/mineru-live-acceptance.mjs RUN_DIR')
const root=resolve(process.argv[2])
const python=join(root,'venv/bin/python')
const app=await createApp({store:join(root,'live.sqlite'),exportDir:join(root,'exports'),mcp:false,events:false})
const results=[]
let failed=false
try {
  await app.ctx.plugin(MinerUSource,{directory:join(root,'sidecar-data'),command:python,tier:'flash',ocrMode:'auto',timeoutMs:900000})
  console.log('Initial sidecar status:',app.parse.componentStatus())
  for(const name of ['mixed','scan']) {
    const source=join(root,'samples',`${name}.pdf`)
    const input=await readFile(source)
    const t=performance.now()
    console.log(`Starting ${name} (${input.length} bytes)`)
    try {
      const admission=await app.operations.invoke('importDocument',{format:'pdf',adapterId:'mineru',contentBase64:input.toString('base64'),title:`Synthetic ${name}`,language:'en',sourceId:`synthetic-${name}`})
      console.log('Admitted',name,admission)
      const task=await app.tasks.wait(admission.taskId)
      const elapsedSeconds=Math.round((performance.now()-t)/100)/10
      console.log('Task',name,task.state,'seconds',elapsedSeconds,task.error??'')
      const entry={name,state:task.state,elapsedSeconds,taskId:admission.taskId,error:task.error??null}
      if(task.state==='succeeded') {
        const docId=task.result?.document?.id
        if (typeof docId!=='string') throw new Error('Successful import did not return a document ID')
        const doc=app.records.getDocument(docId)
        if (doc.sourceAdapterId!=='mineru' || doc.sourceId!==`synthetic-${name}` ||
            doc.title!==`Synthetic ${name}`) throw new Error('Import returned an unexpected document')
        entry.docId=doc.id
        const units=app.records.listUnits(doc.id,{targetLang:'zh'})
        entry.unitCount=units.length
        entry.translatableCount=units.filter(u=>u.translatable).length
        entry.unitKinds=units.map(u=>u.kind)
        entry.unitTexts=units.map(u=>u.sourceText)
        const record=app.records.record(doc.id)
        if (!await verifyMineruBundle(record.sourceBinding,
          {directory:join(root,'sidecar-data'),storePath:join(root,'live.sqlite')})) throw new Error('Bundle verification failed')
        if (Buffer.compare(await readFile(record.sourceBinding.sourcePath), input) !== 0)
          throw new Error('Original PDF bytes changed')
        entry.binding=record.sourceBinding
        const exported=await app.exporter.exportDocument(doc.id,{contentMode:'source',outputs:[{format:'md'},{format:'json'}]})
        if (exported.artifacts.length!==2 ||
            new Set(exported.artifacts.map(artifact=>artifact.format)).size!==2 ||
            !exported.artifacts.some(artifact=>artifact.format==='md') ||
            !exported.artifacts.some(artifact=>artifact.format==='json'))
          throw new Error('Source MD/JSON artifacts are incomplete')
        for (const artifact of exported.artifacts) await readFile(artifact.path)
        entry.exports=exported
        console.log('Saved bundle',record.sourceBinding.bundlePath,'files',record.sourceBinding.files.length,'export count',exported.artifacts.length)
      }
      results.push(entry)
      if (task.state!=='succeeded') failed=true
    } catch(error) {
      const entry={name,state:'threw',elapsedSeconds:Math.round((performance.now()-t)/100)/10,code:error.code??null,message:error.message,cause:error.cause?.message??null,stack:error.stack}
      console.error('Import error:',JSON.stringify(entry))
      results.push(entry)
      failed=true
    }
    await writeFile(join(root,'live_results.json'),JSON.stringify(results,null,2))
    console.log('Current status:',app.parse.componentStatus())
  }
} finally { await app.dispose() }
const reopened=await createApp({store:join(root,'live.sqlite'),mcp:false,events:false})
try {
  const documents=reopened.records.listDocuments().filter(document=>document.sourceAdapterId==='mineru')
  if (documents.length!==2) throw new Error('Expected exactly two MinerU documents after reopening')
  for (const document of documents) {
    const binding=reopened.records.record(document.id).sourceBinding
    if (binding.adapterId==='mineru') await verifyMineruBundle(binding,
      {directory:join(root,'sidecar-data'),storePath:join(root,'live.sqlite')})
  }
  if (reopened.records.listTasks().some(task=>task.kind==='translate')) throw new Error('Translation task was created')
} finally { await reopened.dispose() }
if (results.length!==2 || results.some(result=>result.state!=='succeeded')) failed=true
if (failed) process.exitCode=1
