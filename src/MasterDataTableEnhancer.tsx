import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { personalCatalogCategories, type PersonalCatalogCategory } from './personalCatalog'
import { backfillPersonalCatalogSynopsis, backfillSynopsisTranslationsPtBr, type SynopsisBackfillProgress } from './synopsis'
import { auditSynopsisTranslationPersistence, type SynopsisTranslationPersistenceAudit } from './synopsisTranslationPersistence'
import { backfillPersistedGenres, characterKnowledgeJson, loadMasterDataSnapshot, type MasterDataSnapshot, type MasterDataWork, type MetadataBackfillProgress } from './masterData'
import { ANIMEFINDER_PORTFOLIO_URL, applyAnimeFinderPdfFooter, createAnimeFinderPdf } from './pdfUtils'

function csvCell(value:unknown){const text=value==null?'':typeof value==='string'?value:JSON.stringify(value);return `"${text.replace(/"/g,'""')}"`}
function download(name:string,content:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function rowToExport(work:MasterDataWork){return{myRanked:work.myRanked,anime:work.displayName,malId:work.primaryMalId,malScore:work.malScore,originalObservations:work.originalObservations,comments:work.comment,characters:work.characterKnowledge.map((r)=>r.name),keywords:work.keywords,genres:work.genres,englishName:work.englishName,originalName:work.originalName,malUrl:work.malUrl,watchStatus:work.watchStatus,malSynopsis:work.synopsis.original,synopsisPtBr:work.synopsis.ptBR,characterKnowledge:work.characterKnowledge}}
function fullExport(snapshot:MasterDataSnapshot){return{animeFinderExportVersion:'supabase-single-source-v1',exportedAt:new Date().toISOString(),sourceOfTruth:'Supabase',generatedAt:snapshot.generatedAt,totalWorks:snapshot.totalWorks,categoryCounts:snapshot.categoryCounts,categories:Object.fromEntries(personalCatalogCategories.map((category)=>[category.id,snapshot.works.filter((work)=>work.category===category.id).map(rowToExport)]))}}

function exportCsv(snapshot:MasterDataSnapshot,category:PersonalCatalogCategory){
  const header=['My Ranked','Anime','MAL ID','MAL Score','Original Observations','Comments','Characters','Keywords','Genres','Full English Name','Original Full Name','MyAnimeList','Watch Status','MAL Synopsis','Synopsis PT-BR','Character Knowledge JSON']
  const body=snapshot.works.filter((work)=>work.category===category).map((work)=>{const row=rowToExport(work);return[row.myRanked,row.anime,row.malId,row.malScore,row.originalObservations,row.comments,row.characters.join(' | '),row.keywords.join(' | '),row.genres.join(' | '),row.englishName,row.originalName,row.malUrl,row.watchStatus,row.malSynopsis,row.synopsisPtBr,row.characterKnowledge].map(csvCell).join(',')})
  download(`AnimeFinder-Master-${category}.csv`,`\uFEFF${[header.map(csvCell).join(','),...body].join('\n')}`,'text/csv;charset=utf-8')
}
function exportJson(snapshot:MasterDataSnapshot){download('AnimeFinder-Personal-Catalog-Supabase.json',JSON.stringify(fullExport(snapshot),null,2),'application/json;charset=utf-8')}

async function exportPdf(snapshot:MasterDataSnapshot,category:PersonalCatalogCategory){
  const doc=await createAnimeFinderPdf({orientation:'landscape',unit:'mm',format:'a4'}), label=personalCatalogCategories.find((x)=>x.id===category)?.label ?? category
  const rows=snapshot.works.filter((work)=>work.category===category)
  const margin=10,pageWidth=297,pageHeight=210,rowHeight=8
  const widths=[13,48,18,47,42,44,55]
  const headers=['Rank','Anime','MAL','Comments','Keywords','Genres','Synopsis PT-BR']
  let y=24
  const header=()=>{doc.setFillColor(92,66,190);doc.rect(0,0,pageWidth,18,'F');doc.setTextColor(255);doc.setFontSize(16);doc.setFont('helvetica','bold');doc.text(`AnimeFinder — ${label}`,margin,12);doc.setTextColor(20);doc.setFontSize(7);let x=margin;headers.forEach((h,i)=>{doc.setFont('helvetica','bold');doc.text(h,x,y);x+=widths[i]});y+=5}
  header()
  rows.forEach((work,index)=>{
    if(y+rowHeight>pageHeight-13){doc.addPage();y=24;header()}
    if(index%2===1){doc.setFillColor(245,242,255);doc.rect(margin-1,y-4,pageWidth-margin*2+2,rowHeight,'F')}
    const values=[work.myRanked?`#${work.myRanked}`:'—',work.displayName,work.malScore?.toFixed(2) ?? '—',work.comment,work.keywords.join(', '),work.genres.join(', '),work.synopsis.ptBR ?? work.synopsis.original ?? '—']
    let x=margin;values.forEach((value,i)=>{doc.setFont('helvetica','normal');const text=String(value ?? '—');const clipped=text.length>80?`${text.slice(0,77)}…`:text;doc.text(clipped,x,y,{maxWidth:widths[i]-2});x+=widths[i]});y+=rowHeight
  })
  applyAnimeFinderPdfFooter(doc)
  doc.save(`AnimeFinder-${label.replace(/[^a-z0-9]+/gi,'-')}.pdf`)
}

function printTable(snapshot:MasterDataSnapshot,category:PersonalCatalogCategory){
  const rows=snapshot.works.filter((w)=>w.category===category),label=personalCatalogCategories.find((x)=>x.id===category)?.label ?? category
  const popup=window.open('','_blank','noopener,noreferrer');if(!popup)return
  const esc=(value:unknown)=>String(value ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!))
  popup.document.write(`<!doctype html><html><head><title>AnimeFinder ${esc(label)}</title><style>@page{size:A4 landscape;margin:10mm}body{font:10px Arial;color:#151226}h1{color:#5c42be}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:5px;vertical-align:top;overflow:hidden}tr:nth-child(even){background:#f6f2ff}th{background:#5c42be;color:#fff}.clamp{max-height:32px;overflow:hidden}footer{margin-top:10px;font-size:9px;text-align:center;color:#645f78}</style></head><body><h1>AnimeFinder — ${esc(label)}</h1><table><thead><tr><th>Rank</th><th>Anime</th><th>MAL</th><th>Comments</th><th>Keywords</th><th>Genres</th><th>Synopsis PT-BR</th></tr></thead><tbody>${rows.map((w)=>`<tr><td>${w.myRanked?`#${w.myRanked}`:'—'}</td><td>${esc(w.displayName)}</td><td>${esc(w.malScore ?? '—')}</td><td><div class="clamp">${esc(w.comment)}</div></td><td>${esc(w.keywords.join(', '))}</td><td>${esc(w.genres.join(', '))}</td><td><div class="clamp">${esc(w.synopsis.ptBR ?? w.synopsis.original ?? '—')}</div></td></tr>`).join('')}</tbody></table><footer>AnimeFinder created by <a href="${ANIMEFINDER_PORTFOLIO_URL}">Leonardo Camargo Rossato</a> / <a href="${ANIMEFINDER_PORTFOLIO_URL}">LCR Portfolio</a></footer><script>window.print()</script></body></html>`);popup.document.close()
}

