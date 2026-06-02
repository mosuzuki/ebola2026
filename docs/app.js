async function csv(path){
  const text = await fetch(path).then(r => r.text());
  const lines = text.trim().split(/\r?\n/);
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => Object.fromEntries(parseLine(line).map((v,i)=>[headers[i], v ?? ''])));
}
function parseLine(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i], n=line[i+1];
    if(c==='"' && q && n==='"'){cur+='"'; i++;}
    else if(c==='"'){q=!q;}
    else if(c===',' && !q){out.push(cur); cur='';}
    else cur+=c;
  }
  out.push(cur); return out;
}
const num = v => v==='' || v==null ? null : +v;
const fmt = v => v==null || isNaN(v) ? '–' : v.toLocaleString();
function escapeHtml(s){return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function link(url, label){ return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label || url)}</a>` : escapeHtml(label || ''); }
function table(el, rows, cols){
  const h = '<thead><tr>'+cols.map(c=>`<th>${c.label}</th>`).join('')+'</tr></thead>';
  const b = '<tbody>'+rows.map(r=>'<tr>'+cols.map(c=>`<td>${c.render?c.render(r):escapeHtml(r[c.key]||'')}</td>`).join('')+'</tr>').join('')+'</tbody>';
  document.getElementById(el).innerHTML = h+b;
}
function drawLine(svgId, rows){
  const svg=document.getElementById(svgId), w=900,h=300,p={l:55,r:20,t:22,b:42}; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const data = rows.filter(r=>r.confirmed_cases).map(r=>({date:new Date(r.date), country:r.country, y:num(r.confirmed_cases)}));
  if(!data.length){svg.innerHTML='';return;}
  const minD = Math.min(...data.map(d=>d.date)), maxD=Math.max(...data.map(d=>d.date)), maxY=Math.max(...data.map(d=>d.y));
  const x = d => p.l + (d-minD)/(maxD-minD || 1)*(w-p.l-p.r);
  const y = v => h-p.b - v/(maxY||1)*(h-p.t-p.b);
  const countries=[...new Set(data.map(d=>d.country))];
  let html=`<line x1="${p.l}" y1="${h-p.b}" x2="${w-p.r}" y2="${h-p.b}" stroke="#9db3c5"/><line x1="${p.l}" y1="${p.t}" x2="${p.l}" y2="${h-p.b}" stroke="#9db3c5"/>`;
  for(let i=0;i<=4;i++){let yy=y(maxY*i/4); html+=`<line x1="${p.l}" y1="${yy}" x2="${w-p.r}" y2="${yy}" stroke="#eef3f7"/><text x="${p.l-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#637282">${Math.round(maxY*i/4)}</text>`}
  countries.forEach((c,idx)=>{
    const arr=data.filter(d=>d.country===c).sort((a,b)=>a.date-b.date);
    const path=arr.map((d,i)=>(i?'L':'M')+x(d.date)+','+y(d.y)).join(' ');
    const color = idx===0 ? '#1769aa' : '#b54708';
    html+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/>`;
    arr.forEach(d=>html+=`<circle cx="${x(d.date)}" cy="${y(d.y)}" r="4" fill="${color}"><title>${c} ${d.date.toISOString().slice(0,10)}: ${d.y}</title></circle>`);
    html+=`<text x="${w-p.r-120}" y="${p.t+18+idx*18}" fill="${color}" font-size="13" font-weight="700">${c}</text>`;
  });
  data.forEach(d=> html+=`<text x="${x(d.date)}" y="${h-16}" text-anchor="middle" font-size="11" fill="#637282">${d.date.toISOString().slice(5,10)}</text>`);
  svg.innerHTML=html;
}
function drawBars(svgId, rows){
  const svg=document.getElementById(svgId), w=700,h=300,p={l:150,r:20,t:20,b:30}; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const data=rows.filter(r=>r.confirmed_cases).slice(0,12).map(r=>({label:[r.country,r.admin1,r.admin2].filter(Boolean).join(' / '), y:num(r.confirmed_cases)})).sort((a,b)=>b.y-a.y);
  const maxY=Math.max(...data.map(d=>d.y)); const bh=(h-p.t-p.b)/data.length-5;
  let html='';
  data.forEach((d,i)=>{ const yy=p.t+i*(bh+5), bw=d.y/(maxY||1)*(w-p.l-p.r); html+=`<text x="${p.l-8}" y="${yy+bh*.65}" text-anchor="end" font-size="12" fill="#17212b">${escapeHtml(d.label)}</text><rect x="${p.l}" y="${yy}" width="${bw}" height="${bh}" rx="4" fill="#1769aa"><title>${escapeHtml(d.label)}: ${d.y}</title></rect><text x="${p.l+bw+6}" y="${yy+bh*.65}" font-size="12" fill="#637282">${d.y}</text>`; });
  svg.innerHTML=html;
}
function uniqueValues(rows, key, max=6){ return [...new Set(rows.map(r=>r[key]).filter(Boolean))].slice(0,max); }
function chips(containerId, rows, key){
  document.getElementById(containerId).innerHTML = uniqueValues(rows, key).map(v=>`<span class="filter-chip">${escapeHtml(v)}</span>`).join('');
}
function renderResponse(rows, showAll=false){
  const sorted = rows.slice().sort((a,b)=>b.date.localeCompare(a.date));
  responseCount.textContent = `${sorted.length} curated items`;
  responseTimeline.innerHTML = sorted.map((r,i)=>`<article class="event ${(!showAll && i>=10)?'hidden':''}">
    <div class="event-head"><div><div class="org">${escapeHtml(r.organization)} · ${escapeHtml(r.country)}</div><span class="tag green">${escapeHtml(r.activity_type)}</span><span class="tag">${escapeHtml(r.priority_area||'public health')}</span></div><div class="date">${escapeHtml(r.date)}</div></div>
    <p><strong>${escapeHtml(r.title||'Update')}</strong></p>
    <p class="details">${escapeHtml(r.details || r.summary)}</p>
    <div class="small">${link(r.source_url, r.source_name)} · confidence: ${escapeHtml(r.confidence_level||'')}</div>
  </article>`).join('');
  toggleResponse.style.display = sorted.length > 10 ? 'block' : 'none';
  toggleResponse.textContent = showAll ? 'Show only latest 10' : `Show all older updates (${sorted.length-10} more)`;
}
function renderScience(rows, showAll=false){
  const sorted = rows.slice().sort((a,b)=>b.date.localeCompare(a.date));
  scienceCount.textContent = `${sorted.length} curated items`;
  scienceTimeline.innerHTML = sorted.map((r,i)=>`<article class="event ${(!showAll && i>=10)?'hidden':''}">
    <div class="event-head"><div><div class="title">${link(r.url, r.title)}</div><span class="tag rnd">${escapeHtml(r.topic)}</span><span class="tag">${escapeHtml(r.evidence_type)}</span><span class="tag">${escapeHtml(r.peer_review_status)}</span></div><div class="date">${escapeHtml(r.date)}</div></div>
    <p>${escapeHtml(r.key_message)}</p>
    <p class="details">${escapeHtml(r.details || r.relevance || '')}</p>
    <div class="small">${escapeHtml(r.source)}${r.r_and_d_stage ? ' · '+escapeHtml(r.r_and_d_stage) : ''}</div>
  </article>`).join('');
  toggleScience.style.display = sorted.length > 10 ? 'block' : 'none';
  toggleScience.textContent = showAll ? 'Show only latest 10' : `Show all older evidence (${sorted.length-10} more)`;
}
(async function init(){
  const [sit, geo, resp, sci] = await Promise.all([csv('data/situation_timeseries.csv'),csv('data/geography.csv'),csv('data/response_tracker.csv'),csv('data/science_tracker.csv')]);
  const latestDRC=[...sit].filter(r=>r.country==='DRC').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  const latestUGA=[...sit].filter(r=>r.country==='Uganda').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  drcConfirmed.textContent=fmt(num(latestDRC?.confirmed_cases)); drcDeaths.textContent=fmt(num(latestDRC?.confirmed_deaths));
  ugaConfirmed.textContent=fmt(num(latestUGA?.confirmed_cases)); ugaDeaths.textContent=fmt(num(latestUGA?.confirmed_deaths));
  lastUpdated.textContent=new Date().toISOString().slice(0,10);
  drawLine('curve', sit); drawBars('geoBars', geo);
  let showResp=false, showSci=false;
  chips('responseFilters', resp, 'organization', 8); chips('scienceFilters', sci, 'topic', 8);
  renderResponse(resp, showResp); renderScience(sci, showSci);
  toggleResponse.onclick=()=>{showResp=!showResp; renderResponse(resp, showResp)};
  toggleScience.onclick=()=>{showSci=!showSci; renderScience(sci, showSci)};
  table('situationTable', sit.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'country',label:'Country'}, {key:'confirmed_cases',label:'Confirmed',render:r=>fmt(num(r.confirmed_cases))}, {key:'confirmed_deaths',label:'Deaths',render:r=>fmt(num(r.confirmed_deaths))}, {key:'suspected_cases',label:'Suspected',render:r=>fmt(num(r.suspected_cases))}, {key:'source_name',label:'Source',render:r=>link(r.source_url,r.source_name)}, {key:'notes',label:'Notes'}]);
  table('scienceTable', sci.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>link(r.url,r.title)}, {key:'source',label:'Source'}, {key:'evidence_type',label:'Type'}, {key:'topic',label:'Topic'}, {key:'key_message',label:'Key message'}, {key:'details',label:'Research/R&D relevance'}, {key:'peer_review_status',label:'Review status'}]);
})();
