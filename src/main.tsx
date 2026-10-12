import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initialize, readSnapshot, saveSale, deleteSale } from './storage/database';
import { D, money, percent, prepareSale, saleAmounts, totals, todaySeoul } from './domain/sales';
import type { Dataset, Sale, SaleInput, Snapshot } from './domain/types';
import './styles.css';

const messageOf = (e: unknown) => e instanceof Error ? e.message : '처리하지 못했습니다. 다시 확인해 주세요.';
const storageError = (e: unknown) => `${messageOf(e)}\n저장에 실패하면 기존 기록은 유지됩니다. 저장 공간과 브라우저 권한을 확인해 주세요.`;
const initialDate = '2026-09-18';
function Modal({title,children,onClose,busy=false}:{title:string;children:React.ReactNode;onClose:()=>void;busy?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const dialog=ref.current!; dialog.showModal(); return ()=>dialog.close(); },[]);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={e=>{e.preventDefault();if(!busy) onClose();}}><div className="modal-head"><h2 id="dialog-title">{title}</h2><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>{children}</dialog>;
}
function Editor({data,previous,date,revision,onClose,onSaved,writable}:{data:Dataset;previous?:Sale;date:string;revision:number;onClose:()=>void;onSaved:(s:Sale)=>Promise<void>;writable:boolean}) {
  const [id]=useState(()=>previous?.sale_id || crypto.randomUUID());
  const [input,setInput]=useState<SaleInput>(()=>previous ? {date:previous.date,menu_id:previous.menu_id,channel:previous.channel,quantity:previous.quantity,unit_price:previous.unit_price,discount_amount:previous.discount_amount,payment_fee:previous.payment_fee ?? ''} : {date,menu_id:data.menus[0].menu_id,channel:'매장',quantity:'',unit_price:data.menus[0].price,discount_amount:'0',payment_fee:''});
  const original=useRef(JSON.stringify(input));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ack,setAck]=useState(false);
  let preview: Sale | null = null, previewError='';
  try { preview=prepareSale(data,input,id,previous); } catch(e) { previewError=messageOf(e); }
  const cal=data.calendar.find(c=>c.date===input.date);
  const warnings: string[]=[];
  if(cal && !cal.is_open) warnings.push('달력에는 휴무일입니다. 실제 판매가 있었는지 확인해 주세요.');
  if(preview && D(input.payment_fee).gt(preview.net_sales)) warnings.push('수수료가 순매출보다 큽니다. 실제 금액이 맞는지 확인해 주세요.');
  const close=()=>{if(!busy && (original.current===JSON.stringify(input) || window.confirm('작성 중인 변경을 버릴까요? 저장된 기록은 바뀌지 않습니다.'))) onClose();};
  const update=(key:keyof SaleInput,value:string)=>{setInput(v=>({...v,[key]:value,...(key==='menu_id' ? {unit_price:data.menus.find(m=>m.menu_id===value)?.price || ''} : {})}));setAck(false);setError('');};
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy || !writable) return;
    if(!preview){setError(previewError);return;}
    if(warnings.length && !ack){setError('주의사항을 확인한 뒤 체크해 주세요.');return;}
    setBusy(true);setError('');
    let saved:Sale;
    try { saved=await saveSale(input,id,revision,previous); }
    catch(e) {setError(storageError(e));setBusy(false);return;}
    await onSaved(saved); // Successful write is handled separately from refresh errors.
  };
  const a=preview ? saleAmounts(preview) : null;
  return <Modal title={previous?'판매 기록 수정':'판매 내역 기록'} onClose={close} busy={busy}><form onSubmit={submit} noValidate><div className="modal-body">
    <p className="muted">하루의 메뉴·채널별 합계입니다. 금액은 부가세 제외, 할인과 수수료는 이 기록 전체 금액입니다.</p>
    <fieldset disabled={busy} className="fields">
      <label>판매일<input type="date" value={input.date} max={todaySeoul()} required onInput={e=>update('date',e.currentTarget.value)}/></label>
      <label>메뉴<select value={input.menu_id} onChange={e=>update('menu_id',e.target.value)}>{data.menus.map(m=><option value={m.menu_id} key={m.menu_id}>{m.name}</option>)}</select></label>
      <label>판매 채널<select value={input.channel} onChange={e=>update('channel',e.target.value)}><option>매장</option><option>포장</option></select></label>
      <label>판매 수량 (개)<input type="number" min="1" step="1" value={input.quantity} required onChange={e=>update('quantity',e.target.value)}/></label>
      <label>실제 단가 (원)<input type="number" min="0" step="any" value={input.unit_price} required onChange={e=>update('unit_price',e.target.value)}/></label>
      <label>전체 할인 (원)<input type="number" min="0" step="any" value={input.discount_amount} required onChange={e=>update('discount_amount',e.target.value)}/></label>
      <label>전체 수수료 (원)<input type="number" min="0" step="any" value={input.payment_fee} required onChange={e=>update('payment_fee',e.target.value)}/><span className="muted">수수료가 없으면 0을 직접 입력하세요.</span></label>
    </fieldset>
    {!cal?.record_complete && <p className="notice">마감이 확인되지 않은 날짜입니다. 결과는 입력된 기록 기준 잠정 값으로 표시합니다.</p>}
    {!!warnings.length && <div className="notice">{warnings.map(w=><p key={w}>{w}</p>)}<label className="check"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> 실제 기록이 맞음을 확인했습니다.</label></div>}
    <div className="preview"><strong>저장 전 미리보기</strong>{a ? <div className="mini-grid"><div>순매출<b>{money(a.net)}</b></div><div>직접 원가<b>{money(a.cost)}</b></div><div>수수료<b>{money(a.fee)}</b></div><div>남는 금액<b className="green">{money(a.profit)}</b></div></div> : <p className="muted">{previewError}</p>}</div>
    <p className="muted">수량·단가·할인·수수료 수정은 당시 원가를 유지합니다. 날짜·메뉴·채널을 바꾸면 해당 판매일의 원가를 다시 확인합니다.</p>
    {error && <p role="alert" className="error">{error}</p>}
    </div><footer className="modal-footer"><button type="button" disabled={busy} onClick={close}>취소</button><button className="primary" disabled={busy || !writable} type="submit">{busy?'저장 중…':'판매 기록 저장'}</button></footer></form></Modal>;
}
function App() {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[loadError,setLoadError]=useState('');
  const [route,setRoute]=useState(location.hash==='#profitability'?'profitability':'sales');
  const [mode,setMode]=useState<'day'|'month'>('day'),[date,setDate]=useState(initialDate),[month,setMonth]=useState('2026-09');
  const [editor,setEditor]=useState<{previous?:Sale;date:string;revision:number}|null>(null);
  const [deleting,setDeleting]=useState<Sale|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[actionError,setActionError]=useState('');
  const deleteRevision=useRef(0);
  const [selected,setSelected]=useState(''),[sort,setSort]=useState<'profit'|'sales'>('profit'),[page,setPage]=useState(0);
  const writable=!!(window.indexedDB && navigator.locks && window.BroadcastChannel);
  const channel=useRef<BroadcastChannel|null>(null);
  const refresh=async()=>setSnapshot(await readSnapshot());
  const load=async()=>{setLoadError('');try{await initialize();await refresh();if(navigator.storage?.persist) void navigator.storage.persist().catch(()=>false);}catch(e){setLoadError(messageOf(e));}};
  useEffect(()=>{void load(); const hash=()=>setRoute(location.hash==='#profitability'?'profitability':'sales');window.addEventListener('hashchange',hash);const focus=()=>{void refresh().catch(e=>setActionError(messageOf(e)));};window.addEventListener('focus',focus); if(window.BroadcastChannel){const c=new BroadcastChannel('prep-cafe-changes');channel.current=c;c.onmessage=focus;} return()=>{window.removeEventListener('hashchange',hash);window.removeEventListener('focus',focus);channel.current?.close();};},[]);
  useEffect(()=>setPage(0),[mode,date,month]);
  const data=snapshot?.data;
  const sales=useMemo(()=>data?.sales.filter(s=>mode==='day' ? s.date===date : s.date.startsWith(month)).sort((a,b)=>a.date.localeCompare(b.date)||a.sale_id.localeCompare(b.sale_id)) || [],[data,mode,date,month]);
  const summary=useMemo(()=>totals(sales),[sales]);
  const groups=useMemo(()=>data?.menus.map(menu=>({menu,sales:sales.filter(s=>s.menu_id===menu.menu_id),total:totals(sales.filter(s=>s.menu_id===menu.menu_id))})).filter(g=>g.sales.length).sort((a,b)=>(sort==='profit'?(b.total.profit?.toNumber() ?? -Infinity)-(a.total.profit?.toNumber() ?? -Infinity):b.total.net.minus(a.total.net).toNumber())||a.menu.menu_id.localeCompare(b.menu.menu_id)) || [],[data,sales,sort]);
  const periodInfo=useMemo(()=>{
    if(!data) return '';
    const calendars=data.calendar.filter(c=>mode==='day'?c.date===date:c.date.startsWith(month));
    const expected=mode==='day'?1:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
    const closed=calendars.filter(c=>c.record_complete).length;
    const recordDates=[...new Set(sales.map(s=>s.date))].sort();
    return `${closed===expected?'마감 확인':'잠정 · 일부 기간'} · 입력된 판매 기록 기준${recordDates.length ? ` · 판매 자료 ${recordDates[0]} ~ ${recordDates.at(-1)}` : ' · 판매 기록 없음'}${mode==='month'?` · 마감 확인 ${closed}/${expected}일`:calendars[0]?.is_open===false?' · 달력상 휴무일':''}`;
  },[data,mode,date,month,sales]);
  const afterWrite=async(text:string)=>{channel.current?.postMessage({changed:true});try{await refresh();setActionError('');setNotice(text);}catch(e){setActionError(`기록은 저장됐지만 화면 갱신에 실패했습니다. 다시 등록하지 말고 새로고침하세요. ${messageOf(e)}`);}};
  const onSaved=async(s:Sale)=>{await afterWrite('판매 기록을 저장했습니다.');setEditor(null);setDate(s.date);setMonth(s.date.slice(0,7));};
  const remove=async()=>{if(!deleting||busy||!snapshot)return;setBusy(true);setActionError('');try{await deleteSale(deleting.sale_id,deleteRevision.current);}catch(e){setActionError(storageError(e));setBusy(false);return;}await afterWrite('선택한 판매 기록을 삭제했습니다.');setDeleting(null);setBusy(false);};
  if(!snapshot) return <main className="loading"><h1>프렙 카페</h1>{loadError?<><p role="alert" className="error">{loadError}</p><button onClick={()=>void load()}>다시 시도</button></>:<p role="status">저장 자료를 확인하고 있습니다…</p>}</main>;
  const selectedGroup=groups.find(g=>g.menu.menu_id===selected) || groups[0];
  return <><header className="topbar"><a href="#sales" className="brand"><span className="logo">☕</span><div><strong>Prep Cafe</strong><small>프렙 카페 · 운영 기록</small></div></a><nav aria-label="주 메뉴"><a href="#sales" aria-current={route==='sales'?'page':undefined}>판매 관리</a><a href="#profitability" aria-current={route==='profitability'?'page':undefined}>메뉴 수익성</a><span className="future">손익 · EPIC 2</span><span className="future">재고 · EPIC 2~3</span></nav><span className="badge amber">가상 샘플</span></header>
    <main><div className="page-heading"><div><p className="eyebrow">CAFE OPERATIONS / EPIC 1</p><h1>{route==='sales'?'판매 기록 관리':'메뉴별 수익성'}</h1><p className="muted">한 메뉴에서 남는 금액 = 순매출 − 재료·포장 원가 − 실제 결제수수료</p></div><button className="primary" onClick={()=>{setActionError('');setEditor({date,revision:snapshot.revision});}} disabled={!writable}>＋ 판매 내역 기록</button></div>
    <div className="toolbar"><div className="segmented"><button aria-pressed={mode==='day'} onClick={()=>setMode('day')}>일간</button><button aria-pressed={mode==='month'} onClick={()=>setMode('month')}>월간</button></div>{mode==='day'?<label>조회일<input aria-label="조회일" type="date" value={date} onInput={e=>{const value=e.currentTarget.value;if(value){setDate(value);setMonth(value.slice(0,7));}}}/></label>:<label>조회월<input aria-label="조회월" type="month" value={month} onInput={e=>{const value=e.currentTarget.value;if(value){setMonth(value);setDate(value+'-01');}}}/></label>}<span className="muted">{periodInfo}</span></div>
    {!writable && <p className="error" role="alert">이 브라우저에서는 안전한 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge의 일반 모드를 사용해 주세요. 읽기만 가능합니다.</p>}
    {notice&&<p role="status" className="success">{notice}</p>}{actionError&&<p role="alert" className="error">{actionError}</p>}
    <div className="metrics"><Metric title="순매출 · 부가세 제외" value={money(summary.net)}/><Metric title="판매 수량" value={`${summary.qty.toString()}개`}/><Metric title="직접 원가 · 재료 + 포장" value={summary.missing?'일부 근거 확인 필요':money(summary.cost)}/><Metric title="결제수수료" value={summary.missing?'일부 근거 확인 필요':money(summary.fee)}/><Metric title="남는 금액" value={sales.length?money(summary.profit):'판매 기록 없음'} note={sales.length?`매출 대비 ${percent(summary.rate)}`:'입력된 기록 기준'} positive/></div>
    {summary.missing>0&&<p className="notice">원가·수수료 근거가 없는 기록 {summary.missing}건이 있습니다. 전체 수익은 확인 불가입니다. 확인된 기록만의 소계: {money(summary.knownProfit)}</p>}
    {summary.mismatches>0&&<p className="notice">원본 순매출과 검산이 다른 기록 {summary.mismatches}건이 있습니다. 원본 금액을 보존해 표시합니다.</p>}
    {route==='sales'?<section className="panel"><div className="panel-head"><h2>판매 내역</h2><span className="muted">{sales.length}건 · 같은 날 메뉴·채널별 합계</span></div><div className="table-scroll"><table><thead><tr><th>판매일 / 메뉴</th><th>채널</th><th>수량</th><th>실제 단가</th><th>전체 할인</th><th>순매출</th><th>직접 원가</th><th>수수료</th><th>남는 금액</th><th>관리</th></tr></thead><tbody>{sales.slice(page*50,(page+1)*50).map(s=>{const a=saleAmounts(s);return <tr key={s.sale_id}><td><small>{s.date}</small><strong>{data!.menus.find(m=>m.menu_id===s.menu_id)?.name || s.menu_id}</strong></td><td><span className={`badge ${s.channel==='포장'?'amber':'sage'}`}>{s.channel}</span></td><td>{s.quantity}개</td><td>{money(s.unit_price)}</td><td>{money(s.discount_amount)}</td><td>{money(a.net)}</td><td>{money(a.cost)}</td><td>{money(a.fee)}</td><td className={a.profit?.lt(0)?'red':'green'}>{money(a.profit)}{a.mismatch&&<small>원본 검산 차이</small>}</td><td><div className="actions"><button aria-label={`${s.date} ${data!.menus.find(m=>m.menu_id===s.menu_id)?.name} ${s.channel} 수정`} disabled={!writable} onClick={()=>{setActionError('');setEditor({previous:s,date:s.date,revision:snapshot.revision});}}>수정</button><button className="danger" aria-label={`${s.date} ${data!.menus.find(m=>m.menu_id===s.menu_id)?.name} ${s.channel} 삭제`} disabled={!writable} onClick={()=>{setActionError('');deleteRevision.current=snapshot.revision;setDeleting(s);}}>삭제</button></div></td></tr>;})}</tbody></table></div>{!sales.length&&<div className="empty">선택한 기간에 판매 기록이 없습니다. 미입력은 실제 판매 0을 뜻하지 않습니다.</div>}{sales.length>50&&<div className="pagination"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>이전 목록</button><span>{page+1} / {Math.ceil(sales.length/50)}</span><button disabled={(page+1)*50>=sales.length} onClick={()=>setPage(p=>p+1)}>다음 목록</button></div>}</section>:<div className="profit-layout"><section className="panel"><div className="panel-head"><h2>메뉴별 결과</h2><label>정렬<select value={sort} onChange={e=>setSort(e.target.value as 'profit'|'sales')}><option value="profit">남는 금액순</option><option value="sales">순매출순</option></select></label></div><div className="table-scroll"><table><thead><tr><th>메뉴</th><th>수량</th><th>순매출</th><th>직접 원가</th><th>수수료</th><th>남는 금액</th><th>수익률</th></tr></thead><tbody>{groups.map(g=><tr key={g.menu.menu_id} className={selectedGroup?.menu.menu_id===g.menu.menu_id?'selected':''}><td><button className="menu-link" onClick={()=>setSelected(g.menu.menu_id)}>{g.menu.name}</button><small>{g.menu.category}</small></td><td>{g.total.qty.toString()}개</td><td>{money(g.total.net)}</td><td>{g.total.missing?'확인 불가':money(g.total.cost)}</td><td>{g.total.missing?'확인 불가':money(g.total.fee)}</td><td className={g.total.profit?.lt(0)?'red':'green'}>{money(g.total.profit)}</td><td>{percent(g.total.rate)}</td></tr>)}</tbody></table></div>{!groups.length&&<div className="empty">판매 기록이 없어 메뉴 수익성을 계산하지 않습니다.</div>}</section><aside className="panel inspector"><p className="eyebrow">MENU DETAILS</p><h2>{selectedGroup?.menu.name || '메뉴 상세'}</h2>{selectedGroup&&<><p className="muted">입력된 기록 합계 · 개당 평균은 총액 ÷ 총수량</p><dl><dt>개당 평균 순매출</dt><dd>{money(selectedGroup.total.average)}</dd><dt>개당 평균 직접 원가</dt><dd>{selectedGroup.total.missing?'확인 불가':money(selectedGroup.total.cost.div(selectedGroup.total.qty))}</dd><dt>재료 원가 합계</dt><dd>{selectedGroup.total.missing?'확인 불가':money(selectedGroup.total.food)}</dd><dt>포장 원가 합계</dt><dd>{selectedGroup.total.missing?'확인 불가':money(selectedGroup.total.packaging)}</dd></dl><div className="preview"><span>남는 금액</span><h2 className="green">{money(selectedGroup.total.profit)}</h2><span>매출 대비 {percent(selectedGroup.total.rate)}</span></div><h3>당시 원가 근거</h3>{selectedGroup.sales.every(s=>s.cost_basis)?<p className="muted">판매 입력 시 적용한 재료 가격·사용량을 함께 저장했습니다. 원가는 각 판매의 당시 기준으로 합산합니다.</p>:<p className="muted">과거 자료는 개당 원가만 보관돼 있습니다. 재료별 상세 근거 없음. 현재 가격으로 소급해 채우지 않습니다.</p>}</>}<p className="muted">월세·인건비는 메뉴 수익에 나누지 않습니다. 금액은 표시만 원 단위로 반올림하여 세부 합계와 1원 차이가 생길 수 있습니다.</p></aside></div>}
    <footer className="page-footer">가상 샘플 원본: 2025-07-01 ~ 2026-09-18 · 이 브라우저의 기기에 저장 · 백업·복원은 EPIC 3에서 제공</footer>
    </main>
    {editor&&<Editor key={editor.previous?.sale_id || 'new'} data={data!} previous={editor.previous} date={editor.date} revision={editor.revision} writable={writable} onClose={()=>setEditor(null)} onSaved={onSaved}/>}
    {deleting&&<Modal title="판매 기록 삭제" onClose={()=>{if(!busy)setDeleting(null);}} busy={busy}><div className="modal-body"><p><strong>{deleting.date} · {data!.menus.find(m=>m.menu_id===deleting.menu_id)?.name} · {deleting.channel}</strong></p><p>{deleting.quantity}개 · 순매출 {money(deleting.net_sales)}</p><p>이 판매 한 건을 삭제하고 메뉴 수익성을 다시 계산합니다. 삭제 후 되돌리기는 제공하지 않습니다.</p>{actionError&&<p role="alert" className="error">{actionError}</p>}</div><footer className="modal-footer"><button disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button className="danger solid" disabled={busy} onClick={()=>void remove()}>{busy?'삭제 중…':'삭제 확정'}</button></footer></Modal>}
  </>;
}
function Metric({title,value,note,positive=false}:{title:string;value:string;note?:string;positive?:boolean}) { return <article className="metric"><span>{title}</span><strong className={positive?'green':''}>{value}</strong>{note&&<small>{note}</small>}</article>; }
createRoot(document.getElementById('root')!).render(<App/>);
