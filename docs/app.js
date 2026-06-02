async function csv(path){
  const text = await fetch(path).then(r => r.text());
  const lines = text.trim().split(/\r?\n/);
  const headers = parseLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => Object.fromEntries(parseLine(line).map((v,i)=>[headers[i], v])));
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
function table(el, rows, cols){
  const h = '<thead><tr>'+cols.map(c=>`<th>${c.label}</th>`).join('')+'</tr></thead>';
  const b = '<tbody>'+rows.map(r=>'<tr>'+cols.map(c=>`<td>${c.render?c.render(r):escapeHtml(r[c.key]||'')}</td>`).join('')+'</tr>').join('')+'</tbody>';
  document.getElementById(el).innerHTML = h+b;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function drawLine(svgId, rows){
  const svg=document.getElementById(svgId), w=900,h=320,p={l:55,r:20,t:24,b:45}; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const data = rows.filter(r=>r.confirmed_cases).map(r=>({date:new Date(r.date), country:r.country, y:num(r.confirmed_cases)}));
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
  const ticks=[...new Set(data.map(d=>d.date.toISOString().slice(5,10)))];
  data.forEach(d=> html+=`<text x="${x(d.date)}" y="${h-18}" text-anchor="middle" font-size="11" fill="#637282">${d.date.toISOString().slice(5,10)}</text>`);
  svg.innerHTML=html;
}
function drawBars(svgId, rows){
  const svg=document.getElementById(svgId), w=700,h=320,p={l:150,r:20,t:24,b:35}; svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const data=rows.filter(r=>r.confirmed_cases).slice(0,10).map(r=>({label:[r.country,r.admin1,r.admin2].filter(Boolean).join(' / '), y:num(r.confirmed_cases)})).sort((a,b)=>b.y-a.y);
  const maxY=Math.max(...data.map(d=>d.y)); const bh=(h-p.t-p.b)/data.length-6;
  let html='';
  data.forEach((d,i)=>{ const yy=p.t+i*(bh+6), bw=d.y/(maxY||1)*(w-p.l-p.r); html+=`<text x="${p.l-8}" y="${yy+bh*.65}" text-anchor="end" font-size="12" fill="#17212b">${escapeHtml(d.label)}</text><rect x="${p.l}" y="${yy}" width="${bw}" height="${bh}" rx="4" fill="#1769aa"><title>${escapeHtml(d.label)}: ${d.y}</title></rect><text x="${p.l+bw+6}" y="${yy+bh*.65}" font-size="12" fill="#637282">${d.y}</text>`; });
  svg.innerHTML=html;
}
(async function init(){
  const [sit, geo, resp, sci] = await Promise.all([csv('data/situation_timeseries.csv'),csv('data/geography.csv'),csv('data/response_tracker.csv'),csv('data/science_tracker.csv')]);
  const latestDRC=[...sit].filter(r=>r.country==='DRC').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  const latestUGA=[...sit].filter(r=>r.country==='Uganda').sort((a,b)=>a.date.localeCompare(b.date)).pop();
  drcConfirmed.textContent=fmt(num(latestDRC.confirmed_cases)); drcDeaths.textContent=fmt(num(latestDRC.confirmed_deaths));
  ugaConfirmed.textContent=fmt(num(latestUGA.confirmed_cases)); ugaDeaths.textContent=fmt(num(latestUGA.confirmed_deaths));
  lastUpdated.textContent='Last build: '+new Date().toISOString().slice(0,10);
  drawLine('curve', sit); drawBars('geoBars', geo);
  table('situationTable', sit.slice().reverse(), [
    {key:'date',label:'Date'}, {key:'country',label:'Country'}, {key:'confirmed_cases',label:'Confirmed',render:r=>fmt(num(r.confirmed_cases))}, {key:'confirmed_deaths',label:'Deaths',render:r=>fmt(num(r.confirmed_deaths))}, {key:'suspected_cases',label:'Suspected',render:r=>fmt(num(r.suspected_cases))}, {key:'source_name',label:'Source',render:r=>`<a href="${r.source_url}" target="_blank" rel="noopener">${escapeHtml(r.source_name)}</a>`}, {key:'notes',label:'Notes'}]);
  responseTimeline.innerHTML = resp.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<div class="event"><div class="date">${r.date}</div><div class="org">${escapeHtml(r.organization)} <span class="tag">${escapeHtml(r.activity_type)}</span></div><p>${escapeHtml(r.summary)}</p><div class="small"><a href="${r.source_url}" target="_blank" rel="noopener">${escapeHtml(r.source_name)}</a> · confidence: ${escapeHtml(r.confidence_level)}</div></div>`).join('');
  table('scienceTable', sci.slice().sort((a,b)=>b.date.localeCompare(a.date)), [
    {key:'date',label:'Date'}, {key:'title',label:'Title',render:r=>`<a href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>`}, {key:'source',label:'Source'}, {key:'evidence_type',label:'Type'}, {key:'topic',label:'Topic'}, {key:'key_message',label:'Key message'}, {key:'peer_review_status',label:'Review status'}]);
})();
