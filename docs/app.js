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
  const sorted = rows.slice().filter(r => (r.outbreak_scope || '').toLowerCase().includes('current') || (r.current_outbreak_only || '').toLowerCase()==='true' || (r.date || '') >= '2026-04-01').sort((a,b)=>b.date.localeCompare(a.date));
  epiResearchCount.textContent = `${sorted.length} items`;
  if(!sorted.length){
    epiResearchTimeline.innerHTML = '<p class="small empty-note">No current-outbreak epidemiological research item has been promoted to the curated tracker yet. Review <code>epidemiological_research_candidates.csv</code> after each automated screening run.</p>';
  } else {
    epiResearchTimeline.innerHTML = sorted.map((r,i)=>`<article class="event ${(!showAll && i>=10)?'hidden':''}">
      <div class="event-head"><div><div class="title">${link(r.url, r.title)}</div><span class="tag epi">${escapeHtml(r.topic)}</span><span class="tag">${escapeHtml(r.evidence_type)}</span><span class="tag">${escapeHtml(r.peer_review_status)}</span></div><div class="date">${escapeHtml(r.date)}</div></div>
      <p>${escapeHtml(r.key_message)}</p>
      <p class="details">${escapeHtml(r.details || r.relevance || '')}</p>
      <div class="small">${escapeHtml(r.source)}${r.journal_scope ? ' · scope: '+escapeHtml(r.journal_scope) : ''}</div>
    </article>`).join('');
  }
  toggleEpiResearch.style.display = sorted.length > 10 ? 'block' : 'none';
  toggleEpiResearch.textContent = showAll ? 'Show only latest 10' : `Show all older epidemiology items (${sorted.length-10} more)`;
}
function renderRD(rows, showAll=false){
  const sorted = rows.slice().sort((a,b)=>b.date.localeCompare(a.date));
  rdCount.textContent = `${sorted.length} items`;
  rdTimeline.innerHTML = sorted.map((r,i)=>`<article class="event ${(!showAll && i>=10)?'hidden':''}">
    <div class="event-head"><div><div class="title">${link(r.url, r.title)}</div><span class="tag rnd">${escapeHtml(r.topic)}</span><span class="tag">${escapeHtml(r.r_and_d_stage || r.evidence_type)}</span></div><div class="date">${escapeHtml(r.date)}</div></div>
    <p>${escapeHtml(r.key_message)}</p>
    <p class="details">${escapeHtml(r.details || r.relevance || '')}</p>
    <div class="small">${escapeHtml(r.source)}${r.candidate_or_product ? ' · '+escapeHtml(r.candidate_or_product) : ''}${r.developer_or_sponsor ? ' · '+escapeHtml(r.developer_or_sponsor) : ''}</div>
  </article>`).join('');
  toggleRD.style.display = sorted.length > 10 ? 'block' : 'none';
  toggleRD.textContent = showAll ? 'Show only latest 10' : `Show all older R&D updates (${sorted.length-10} more)`;
}
function bubbleRadius(cases){
  const v = Math.max(1, cases || 1);
  return Math.max(9, Math.min(44, 7 + Math.sqrt(v) * 2.1));
}
function initMap(rows){
  const el=document.getElementById('epiMap'); if(!el) return;
  const W=1120, H=640;
  const bounds={lonMin:27.7, lonMax:33.55, latMin:-4.25, latMax:4.15};
  const x = lon => (lon-bounds.lonMin)/(bounds.lonMax-bounds.lonMin)*W;
  const y = lat => (bounds.latMax-lat)/(bounds.latMax-bounds.latMin)*H;
  const pts = arr => arr.map(([lon,lat])=>`${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join(' ');
  const regionPath = (arr, cls, label) => `<polygon class="${cls}" points="${pts(arr)}"><title>${escapeHtml(label)}</title></polygon>`;
  const lake = (lon,lat,rx,ry,name) => `<ellipse class="map-lake" cx="${x(lon)}" cy="${y(lat)}" rx="${rx}" ry="${ry}"><title>${escapeHtml(name)}</title></ellipse>`;
  const city = (lon,lat,name,capital=false) => `<g class="map-city"><circle cx="${x(lon)}" cy="${y(lat)}" r="${capital?4.8:3.2}"/><text x="${x(lon)+7}" y="${y(lat)+4}">${escapeHtml(name)}</text></g>`;
  const label = (lon,lat,name,cls='map-label') => `<text class="${cls}" x="${x(lon)}" y="${y(lat)}">${escapeHtml(name)}</text>`;
  const grid=[];
  for(let lon=28; lon<=33; lon+=1){ grid.push(`<line class="map-gridline" x1="${x(lon)}" y1="0" x2="${x(lon)}" y2="${H}"/>`); }
  for(let lat=-4; lat<=4; lat+=1){ grid.push(`<line class="map-gridline" x1="0" y1="${y(lat)}" x2="${W}" y2="${y(lat)}"/>`); }
  let html=`<svg class="static-map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bubble map of reported Ebola Bundibugyo confirmed cases in eastern DRC and Uganda">
    <rect class="map-bg" x="0" y="0" width="${W}" height="${H}"/>
    ${grid.join('')}
    ${regionPath([[27.72,4.1],[29.0,4.1],[29.35,3.35],[29.2,2.65],[29.55,1.75],[29.1,0.8],[28.65,-0.35],[28.8,-1.5],[28.55,-2.8],[28.2,-4.2],[27.72,-4.2]], 'country-drc', 'Democratic Republic of the Congo, eastern area')}
    ${regionPath([[30.85,3.75],[32.0,3.65],[33.2,3.1],[33.5,2.2],[33.35,0.7],[32.9,-0.7],[32.3,-1.25],[31.6,-1.05],[31.05,-0.25],[30.8,0.9]], 'country-uga', 'Uganda')}
    ${regionPath([[29.05,3.75],[30.65,3.75],[30.7,2.85],[30.45,2.05],[30.72,1.25],[30.15,0.72],[29.55,0.9],[29.2,1.95],[29.38,2.85]], 'affected-province ituri', 'Ituri affected province')}
    ${regionPath([[28.55,0.8],[29.55,0.9],[30.15,0.72],[30.0,-0.55],[29.65,-1.45],[28.85,-1.75],[28.5,-0.5]], 'affected-province nkivu', 'North Kivu affected province')}
    ${regionPath([[28.3,-1.7],[29.65,-1.45],[29.7,-2.8],[29.25,-4.1],[28.05,-4.15],[28.3,-2.6]], 'affected-province skivu', 'South Kivu affected province')}
    ${regionPath([[29.0,-1.05],[29.85,-1.1],[30.05,-1.75],[29.3,-2.05],[28.82,-1.55]], 'neighbor', 'Rwanda')}
    ${regionPath([[29.05,-2.05],[30.0,-2.05],[30.2,-2.9],[29.48,-3.35],[28.95,-2.8]], 'neighbor', 'Burundi')}
    ${regionPath([[30.0,-2.9],[33.5,-2.0],[33.55,-4.25],[29.25,-4.25]], 'neighbor', 'Tanzania / western area')}
    ${lake(31.15,1.55,18,84,'Lake Albert')}
    ${lake(29.62,-0.34,16,37,'Lake Edward')}
    ${lake(29.1,-1.95,12,43,'Lake Kivu')}
    ${lake(29.65,-3.9,18,105,'Lake Tanganyika')}
    ${lake(32.75,-1.55,112,70,'Lake Victoria')}
    <path class="map-road" d="M ${x(30.25)} ${y(1.57)} C ${x(30.05)} ${y(1.0)}, ${x(29.75)} ${y(0.1)}, ${x(29.25)} ${y(-0.7)} S ${x(29.05)} ${y(-1.9)}, ${x(28.85)} ${y(-2.5)}"/>
    <path class="map-road" d="M ${x(30.25)} ${y(1.57)} C ${x(31.2)} ${y(1.0)}, ${x(32.05)} ${y(0.6)}, ${x(32.58)} ${y(0.35)}"/>
    ${label(28.15,0.2,'Democratic Republic of the Congo','map-country-label')}
    ${label(31.55,1.0,'Uganda','map-country-label')}
    ${label(30.0,2.65,'Ituri','province-label')}
    ${label(29.2,-0.65,'North Kivu','province-label')}
    ${label(28.75,-2.55,'South Kivu','province-label')}
    ${label(29.45,-1.65,'Rwanda')}
    ${label(29.55,-2.65,'Burundi')}
    ${label(32.1,-3.55,'Tanzania')}
    ${city(30.25,1.5667,'Bunia')}
    ${city(29.27,0.49,'Beni')}
    ${city(29.22,-1.68,'Goma')}
    ${city(32.5825,0.3476,'Kampala',true)}
    ${city(32.4594,0.4044,'Wakiso')}
    <g id="map-bubbles"></g>
    <g class="map-legend-svg" transform="translate(22,492)">
      <rect width="360" height="126" rx="12"/>
      <text x="14" y="24" class="legend-title">Reported confirmed cases</text>
      <circle cx="26" cy="48" r="11" class="bubble province"></circle><text x="48" y="52">Province / district total</text>
      <circle cx="26" cy="74" r="8" class="bubble healthzone"></circle><text x="48" y="78">Health-zone count</text>
      <circle cx="26" cy="100" r="8" class="bubble imported"></circle><text x="48" y="104">Uganda imported-case area</text>
      <circle cx="235" cy="74" r="8" class="bubble example"></circle><circle cx="270" cy="74" r="17" class="bubble example"></circle><circle cx="320" cy="74" r="30" class="bubble example"></circle>
    </g>
  </svg>`;
  el.innerHTML = html;
  const svg = el.querySelector('svg');
  const g = svg.querySelector('#map-bubbles');
  const priority = {affected_province:1, imported_case_city:2, affected_health_zone:3};
  const sorted = rows.slice().sort((a,b)=>(priority[a.type]||9)-(priority[b.type]||9));
  const items=[];
  sorted.forEach(r=>{
    const lat=num(r.lat), lon=num(r.lon); if(lat==null||lon==null) return;
    const cases=num(r.confirmed_cases)||0;
    const type=r.type || '';
    const cls = type.includes('health_zone') ? 'healthzone' : (type.includes('imported') ? 'imported' : 'province');
    let radius = cls==='province' ? Math.max(20, Math.min(76, 14 + Math.sqrt(Math.max(cases,1))*3.0)) : Math.max(11, Math.min(34, 9 + Math.sqrt(Math.max(cases,1))*2.0));
    const name=[r.country,r.admin1,r.admin2].filter(Boolean).join(' / ');
    items.push(`<g class="map-bubble-group ${cls}">
      <circle class="bubble ${cls}" cx="${x(lon)}" cy="${y(lat)}" r="${radius}"><title>${escapeHtml(name)}\nConfirmed: ${fmt(cases)}${r.confirmed_deaths ? '\nDeaths: '+r.confirmed_deaths : ''}${r.suspected_cases ? '\nSuspected: '+r.suspected_cases : ''}\nSource: ${r.source_name || ''}</title></circle>
      <text class="bubble-count" x="${x(lon)}" y="${y(lat)+4}">${fmt(cases)}</text>
      <text class="bubble-name" x="${x(lon)}" y="${y(lat)+radius+16}">${escapeHtml(r.admin2 || r.admin1 || r.country)}</text>
    </g>`);
  });
  g.innerHTML = items.join('');
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
  let showResp=false, showEpi=false, showRD=false;
  chips('responseFilters', resp, 'organization', 8); chips('epiResearchFilters', epiResearch, 'topic', 8); chips('rdFilters', rd, 'topic', 8);
  renderResponse(resp, showResp); renderEpiResearch(epiResearch, showEpi); renderRD(rd, showRD);
  toggleResponse.onclick=()=>{showResp=!showResp; renderResponse(resp, showResp)};
  toggleEpiResearch.onclick=()=>{showEpi=!showEpi; renderEpiResearch(epiResearch, showEpi)};
  toggleRD.onclick=()=>{showRD=!showRD; renderRD(rd, showRD)};
  table('situationTable', sit.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'country',label:'Country'}, {key:'confirmed_cases',label:'Confirmed',render:r=>fmt(num(r.confirmed_cases))}, {key:'confirmed_deaths',label:'Deaths',render:r=>fmt(num(r.confirmed_deaths))}, {key:'suspected_cases',label:'Suspected',render:r=>fmt(num(r.suspected_cases))}, {key:'source_name',label:'Source',render:r=>link(r.source_url,r.source_name)}, {key:'notes',label:'Notes'}]);
  table('epiResearchTable', epiResearch.slice().filter(r => (r.date || '') >= '2026-04-01').sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>link(r.url,r.title)}, {key:'source',label:'Source'}, {key:'topic',label:'Topic'}, {key:'key_message',label:'Key message'}, {key:'details',label:'Epidemiological relevance'}, {key:'screening_query',label:'Screening query'}, {key:'peer_review_status',label:'Review status'}]);
  table('rdTable', rd.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>link(r.url,r.title)}, {key:'topic',label:'Topic'}, {key:'candidate_or_product',label:'Candidate/product'}, {key:'platform_or_modality',label:'Platform/modality'}, {key:'developer_or_sponsor',label:'Developer/sponsor'}, {key:'key_message',label:'Key message'}, {key:'r_and_d_stage',label:'Stage'}, {key:'peer_review_status',label:'Review status'}]);
})();
