async function csv(path){
  const res = await fetch(path, {cache: 'no-store'});
  if(!res.ok) return [];
  const text = await res.text();
  const trimmed = text.trim();
  if(!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
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
  const node = document.getElementById(el); if(!node) return;
  const h = '<thead><tr>'+cols.map(c=>`<th>${c.label}</th>`).join('')+'</tr></thead>';
  const b = '<tbody>'+rows.map(r=>'<tr>'+cols.map(c=>`<td>${c.render?c.render(r):escapeHtml(r[c.key]||'')}</td>`).join('')+'</tr>').join('')+'</tbody>';
  node.innerHTML = h+b;
}
function drawLine(svgId, rows){
  const svg=document.getElementById(svgId), w=900,h=300,p={l:55,r:20,t:22,b:42}; if(!svg) return; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
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
  const svg=document.getElementById(svgId), w=700,h=300,p={l:150,r:20,t:20,b:30}; if(!svg) return; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const data=rows.filter(r=>r.confirmed_cases).slice(0,12).map(r=>({label:[r.country,r.admin1,r.admin2].filter(Boolean).join(' / '), y:num(r.confirmed_cases)})).sort((a,b)=>b.y-a.y);
  if(!data.length){svg.innerHTML='';return;}
  const maxY=Math.max(...data.map(d=>d.y)); const bh=(h-p.t-p.b)/data.length-5;
  let html='';
  data.forEach((d,i)=>{ const yy=p.t+i*(bh+5), bw=d.y/(maxY||1)*(w-p.l-p.r); html+=`<text x="${p.l-8}" y="${yy+bh*.65}" text-anchor="end" font-size="12" fill="#17212b">${escapeHtml(d.label)}</text><rect x="${p.l}" y="${yy}" width="${bw}" height="${bh}" rx="4" fill="#1769aa"><title>${escapeHtml(d.label)}: ${d.y}</title></rect><text x="${p.l+bw+6}" y="${yy+bh*.65}" font-size="12" fill="#637282">${d.y}</text>`; });
  svg.innerHTML=html;
}
function uniqueValues(rows, key, max=8){ return [...new Set(rows.map(r=>r[key]).filter(Boolean))].slice(0,max); }
function chips(containerId, rows, key){ const el=document.getElementById(containerId); if(el) el.innerHTML = uniqueValues(rows, key).map(v=>`<span class="filter-chip">${escapeHtml(v)}</span>`).join(''); }
function renderLatest48(rows){
  const box = document.getElementById('latest48Summary');
  const count = document.getElementById('latest48Count');
  if(!box || !count) return;
  const sorted = rows.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  count.textContent = sorted.length ? `${sorted.length} items` : '0 items';
  if(!sorted.length){
    box.innerHTML = '<p class="small">過去48時間以内の日付を持つ新着情報は登録されていません。GitHub Actions更新時に <code>latest_48h_summary.csv</code> が再生成されます。</p>';
    return;
  }
  box.innerHTML = sorted.map(r=>`<article class="digest-item">
    <div class="digest-meta"><span>${escapeHtml(r.date)}</span><span>${escapeHtml(r.category)}</span><span>${escapeHtml(r.source)}</span></div>
    <h3>${link(r.url, r.title || r.source)}</h3>
    <p>${escapeHtml(r.summary_ja)}</p>
  </article>`).join('');
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
function renderEpiResearch(rows, showAll=false){
  const sorted = rows.slice().sort((a,b)=>b.date.localeCompare(a.date));
  epiResearchCount.textContent = `${sorted.length} curated/screened items`;
  epiResearchTimeline.innerHTML = sorted.map((r,i)=>`<article class="event ${(!showAll && i>=10)?'hidden':''}">
    <div class="event-head"><div><div class="title">${link(r.url, r.title)}</div><span class="tag epi">${escapeHtml(r.topic)}</span><span class="tag">${escapeHtml(r.evidence_type)}</span><span class="tag">${escapeHtml(r.peer_review_status)}</span></div><div class="date">${escapeHtml(r.date)}</div></div>
    <p>${escapeHtml(r.key_message)}</p>
    <p class="details">${escapeHtml(r.details || r.relevance || '')}</p>
    <div class="small">${escapeHtml(r.source)}${r.journal_scope ? ' · scope: '+escapeHtml(r.journal_scope) : ''}</div>
  </article>`).join('');
  toggleEpiResearch.style.display = sorted.length > 10 ? 'block' : 'none';
  toggleEpiResearch.textContent = showAll ? 'Show only latest 10' : `Show all older epidemiology items (${sorted.length-10} more)`;
}
function initMap(rows){
  const el=document.getElementById('epiMap'); if(!el) return;
  if(typeof L === 'undefined'){
    el.innerHTML='<div class="map-fallback">Leaflet could not be loaded. Use map_features.csv for geographic records.</div>'; return;
  }
  const map=L.map('epiMap', {scrollWheelZoom:false}).setView([0.25, 30.15], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 10, attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const provinceStyle={color:'#d08a00',weight:1.5,fillColor:'#f4d35e',fillOpacity:0.42};
  const provinceBoxes=[
    {name:'Ituri affected province (schematic)', bounds:[[0.4,28.9],[3.4,31.2]]},
    {name:'North Kivu affected province (schematic)', bounds:[[-1.9,28.1],[0.7,30.0]]},
    {name:'South Kivu affected province (schematic)', bounds:[[-4.0,27.6],[-1.4,29.6]]}
  ];
  provinceBoxes.forEach(p=>L.rectangle(p.bounds, provinceStyle).addTo(map).bindPopup(p.name));
  const group=L.featureGroup().addTo(map);
  rows.forEach(r=>{
    const lat=num(r.lat), lon=num(r.lon); if(lat==null||lon==null) return;
    const cases=num(r.confirmed_cases)||0;
    const isImport=(r.type||'').includes('imported');
    const color=isImport ? '#bd4b18' : ((r.type||'').includes('health_zone') ? '#e67300' : '#1769aa');
    const radius=Math.max(7, Math.min(24, 6 + Math.sqrt(cases||1)*1.8));
    const marker=L.circleMarker([lat,lon], {radius, color, weight:2, fillColor:color, fillOpacity:0.72}).addTo(group);
    marker.bindPopup(`<strong>${escapeHtml([r.country,r.admin1,r.admin2].filter(Boolean).join(' / '))}</strong><br>${escapeHtml(r.status)}<br>Confirmed: ${fmt(cases)}${r.confirmed_deaths ? '<br>Deaths: '+escapeHtml(r.confirmed_deaths) : ''}${r.suspected_cases ? '<br>Suspected: '+escapeHtml(r.suspected_cases) : ''}<br><span class="small">${link(r.source_url, r.source_name)}</span><br>${escapeHtml(r.popup||'')}`);
  });
  if(group.getLayers().length) map.fitBounds(group.getBounds().pad(0.35));
  const legend=L.control({position:'bottomleft'});
  legend.onAdd=()=>{
    const div=L.DomUtil.create('div','map-legend');
    div.innerHTML='<strong>Legend</strong><br><span class="legend-box affected"></span>Affected provinces<br><span class="legend-dot health"></span>Affected health zones<br><span class="legend-dot imported"></span>Cities with imported cases';
    return div;
  };
  legend.addTo(map);
}
(async function init(){
  const [sit, geo, mapRows, resp, epiResearch, rd, latest48] = await Promise.all([
    csv('data/situation_timeseries.csv'), csv('data/geography.csv'), csv('data/map_features.csv'), csv('data/response_tracker.csv'), csv('data/epidemiological_research.csv'), csv('data/rd_tracker.csv'), csv('data/latest_48h_summary.csv')
  ]);
  const latestDRC=[...sit].filter(r=>r.country==='DRC').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  const latestUGA=[...sit].filter(r=>r.country==='Uganda').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  drcConfirmed.textContent=fmt(num(latestDRC?.confirmed_cases)); drcDeaths.textContent=fmt(num(latestDRC?.confirmed_deaths));
  ugaConfirmed.textContent=fmt(num(latestUGA?.confirmed_cases)); ugaDeaths.textContent=fmt(num(latestUGA?.confirmed_deaths));
  try{ const m=await (await fetch('data/manifest.json', {cache:'no-store'})).json(); lastUpdated.textContent=(m.generated_at_utc||'').slice(0,16).replace('T',' ')+' UTC'; }catch(e){ lastUpdated.textContent=new Date().toISOString().slice(0,10); }
  renderLatest48(latest48);
  initMap(mapRows); drawLine('curve', sit); drawBars('geoBars', geo);
  let showResp=false, showEpi=false;
  chips('responseFilters', resp, 'organization', 8); chips('epiResearchFilters', epiResearch, 'topic', 8);
  renderResponse(resp, showResp); renderEpiResearch(epiResearch, showEpi);
  toggleResponse.onclick=()=>{showResp=!showResp; renderResponse(resp, showResp)};
  toggleEpiResearch.onclick=()=>{showEpi=!showEpi; renderEpiResearch(epiResearch, showEpi)};
  table('situationTable', sit.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'country',label:'Country'}, {key:'confirmed_cases',label:'Confirmed',render:r=>fmt(num(r.confirmed_cases))}, {key:'confirmed_deaths',label:'Deaths',render:r=>fmt(num(r.confirmed_deaths))}, {key:'suspected_cases',label:'Suspected',render:r=>fmt(num(r.suspected_cases))}, {key:'source_name',label:'Source',render:r=>link(r.source_url,r.source_name)}, {key:'notes',label:'Notes'}]);
  table('mapTable', mapRows.slice().sort((a,b)=>b.confirmed_cases-a.confirmed_cases), [
    {key:'country',label:'Country'}, {key:'admin1',label:'Admin1'}, {key:'admin2',label:'Admin2'}, {key:'status',label:'Status'}, {key:'confirmed_cases',label:'Confirmed',render:r=>fmt(num(r.confirmed_cases))}]);
  table('epiResearchTable', epiResearch.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>link(r.url,r.title)}, {key:'source',label:'Source'}, {key:'topic',label:'Topic'}, {key:'key_message',label:'Key message'}, {key:'details',label:'Epidemiological relevance'}, {key:'screening_query',label:'Screening query'}, {key:'peer_review_status',label:'Review status'}]);
  table('rdTable', rd.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>link(r.url,r.title)}, {key:'topic',label:'Topic'}, {key:'candidate_or_product',label:'Candidate/product'}, {key:'platform_or_modality',label:'Platform/modality'}, {key:'developer_or_sponsor',label:'Developer/sponsor'}, {key:'key_message',label:'Key message'}, {key:'r_and_d_stage',label:'Stage'}, {key:'peer_review_status',label:'Review status'}]);
})();