function Viewer({title,data,onClose}:{title:string;data:unknown;onClose:()=>void}){return createPortal(<div className="master-json-backdrop" onMouseDown={(e)=>{if(e.currentTarget===e.target)onClose()}}><section className="master-json-modal"><header><div><span className="eyebrow">DETAIL VIEW</span><h2>{title}</h2></div><button onClick={onClose}>×</button></header>{typeof data==='string'?<div className="master-long-reader">{data}</div>:<pre>{JSON.stringify(data,null,2)}</pre>}</section></div>,document.body)}

type BackfillKind='genres'|'synopsis'|'translations'
type TranslationSyncPhase='translating'|'supabase'|'refreshing'|'success'|'error'
type TranslationSyncStatus={
  phase:TranslationSyncPhase
  title:string
  detail?:string
  completed?:string[]
  audit?:SynopsisTranslationPersistenceAudit
  masterPtBrCount?:number
}

function MasterTable({onClose}:{onClose:()=>void}){
  const [snapshot,setSnapshot]=useState<MasterDataSnapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [category,setCategory]=useState<PersonalCatalogCategory>('watched'),[query,setQuery]=useState(''),[viewer,setViewer]=useState<{title:string;data:unknown}|null>(null),[exportOpen,setExportOpen]=useState(false),[backfillOpen,setBackfillOpen]=useState(false)
  const [synopsisProgress,setSynopsisProgress]=useState<SynopsisBackfillProgress|null>(null),[translationProgress,setTranslationProgress]=useState<SynopsisBackfillProgress|null>(null),[genreProgress,setGenreProgress]=useState<MetadataBackfillProgress|null>(null),[backfill,setBackfill]=useState<BackfillKind|null>(null)
  const [refreshing,setRefreshing]=useState(false),[updatedLabel,setUpdatedLabel]=useState('')
  const [translationSync,setTranslationSync]=useState<TranslationSyncStatus|null>(null)

  async function refresh(manual=false){if(manual)setRefreshing(true);setLoading(!snapshot);setError('');try{const next=await loadMasterDataSnapshot();setSnapshot(next);setUpdatedLabel(manual?'Updated just now':'')}catch(reason){setError(reason instanceof Error?reason.message:'Could not load Supabase Master Data.')}finally{setLoading(false);setRefreshing(false)}}
  useEffect(()=>{void refresh(false)},[])
  const rows=useMemo(()=>{if(!snapshot)return[];const term=query.trim().toLowerCase();return snapshot.works.filter((w)=>w.category===category && (!term||[w.displayName,w.englishName,w.originalName,w.originalObservations,w.comment,...w.keywords,...w.genres].filter(Boolean).join(' ').toLowerCase().includes(term)))},[snapshot,category,query])

  async function runGenres(){if(!snapshot||backfill)return;setBackfillOpen(false);setBackfill('genres');try{await backfillPersistedGenres(snapshot,(p)=>setGenreProgress(p));await refresh(true)}finally{setBackfill(null)}}
  async function runSynopsis(){if(backfill)return;setBackfillOpen(false);setBackfill('synopsis');try{await backfillPersonalCatalogSynopsis((p)=>setSynopsisProgress(p));await refresh(true)}finally{setBackfill(null)}}
  async function runTranslations(){
    if(backfill)return
    setBackfillOpen(false);setBackfill('translations');setError('')
    setTranslationSync({phase:'translating',title:'Translating synopsis to PT-BR…',detail:'Only synopsis already stored in Supabase are processed.'})
    try{
      const result=await backfillSynopsisTranslationsPtBr((p)=>setTranslationProgress(p))
      setTranslationProgress(result)
      if(result.succeeded===0){
        const detail=result.haltedReason ?? (result.failed?`${result.failed} translation(s) failed before any new PT-BR synopsis could be persisted.`:'No eligible synopsis required translation.')
        setTranslationSync({phase:result.failed?'error':'success',title:result.failed?'Translation stopped before persistence':'Nothing to translate',detail})
        return
      }

      const audit=await auditSynopsisTranslationPersistence()
      setTranslationSync({phase:'supabase',title:'Persisted in Supabase',audit,completed:[`✓ ${result.succeeded} new PT-BR synopsis persisted with read-back verification`],detail:`${audit.ptBrCount} PT-BR synopsis are now stored in Supabase.`})
      await new Promise((resolve)=>window.setTimeout(resolve,350))

      setTranslationSync({phase:'refreshing',title:'Refreshing Master Data Table…',audit,completed:[`✓ Persisted in Supabase · ${audit.ptBrCount} PT-BR synopsis`]})
      setRefreshing(true)
      const next=await loadMasterDataSnapshot()
      setSnapshot(next);setUpdatedLabel('Updated just now');setRefreshing(false)
      const masterPtBrCount=next.works.filter((work)=>Boolean(work.synopsis.ptBR?.trim())).length
      const matches=masterPtBrCount===audit.ptBrCount
      if(!matches){
        setTranslationSync({phase:'error',title:'Master Data Table verification failed',audit,masterPtBrCount,completed:[`✓ Persisted in Supabase · ${audit.ptBrCount} PT-BR synopsis`,`✓ Master Data snapshot refreshed`],detail:`Supabase contains ${audit.ptBrCount} PT-BR synopsis, but the Master Data snapshot returned ${masterPtBrCount}. Re-run the latest data-integrity-master-v4.sql RPC if this mismatch persists.`})
        return
      }
      setTranslationSync({
        phase:'success',
        title:'Persisted in Master Data Table',
        audit,
        masterPtBrCount,
        completed:[`✓ Persisted in Supabase · ${audit.ptBrCount} PT-BR synopsis`,`✓ Refreshed Master Data Table from Supabase`],
        detail:result.haltedReason
          ? `${masterPtBrCount} PT-BR synopsis are visible. The batch stopped early because the translation provider returned a rate limit: ${result.haltedReason}`
          : `${masterPtBrCount} PT-BR synopsis are visible in the current Master Data snapshot.${result.failed?` ${result.failed} item(s) failed and can be retried later.`:''}`,
      })
    }catch(reason){
      setRefreshing(false)
      const message=reason instanceof Error?reason.message:'PT-BR synopsis backfill failed.'
      setTranslationSync({phase:'error',title:'PT-BR backfill failed',detail:message})
      setError(message)
    }finally{setBackfill(null)}
  }
  const progress=backfill==='genres'?genreProgress:backfill==='synopsis'?synopsisProgress:backfill==='translations'?translationProgress:null
  const percent=progress?.total?Math.round((progress.processed/progress.total)*100):0
  const backfillLabel=backfill==='genres'?'Genres':backfill==='synopsis'?'Synopsis':backfill==='translations'?'Synopsis PT-BR':'Backfill'

  return createPortal(<div className="master-data-backdrop"><section className="master-data-modal" role="dialog" aria-modal="true" aria-label="AnimeFinder Master Data Table">
    <header className="master-data-header"><div><span className="eyebrow">ANIMEFINDER MASTER DATA</span><h1>Master Data Table</h1><p>Human-readable projection of the authenticated Supabase dataset.</p></div><button className="master-data-close" onClick={onClose}>×</button></header>
    <div className="master-data-toolbar">
      <div className="master-data-search"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search master data…"/></div>
      <button className="ghost-button master-refresh-button" title="Refresh from Supabase" onClick={()=>void refresh(true)} disabled={refreshing}>{refreshing?'↻ Refreshing…':'↻'}</button>
      {updatedLabel&&<small className="master-refresh-feedback">{updatedLabel}</small>}
      <div className="master-export-wrap master-backfill-wrap">
        <button className="ghost-button" disabled={Boolean(backfill)} onClick={()=>{setBackfillOpen((v)=>!v);setExportOpen(false)}}>{backfill?`${backfillLabel} ${percent}%`:'Backfill ▾'}</button>
        {backfillOpen&&!backfill&&<div className="master-export-menu master-backfill-menu"><button onClick={()=>void runGenres()}>Backfill Genres</button><button onClick={()=>void runSynopsis()}>Backfill Synopsis</button><button onClick={()=>void runTranslations()}>Backfill Synopsis Translation PT-BR</button></div>}
      </div>
      <div className="master-export-wrap"><button className="primary-button" onClick={()=>{setExportOpen((v)=>!v);setBackfillOpen(false)}}>Export</button>{exportOpen&&snapshot&&<div className="master-export-menu"><button onClick={()=>exportCsv(snapshot,category)}>Download CSV</button><button onClick={()=>exportJson(snapshot)}>Download JSON</button><button onClick={()=>void exportPdf(snapshot,category)}>Download PDF</button><button onClick={()=>printTable(snapshot,category)}>Print</button><button disabled title="Google Sheets write scope is not authorized yet.">Export to Google Sheets — not configured</button></div>}</div>
      {translationSync&&<div className={`translation-persistence-status ${translationSync.phase}`} role="status" aria-live="polite">
        <span className="translation-sync-badge">{translationSync.phase==='success'?'✓':translationSync.phase==='error'?'!':'↻'}</span>
        <div className="translation-sync-copy"><strong>{translationSync.title}</strong>{translationSync.completed?.map((item)=><small key={item}>{item}</small>)}{translationSync.detail&&<small>{translationSync.detail}</small>}</div>
      </div>}
    </div>
    {progress&&backfill&&<div className="master-backfill-status compact-status"><strong>{backfillLabel} backfill: {progress.processed}/{progress.total} ({percent}%)</strong><div className="master-progress"><span style={{width:`${percent}%`}}/></div><small>{progress.succeeded} stored · {progress.missingSource} missing source · {progress.failed} failed</small>{progress.currentWork&&<small> · {progress.currentWork}</small>}{progress.haltedReason&&<small> · stopped: {progress.haltedReason}</small>}</div>}
    <nav className="master-data-tabs">{personalCatalogCategories.map((tab)=><button key={tab.id} className={category===tab.id?'active':''} onClick={()=>setCategory(tab.id)}>{tab.label}<span>{snapshot?.categoryCounts[tab.id] ?? 0}</span></button>)}</nav>
    {error&&<div className="notice error">{error}</div>}
    {loading&&<div className="master-data-loading"><span className="spinner"/><strong>Loading Supabase master data…</strong></div>}
    {!loading&&snapshot&&<div className="master-table-scroll"><table className="master-data-table fixed-master-rows"><thead><tr><th>My Ranked</th><th>Anime</th><th>MAL Score</th><th>Original Observations</th><th>Comments</th><th>Characters</th><th>Keywords</th><th>Genres</th><th>Full English Name</th><th>Original Full Name</th><th>MyAnimeList</th><th>Knowledge</th><th>MAL Synopsis</th><th>Synopsis PT-BR</th><th>Character Knowledge</th></tr></thead><tbody>{rows.map((work)=><tr key={work.id}><td>{work.myRanked?`#${work.myRanked}`:'—'}</td><td className="master-title"><strong>{work.displayName}</strong><small>{work.category}</small></td><td>{work.malScore==null?'—':`★ ${work.malScore.toFixed(2)}`}</td><td onClick={()=>work.originalObservations&&setViewer({title:`${work.displayName} — Original Observations`,data:work.originalObservations})}><div className="master-clamp clickable">{work.originalObservations||'—'}</div></td><td onClick={()=>work.comment&&setViewer({title:`${work.displayName} — My Comment`,data:work.comment})}><div className="master-clamp clickable">{work.comment||'—'}</div></td><td><div className="master-chip-flow">{work.characterKnowledge.slice(0,5).map((c)=><span key={c.id ?? c.name}>{c.name}</span>)}</div></td><td><div className="master-chip-flow">{work.keywords.slice(0,7).map((v)=><span key={v}>{v}</span>)}</div></td><td><div className="master-chip-flow">{work.genres.slice(0,4).map((v)=><span key={v}>{v}</span>)}</div></td><td><div className="master-clamp">{work.englishName||'—'}</div></td><td><div className="master-clamp">{work.originalName||'—'}</div></td><td>{work.malUrl?<a href={work.malUrl} target="_blank" rel="noreferrer">MAL ↗</a>:'—'}</td><td>{work.audit.hasPersonalComment||work.audit.hasKeywords||work.audit.hasCharacters?'✓ Personal Knowledge':'—'}</td><td onClick={()=>work.synopsis.original&&setViewer({title:`${work.displayName} — MAL Synopsis`,data:work.synopsis.original})}><div className="master-clamp synopsis clickable">{work.synopsis.original||'—'}</div></td><td onClick={()=>work.synopsis.ptBR&&setViewer({title:`${work.displayName} — Synopsis PT-BR`,data:work.synopsis.ptBR})}><div className="master-clamp synopsis clickable">{work.synopsis.ptBR||'—'}</div></td><td><button className="ghost-button compact" disabled={!work.characterKnowledge.length} onClick={()=>setViewer({title:`${work.displayName} — Character Knowledge JSON`,data:characterKnowledgeJson(snapshot,work.id)})}>{work.characterKnowledge.length?`${work.characterKnowledge.length} characters · View JSON`:'No character data'}</button></td></tr>)}</tbody></table></div>}
  </section>{viewer&&<Viewer title={viewer.title} data={viewer.data} onClose={()=>setViewer(null)}/>}</div>,document.body)
}

export default function MasterDataTableEnhancer(){
  const location=useLocation(),[open,setOpen]=useState(false)
  useEffect(()=>{if(location.pathname!=='/app/my-anime'){setOpen(false);return}const sync=()=>{const shell=document.querySelector('.catalog-v2-shell.fullscreen') as HTMLElement|null;const actions=shell?.querySelector('.catalog-manager-actions') as HTMLElement|null;if(!actions||actions.querySelector('[data-master-data-open]'))return;const button=document.createElement('button');button.type='button';button.dataset.masterDataOpen='true';button.className='ghost-button master-data-open-button';button.textContent='View Full Table';button.addEventListener('click',()=>setOpen(true));actions.insertBefore(button,actions.firstChild)};sync();const observer=new MutationObserver(sync),root=document.getElementById('root');if(root)observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});return()=>observer.disconnect()},[location.pathname])
  return open?<MasterTable onClose={()=>setOpen(false)}/>:null
}