// Barber Pro Admin Panel
const A=location.origin;

// Auth
let T=(()=>{try{return localStorage.getItem('barber_token')}catch(e){return null}})();
const urlP=new URLSearchParams(location.search);
const urlTok=urlP.get('token'),urlShop=urlP.get('shop');
if(urlTok){T=urlTok;try{localStorage.setItem('barber_token',urlTok)}catch(e){}}
if(!T){location='/admin-login'+(urlShop?'?slug='+urlShop:'')}
if(urlShop)try{localStorage.setItem('barber_shop',urlShop)}catch(e){}
// Check subscription — redirect to expired if blocked, hide tabs for basic
let PLAN=(function(){try{return localStorage.getItem('barber_plan')||'pro'}catch(e){return 'pro'}})();
// Also check sub_status via API for expired redirect
(async function(){try{const r=await fetch(A+'/api/admin/shop/info',{headers:{'Authorization':'Bearer '+T}});const d=await r.json();if(d.sub_status==='expired'){location='/expired?shop='+(urlShop||(function(){try{return localStorage.getItem('barber_shop')}catch(e){}})())};localStorage.setItem('barber_plan',d.plan||'pro');if(d.plan==='basic'){setTimeout(function(){['today','bookings','customers','sms','analytics','commission'].forEach(function(t){var el=document.querySelector('#tabs a[data-tab="'+t+'"]');if(el)el.setAttribute('hidden','');el.style.display='none'});var tb=document.getElementById('today-bookings');if(tb)tb.style.display='none'},0)}}catch(e){}})();
if(PLAN==='basic'){setTimeout(function(){['today','bookings','customers','sms','analytics','commission'].forEach(function(t){var el=document.querySelector('#tabs a[data-tab="'+t+'"]');if(el)el.setAttribute('hidden','');el.style.display='none'});var tb=document.getElementById('today-bookings');if(tb)tb.style.display='none'},0)}
const H={'Authorization':'Bearer '+T,'Content-Type':'application/json'};

// Tab switching
document.querySelectorAll('#tabs a').forEach(a=>{a.onclick=()=>{
  document.querySelectorAll('#tabs a').forEach(x=>x.classList.remove('act'));
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('act'));
  a.classList.add('act');
  const p=document.getElementById('page-'+a.dataset.tab);
  if(p)p.classList.add('act');
  const t=a.dataset.tab;
  if(t==='barbers')loadBarbers();
  if(t==='services')loadServices();
  if(t==='settings')loadSettings();
  if(t==='sms')loadSmsTab();
  if(t==='commission')loadCommission();
  if(t==='analytics')loadAnalytics();
  if(t==='today')loadSchedule();
  if(t==='queue')loadQueue();
  if(t==='bookings')loadBookings();
  if(t==='customers')loadCustomers();
}});

// Stats
async function loadStats(){
  try{
    const s=await fetch(A+'/api/admin/stats',{headers:H}).then(r=>r.json());
    document.getElementById('stats').innerHTML=
      `<div class="stat"><div class="num">${s.todayBookings}</div><div class="lbl">Өнөөдөр</div></div>`+
      `<div class="stat"><div class="num">${s.totalBookings}</div><div class="lbl">Нийт захиалга</div></div>`+
      `<div class="stat"><div class="num">${s.customers}</div><div class="lbl">Харилцагчид</div></div>`+
      `<div class="stat"><div class="num">${(s.revenue||0).toLocaleString()}₮</div><div class="lbl">Орлого</div></div>`;
  }catch(e){}
}

// Auto-refresh
setInterval(async()=>{
  try{
    await loadStats();
    await loadSchedule();
    await loadCommission();
    const[b,c]=await Promise.all([
      fetch(A+'/api/admin/bookings',{headers:H}).then(r=>r.json()),
      fetch(A+'/api/admin/customers',{headers:H}).then(r=>r.json())
    ]);
    const fd=document.getElementById('book-filter').value;
    const f=fd?b.filter(r=>r.booking_date===fd):b;
    document.getElementById('bt').innerHTML=f.map(r=>`<tr><td>${r.booking_date}</td><td>${r.booking_time}</td><td>${r.customer_name}</td><td>${r.customer_phone}</td><td>${r.barber_name||''}</td><td>${r.service_name}</td><td>${(+r.price||0).toLocaleString()}₮</td><td>${r.status==='confirmed'?`<span class="status ok">Бат</span> <button class="btn-sm" onclick="toggleStatus('${r.id}','cancelled')">✕</button>`:r.status}</td></tr>`).join('');
    document.getElementById('ct').innerHTML=c.map(r=>`<tr><td>${r.name||'—'}</td><td>${r.phone}</td><td>${r.total_visits}</td><td>${r.last_visit||'—'}</td><td><input class="inp" style="margin:0;padding:3px 6px;font-size:.65rem" value="${r.note||''}" onchange="saveNote('${r.phone}',this.value)"></td></tr>`).join('');
  }catch(e){}
},8000);

// WebSocket
(function ws(){
  const slug=(()=>{try{return localStorage.getItem('barber_shop')}catch(e){}})();
  if(!slug){setTimeout(ws,2000);return}
  const p=location.protocol==='https:'?'wss:':'ws:';
  try{
    const s=new WebSocket(p+'//'+location.host+'/ws?shop='+slug);
    s.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='connected')return;if(d.type==='queue:next'||d.type==='queue:join'||d.type==='queue:change')loadQueue();if(d.type==='booking:new'){playNotif();loadSchedule();loadAnalytics()}}catch(e){}};
    s.onclose=()=>setTimeout(ws,3000);
  }catch(e){setTimeout(ws,2000)}
})();

// Queue polling
let lqp=0;
(function qp(){if(Date.now()-lqp>2000){loadQueue();lqp=Date.now()}requestAnimationFrame(qp)})();

// Notification
function playNotif(){
  try{
    const c=new(window.AudioContext||window.webkitAudioContext)();
    const o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);
    o.frequency.value=800;o.type='sine';
    g.gain.setValueAtTime(.3,c.currentTime);
    g.gain.exponentialRampToValueAtTime(.01,c.currentTime+.5);
    o.start(c.currentTime);o.stop(c.currentTime+.5);
    setTimeout(()=>{
      const c2=new(window.AudioContext||window.webkitAudioContext)();
      const o2=c2.createOscillator(),g2=c2.createGain();
      o2.connect(g2);g2.connect(c2.destination);
      o2.frequency.value=1000;o2.type='sine';
      g2.gain.setValueAtTime(.3,c2.currentTime);
      g2.gain.exponentialRampToValueAtTime(.01,c2.currentTime+.3);
      o2.start(c2.currentTime);o2.stop(c2.currentTime+.3);
    },200);
    const n=document.createElement('div');
    n.style.cssText='position:fixed;top:12px;right:12px;background:#1a8f4a;color:white;padding:10px 16px;border-radius:8px;font-size:.8rem;font-weight:600;z-index:1000';
    n.textContent='🔔 Шинэ захиалга ирлээ!';document.body.appendChild(n);
    setTimeout(()=>n.remove(),4000);
  }catch(e){}
}
try{if(Notification.permission==='default')Notification.requestPermission()}catch(e){}

// Queue functions
async function loadQueue(){
  try{
    const r=await fetch(A+'/api/admin/queue?_='+Date.now(),{headers:H});
    const d=await r.json();
    const bid=document.getElementById('queue-barber')?.value||'';
    // Filter by selected barber
    const fQueue=bid?d.queue.filter(q=>q.barber_id===bid||(!q.barber_id&&!bid)):d.queue;
    const fServing=bid?d.serving.filter(s=>s.barber_id===bid||(!s.barber_id&&!bid)):d.serving;
    const w=fQueue.length,s=fServing.length,n=(d.stats.find(x=>x.status==='done')||{}).c||0;
    document.getElementById('q-waiting-num').textContent=w;
    document.getElementById('q-serving-num').textContent=s;
    document.getElementById('q-done-num').textContent=n;
    // Populate barber selector
    try{const br=await fetch(A+'/api/admin/barbers',{headers:H});const bl=await br.json();const bs=document.getElementById('queue-barber');if(bs){const cv=bs.value;bs.innerHTML='<option value="">Бүгд</option>'+bl.map(b=>`<option value="${b.id}" ${b.id===cv?'selected':''}>${b.name}</option>`).join('')}}catch(e){}
    let h='';
    fServing.forEach(x=>{h+=`<div class="sched"><span class="tm">🔴</span><span class="nm">${x.customer_name||x.phone}</span><span class="sv">${x.booked_service?'📅 '+x.booked_service+' · '+x.booking_time:'Үйлчилгээнд'}</span></div>`});
    if(!w&&!s)h='<p style="font-size:.7rem;color:var(--dim)">Дараалалд хүн байхгүй</p>';
    fQueue.forEach(q=>{
      const b=q.priority>0&&q.booking_time,sv=!b&&q.service_name;
      h+=`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1px solid ${b?'rgba(212,160,23,.25)':'var(--border)'};border-left:3px solid ${b?'var(--accent)':sv?'var(--green)':'var(--border)'};border-radius:0 6px 6px 0;margin-bottom:4px">
        <div style="font-weight:700;font-size:.85rem;min-width:26px">#${q.position}</div>
        <div style="flex:1"><div style="font-size:.75rem;font-weight:600">${q.customer_name||'Бүртгэлгүй'}</div>
        <div style="font-size:.62rem;color:var(--dim)">${q.phone}${q.barber_name?' · '+q.barber_name:''}</div>
        ${b?`<div style="font-size:.6rem;color:var(--accent);margin-top:1px">📅 ${q.booked_service||''} · ${q.booking_time}</div>`:''}
        ${sv?`<div style="font-size:.6rem;color:var(--green);margin-top:1px">✂️ ${q.service_name}</div>`:''}</div>
        <button class="btn-sm" onclick="queueNext()" style="background:var(--green);color:white;border:none;font-size:.7rem;padding:5px 9px">▶</button>
        <button class="btn-sm" onclick="queueSkip('${q.id}')">⏭</button>
        <button class="btn-sm" onclick="queueRemove('${q.id}')">✕</button></div>`;
    });
    document.getElementById('queue-list').innerHTML=h;
    try{
      const td=new Date().toLocaleDateString('en-CA');
      const br=await fetch(A+'/api/admin/bookings?date='+td,{headers:H});
      const bd=await br.json();
      let bk='';bd.filter(x=>x.status==='confirmed').sort((a,b)=>b.booking_time.localeCompare(a.booking_time)).forEach(b=>{
        bk+=`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03)"><span><span style="color:var(--accent)">${b.booking_time}</span> ${b.customer_name}</span><span style="color:var(--dim)">${b.service_name||''} · ${b.barber_name||''}</span></div>`;
      });
      document.getElementById('today-bookings').innerHTML=bk||'Захиалга байхгүй';
    }catch(e){}
  }catch(e){}
}
async function queueNext(){
  try{
    const s=document.getElementById('queue-svc').value;
    const bid=document.getElementById('queue-barber').value;
    const body={};if(bid)body.barber_id=bid;if(s)body.service_id=s;
    const r=await fetch(A+'/api/admin/queue/next',{method:'POST',headers:H,body:JSON.stringify(body)});
    const d=await r.json();
    if(d.success)loadQueue();
  }catch(e){}
}
async function queueSkip(id){if(!confirm('Алгасах уу?'))return;try{await fetch(A+'/api/admin/queue/skip',{method:'POST',headers:H,body:JSON.stringify({id})});loadQueue()}catch(e){}}
async function queueRemove(id){if(!confirm('Хасах уу?'))return;try{await fetch(A+'/api/admin/queue/remove',{method:'POST',headers:H,body:JSON.stringify({id,status:'cancelled'})});loadQueue()}catch(e){}}
function showAddForm(){document.getElementById('q-add-form').style.display='block'}
async function queueAdd(){const p=document.getElementById('qa-phone').value.trim();if(!p)return alert('Утас оруулна уу');try{const r=await fetch(A+'/api/admin/queue/add',{method:'POST',headers:H,body:JSON.stringify({phone:p})});const d=await r.json();if(d.success){document.getElementById('q-add-form').style.display='none';document.getElementById('qa-phone').value='';loadQueue()}else alert(d.error)}catch(e){}}

// Schedule
async function loadSchedule(){
  try{
    const r=await fetch(A+'/api/admin/schedule/today',{headers:H});
    const d=await r.json();
    let h='';
    d.schedule.forEach(b=>{
      h+=`<div class="card"><h3>✂️ ${b.barber}</h3>`;
      if(b.bookings.length===0)h+='<p style="font-size:.7rem;color:var(--dim)">Захиалга байхгүй</p>';
      b.bookings.forEach(bk=>{h+=`<div class="sched"><span class="tm">${bk.booking_time}</span><span class="nm">${bk.customer_name}</span><span class="sv">${bk.service_name} · ${(+bk.price||0).toLocaleString()}₮</span></div>`});
      h+='</div>';
    });
    document.getElementById('today-sched').innerHTML=h;
  }catch(e){}
}

// Bookings
async function loadBookings(){
  try{
    const fd=document.getElementById('book-filter').value;
    const r=await fetch(A+'/api/admin/bookings'+(fd?'?date='+fd:''),{headers:H});
    const d=await r.json();
    document.getElementById('bt').innerHTML=d.map(r=>`<tr><td>${r.booking_date}</td><td>${r.booking_time}</td><td>${r.customer_name}</td><td>${r.customer_phone}</td><td>${r.barber_name||''}</td><td>${r.service_name}</td><td>${(+r.price||0).toLocaleString()}₮</td><td>${r.status==='confirmed'?`<span class="status ok">Бат</span> <button class="btn-sm" onclick="toggleStatus('${r.id}','cancelled')">✕</button>`:r.status}</td></tr>`).join('');
  }catch(e){}
}
async function toggleStatus(id,s){try{await fetch(A+'/api/admin/booking/status',{method:'POST',headers:H,body:JSON.stringify({id,status:s})});loadBookings()}catch(e){}}

// Customers
async function loadCustomers(){
  try{
    const r=await fetch(A+'/api/admin/customers',{headers:H});
    const d=await r.json();
    document.getElementById('ct').innerHTML=d.map(r=>`<tr><td>${r.name||'—'}</td><td>${r.phone}</td><td>${r.total_visits}</td><td>${r.last_visit||'—'}</td><td><input class="inp" style="margin:0;padding:3px 6px;font-size:.65rem" value="${r.note||''}" onchange="saveNote('${r.phone}',this.value)"></td></tr>`).join('');
  }catch(e){}
}
async function saveNote(p,v){try{await fetch(A+'/api/admin/customer/note',{method:'POST',headers:H,body:JSON.stringify({phone:p,note:v})})}catch(e){}}

// Barbers
async function loadBarbers(){
  try{
    const r=await fetch(A+'/api/admin/barbers',{headers:H});
    const d=await r.json();
    let h='';
    d.forEach(b=>{const slug=(()=>{try{return localStorage.getItem('barber_shop')}catch(e){}})();h+=`<div class="barber-card"><div class="av">✂️</div><div class="info"><div class="name">${b.name}</div><div class="title">${b.title||''}${b.specialty?' · '+b.specialty:''} · ${b.experience||''} · ${b.commission||50}% комисс</div></div><a class="btn-sm" href="/shop/${slug}/barber?token=${encodeURIComponent(T)}&barber_id=${b.id}&barber_name=${encodeURIComponent(b.name)}" target="_blank" style="text-decoration:none;color:var(--accent)">📱</a><button class="btn-sm" onclick="editBarber('${b.id}')">✏️</button><button class="btn-sm" onclick="editSchedule('${b.id}','${b.name.replace(/'/g,"\\'")}')">📅</button><button class="btn-sm" onclick="rmBarber('${b.id}')">✕</button></div>`});
    document.getElementById('barber-grid').innerHTML=h;
  }catch(e){}
}
function showBarberForm(){document.getElementById('barber-form').style.display='block';['bf-name','bf-title','bf-spec','bf-exp','bf-desc'].forEach(id=>document.getElementById(id).value='');document.getElementById('bf-comm').value=50;delete document.getElementById('barber-form').dataset.editId}
async function saveBarber(){
  try{
    const id=document.getElementById('barber-form').dataset.editId;
    const body={name:document.getElementById('bf-name').value.trim(),title:document.getElementById('bf-title').value.trim(),specialty:document.getElementById('bf-spec').value.trim(),experience:document.getElementById('bf-exp').value.trim(),description:document.getElementById('bf-desc').value.trim(),commission:parseInt(document.getElementById('bf-comm').value)||50};
    if(!body.name)return alert('Нэр оруулна уу');
    if(id)body.id=id;
    const r=await fetch(A+'/api/admin/barbers/'+(id?'update':'add'),{method:'POST',headers:H,body:JSON.stringify(body)});
    if((await r.json()).success){document.getElementById('barber-form').style.display='none';loadBarbers()}
  }catch(e){}
}
async function editBarber(id){
  try{
    const r=await fetch(A+'/api/admin/barbers',{headers:H});
    const d=await r.json();
    const b=d.find(x=>x.id===id);
    if(!b)return;
    document.getElementById('bf-name').value=b.name;
    document.getElementById('bf-title').value=b.title||'';
    document.getElementById('bf-spec').value=b.specialty||'';
    document.getElementById('bf-exp').value=b.experience||'';
    document.getElementById('bf-desc').value=b.description||'';
    document.getElementById('bf-comm').value=b.commission||50;
    document.getElementById('barber-form').dataset.editId=id;
    document.getElementById('barber-form').style.display='block';
  }catch(e){}
}
async function rmBarber(id){if(!confirm('Устгах уу?'))return;try{await fetch(A+'/api/admin/barbers/remove',{method:'POST',headers:H,body:JSON.stringify({id})});loadBarbers()}catch(e){}}
let _schBarberId=null;async function editSchedule(id,name){_schBarberId=id;document.getElementById('sch-barber-name').textContent=name;const r=await fetch(A+'/api/admin/barber/'+id+'/schedule',{headers:H});const d=await r.json();const days=['Ням','Дав','Мяг','Лха','Пүр','Баа','Бям'];let h='';for(let i=0;i<7;i++){const s=d.find(x=>x.day_of_week===i)||{};const on=s.active===1;h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)"><input type="checkbox" '+(on?'checked':'')+' onchange="this.nextElementSibling.style.display=this.checked?\'\':\'none\';this.nextElementSibling.nextElementSibling.style.display=this.checked?\'\':\'none\'" style="width:16px;height:16px"><span style="width:36px;font-weight:600;font-size:.72rem">'+days[i]+'</span><input class="inp" value="'+(s.start_time||'10:00')+'" type="time" style="width:80px;padding:4px 6px;font-size:.65rem;display:'+(on?'':'none')+'"><span style="font-size:.65rem;color:var(--dim);display:'+(on?'':'none')+'">—</span><input class="inp" value="'+(s.end_time||'20:00')+'" type="time" style="width:80px;padding:4px 6px;font-size:.65rem;display:'+(on?'':'none')+'"></div>'}
document.getElementById('sch-days').innerHTML=h;document.getElementById('schedule-editor').style.display='block'}
async function saveSchedule(){const rows=document.querySelectorAll('#sch-days > div');const sched=[];rows.forEach((r,i)=>{const cb=r.querySelector('input[type=checkbox]');if(cb.checked){const ts=r.querySelectorAll('input[type=time]');sched.push({day_of_week:i,start_time:ts[0].value,end_time:ts[1].value,active:1})}});await fetch(A+'/api/admin/barber/'+_schBarberId+'/schedule',{method:'POST',headers:H,body:JSON.stringify({schedule:sched})});document.getElementById('schedule-editor').style.display='none';alert('Хадгалагдлаа')}

// Services
async function loadServices(){
  try{
    const r=await fetch(A+'/api/admin/services',{headers:H});
    const d=await r.json();
    document.getElementById('svc-grid').innerHTML=d.map(s=>`<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px"><div style="font-weight:600;font-size:.82rem">${s.name}</div><div style="font-size:1rem;font-weight:700;color:var(--green);margin:4px 0">${s.price.toLocaleString()}₮</div><div style="font-size:.68rem;color:var(--dim)">⏱ ${s.duration} мин${s.deposit_amount>0?' · 🔒 Урьдчилгаа '+(s.deposit_amount).toLocaleString()+'₮':''}</div><div style="margin-top:8px"><button class="btn-sm" onclick="editService('${s.id}')">✏️</button> <button class="btn-sm" onclick="rmService('${s.id}')">✕</button></div></div>`).join('');
    const q=document.getElementById('queue-svc');
    if(q)q.innerHTML='<option value="">Үйлчилгээ сонгох</option>'+d.map(s=>`<option value="${s.id}">${s.name} (${s.price.toLocaleString()}₮)</option>`).join('');
  }catch(e){}
}
function showSvcForm(){document.getElementById('svc-form').style.display='block';['sv-name','sv-price','sv-dur','sv-deposit','sv-desc'].forEach(id=>document.getElementById(id).value='');delete document.getElementById('svc-form').dataset.editId}
async function saveService(){
  try{
    const n=document.getElementById('sv-name').value.trim(),p=parseInt(document.getElementById('sv-price').value),d=parseInt(document.getElementById('sv-dur').value);
    if(!n||!p||!d)return alert('Бүх талбарыг бөглөнө үү');
    const body={name:n,price:p,duration:d,description:document.getElementById('sv-desc').value.trim(),deposit_amount:parseInt(document.getElementById('sv-deposit').value)||0};
    const id=document.getElementById('svc-form').dataset.editId;
    if(id)body.id=id;
    const r=await fetch(A+'/api/admin/services/'+(id?'update':'add'),{method:'POST',headers:H,body:JSON.stringify(body)});
    if((await r.json()).success){document.getElementById('svc-form').style.display='none';loadServices()}
  }catch(e){}
}
async function editService(id){try{const r=await fetch(A+'/api/admin/services',{headers:H});const d=await r.json();const s=d.find(x=>x.id===id);if(!s)return;document.getElementById('sv-name').value=s.name;document.getElementById('sv-price').value=s.price;document.getElementById('sv-dur').value=s.duration;document.getElementById('sv-desc').value=s.description||'';document.getElementById('sv-deposit').value=s.deposit_amount||0;document.getElementById('svc-form').dataset.editId=id;document.getElementById('svc-form').style.display='block'}catch(e){}}
function rmService(id){if(!confirm('Устгах уу?'))return;fetch(A+'/api/admin/services/remove',{method:'POST',headers:H,body:JSON.stringify({id})}).then(()=>loadServices())}

// Settings
async function loadSettings(){
  try{
    const r=await fetch(A+'/api/admin/shop/info',{headers:H});
    const d=await r.json();
    document.getElementById('s-name').value=d.name||'';
    document.getElementById('s-tag').value=d.tagline||'';
    document.getElementById('s-phone').value=d.phone||'';
    document.getElementById('s-addr').value=d.address||'';
    document.getElementById('s-ig').value=d.instagram||'';
    document.getElementById('s-pc').value=d.primary_color||'#1a1a1a';
    document.getElementById('s-ac').value=d.accent_color||'#d4a017';
    document.getElementById('shop-name').textContent=d.name||'Админ';
    loadQpaySettings();
    const qr=document.getElementById('set-qr');if(qr)qr.value=location.origin+'/shop/'+d.slug+'/queue';
    const qc=document.getElementById('qr-customer');if(qc)qc.src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(location.origin+'/shop/'+d.slug+'/queue');
    const qb=document.getElementById('qr-barber');if(qb)qb.src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(location.origin+'/shop/'+d.slug+'/barber');
    const br=document.getElementById('set-barber');if(br)br.value=location.origin+'/shop/'+d.slug+'/barber';
    const ig=document.getElementById('set-iglink');if(ig)ig.value=location.origin+'/shop/'+d.slug;
    const banner=document.getElementById('sub-banner');
    if(d.sub_status==='expired'){banner.style.display='block';banner.style.background='rgba(231,76,60,.1)';banner.style.color='var(--red)';banner.textContent='⚠️ Таны бүртгэл хаагдсан. 85279299 утас руу холбогдоно уу.'}
    else if(d.sub_status==='trial'&&d.trial_ends_at){const dl=Math.max(0,Math.ceil((new Date(d.trial_ends_at+'T00:00:00')-new Date())/86400000));banner.style.display='block';banner.style.background=dl<=3?'rgba(212,160,23,.1)':'rgba(46,204,113,.06)';banner.style.color=dl<=3?'var(--accent)':'var(--green)';banner.textContent=dl<=3?'⏳ Туршилт дуусахад '+dl+' хоног үлдлээ. 85279299.':'🟢 Туршилтын хугацаа: '+dl+' хоног. Сард '+(PLAN==='basic'?'49,000':'99,000')+'₮.'}
  }catch(e){}
}
async function saveSettings(){try{const b={};['name','tag','phone','addr','ig'].forEach(id=>{const v=document.getElementById('s-'+id).value.trim();if(v)b[id==='tag'?'tagline':id==='addr'?'address':id==='ig'?'instagram':id]=v});b.primary_color=document.getElementById('s-pc').value;b.accent_color=document.getElementById('s-ac').value;const r=await fetch(A+'/api/admin/shop/update',{method:'POST',headers:H,body:JSON.stringify(b)});const d=await r.json();document.getElementById('set-msg').textContent=d.success?'✅ Хадгалагдлаа':'❌ Алдаа';setTimeout(()=>document.getElementById('set-msg').textContent='',2000)}catch(e){}}

// QPay settings
async function loadQpaySettings(){try{const r=await fetch(A+'/api/admin/qpay/status',{headers:H});const d=await r.json();const st=document.getElementById('qpay-status');
if(d.method!=='none'){st.style.background='rgba(46,204,113,.08)';st.style.color='var(--green)';st.textContent='✅ Урьдчилгаа идэвхтэй — '+({bank_qr:'🏦 Банкны QR',qpay:'💰 QPay',test:'🧪 Туршилт'}[d.method]||d.method)}
else{st.style.background='rgba(231,76,60,.08)';st.style.color='var(--red)';st.textContent='❌ Урьдчилгаа идэвхгүй'}
document.getElementById('deposit-method').value=d.method||'none';showDepMethodFields()}catch(e){}}
function showDepMethodFields(){var m=document.getElementById('deposit-method').value;document.getElementById('dm-bank').style.display=m==='bank_qr'?'block':'none';document.getElementById('dm-qpay').style.display=m==='qpay'?'block':'none'}
async function saveQpay(){try{var m=document.getElementById('deposit-method').value;var u=document.getElementById('qpay-user').value.trim();var p=document.getElementById('qpay-pass').value.trim();var c=document.getElementById('qpay-code').value.trim();var bq=document.getElementById('bank-qr').value.trim();var file=document.getElementById('bank-qr-file').files[0];
let b64=null;let bqr=bq||null;
if(file){b64=await new Promise(function(ok){var r=new FileReader();r.onload=function(){ok(r.result)};r.readAsDataURL(file)});bqr=bqr||b64}
var body={deposit_method:m,deposit_enabled:m!=='none',username:u||null,password:p||null,invoice_code:c||null,bank_qr_url:bqr,bank_qr_image:b64};
const r=await fetch(A+'/api/admin/qpay/save',{method:'POST',headers:H,body:JSON.stringify(body)});const d=await r.json();document.getElementById('qpay-msg').textContent=d.success?'✅ Хадгалагдлаа':'❌ '+d.error;setTimeout(()=>document.getElementById('qpay-msg').textContent='',3000);loadQpaySettings()}catch(e){}}

// SMS
async function loadSmsTab(){try{const r=await fetch(A+'/api/admin/sms/status',{headers:H});const d=await r.json();document.getElementById('page-sms').innerHTML='<div class="card"><h3>🔑 SMS Тохиргоо</h3><div style="font-size:.72rem;margin-bottom:8px;padding:8px 12px;border-radius:6px;background:'+(d.connected?'rgba(46,204,113,.08)':'rgba(231,76,60,.08)')+';color:'+(d.connected?'var(--green)':'var(--red)')+'">'+(d.connected?'✅ Холбогдсон — '+d.provider:'❌ Холбогдоогүй')+'</div><div style="margin-bottom:8px"><label style="font-size:.65rem;color:var(--dim);display:block;margin-bottom:3px">Үйлчилгээ үзүүлэгч</label><select class="inp" id="sms-provider" style="font-size:.75rem"><option value="smsmn" '+(d.provider==='smsmn'?'selected':'')+'>SMS Gateway MN</option><option value="mocean" '+(d.provider==='mocean'?'selected':'')+'>MoceanSMS</option></select></div><div style="margin-bottom:8px"><label style="font-size:.65rem;color:var(--dim);display:block;margin-bottom:3px">API Түлхүүр</label><input class="inp" id="sms-key" placeholder="api түлхүүрээ оруулна уу"></div><button class="btn" onclick="saveSmsKey()">💾 Хадгалах</button></div><div class="card"><h3>📨 SMS Илгээх</h3><div style="margin-bottom:8px"><label style="font-size:.65rem;color:var(--dim);display:block;margin-bottom:3px">Тест утас</label><div class="row"><input class="inp" id="test-phone" placeholder="Утасны дугаар" style="flex:1"><button class="btn-s" onclick="testSms()">📱 Тест</button></div></div><div style="margin-bottom:8px"><label style="font-size:.65rem;color:var(--dim);display:block;margin-bottom:3px">Мессеж</label><textarea class="inp" id="sms-text" style="min-height:60px" placeholder="Мессежээ бичнэ үү"></textarea></div><button class="btn" onclick="doSms()" style="width:100%">📨 Бүгдэд илгээх</button><div id="sms-res" style="font-size:.7rem;margin-top:6px;text-align:center"></div></div><div class="card"><h3>⏰ Автомат Сануулагч</h3><p style="font-size:.68rem;color:var(--dim);margin-bottom:10px">Бүртгэлтэй харилцагчид руу автомат SMS илгээх</p><div class="row" style="flex-wrap:wrap;gap:6px"><button class="btn-s" onclick="remindToday()" style="flex:1;min-width:130px">📅 Өнөөдрийн захиалга</button><button class="btn-s" onclick="remindTomorrow()" style="flex:1;min-width:130px">📅 Маргаашийн захиалга</button><button class="btn-s" onclick="retention(30)" style="flex:1;min-width:130px">🔄 30+ хоног ирээгүй</button><button class="btn-s" onclick="retention(60)" style="flex:1;min-width:130px">🔄 60+ хоног ирээгүй</button></div><div id="auto-sms-res" style="font-size:.7rem;margin-top:8px;text-align:center"></div></div>'}catch(e){}}
async function saveSmsKey(){try{const k=document.getElementById('sms-key').value.trim();if(!k)return;const p=document.getElementById('sms-provider').value;await fetch(A+'/api/admin/sms/update-key',{method:'POST',headers:H,body:JSON.stringify({api_key:k,provider:p})});loadSmsTab()}catch(e){}}
async function testSms(){try{const p=document.getElementById('test-phone').value.trim();if(!p)return;const r=await fetch(A+'/api/admin/sms/test',{method:'POST',headers:H,body:JSON.stringify({phone:p})});const d=await r.json();document.getElementById('sms-res').textContent=d.success?d.message:d.error}catch(e){}}
async function doSms(){try{const m=document.getElementById('sms-text').value.trim();if(!m)return;const d=await fetch(A+'/api/admin/sms/send',{method:'POST',headers:H,body:JSON.stringify({message:m})}).then(function(r){return r.json()});document.getElementById('sms-res').innerHTML=d.success?d.message:'X '+d.error}catch(e){}}
async function remindToday(){try{const r=await fetch(A+'/api/admin/sms/remind-today',{method:'POST',headers:H});const d=await r.json();document.getElementById('auto-sms-res').textContent=d.success?d.message:d.error}catch(e){}}
async function remindTomorrow(){try{const r=await fetch(A+'/api/admin/sms/remind-tomorrow',{method:'POST',headers:H});const d=await r.json();document.getElementById('auto-sms-res').textContent=d.success?d.message:d.error}catch(e){}}
async function retention(d){try{const r=await fetch(A+'/api/admin/sms/retention',{method:'POST',headers:H,body:JSON.stringify({days:d})});const j=await r.json();document.getElementById('auto-sms-res').textContent=j.success?j.message:j.error}catch(e){}}

// Analytics
async function loadAnalytics(){
  try{
    const r=await fetch(A+'/api/admin/analytics',{headers:H});
    const d=await r.json();
    document.getElementById('a-rev').textContent='₮'+d.today.revenue.toLocaleString();
    document.getElementById('a-bk').textContent=d.today.bookings;
    document.getElementById('a-avg').textContent='₮'+d.today.avgTicket.toLocaleString();
    document.getElementById('a-q').textContent=d.today.queueServed;
    document.getElementById('a-total-bk').textContent=d.totals.bookings;
    document.getElementById('a-total-rev').textContent='₮'+d.totals.revenue.toLocaleString();
    document.getElementById('a-total-cust').textContent=d.totals.customers;
    const mx=Math.max(1,...d.weekly.map(w=>w.revenue));let c='',l='';
    d.weekly.forEach(w=>{const h=w.revenue>0?Math.max(3,Math.round(w.revenue/mx*90)):0;c+=`<div style="flex:1;display:flex;flex-direction:column;align-items:center"><div style="font-size:.55rem;color:var(--dim);margin-bottom:2px">${w.revenue>0?'₮'+(w.revenue/1000).toFixed(0)+'k':''}</div><div style="width:100%;height:${h}px;background:linear-gradient(180deg,var(--accent),rgba(212,160,23,.3));border-radius:3px 3px 0 0"></div></div>`;l+=`<span>${w.date.slice(5)}</span>`});
    document.getElementById('week-chart').innerHTML=c;
    document.getElementById('week-labels').innerHTML=l;
    let sv='';d.topServices.forEach(s=>{sv+=`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:.7rem"><span>${s.name}</span><span style="color:var(--dim)">${s.c}x · ₮${(s.rev||0).toLocaleString()}</span></div>`});
    document.getElementById('top-svcs').innerHTML=sv||'<p style="font-size:.65rem;color:var(--dim)">Мэдээлэл байхгүй</p>';
    let pk='';d.peakHours.forEach(p=>{pk+=`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:.7rem"><span>${p.booking_time.slice(0,5)}</span><span style="color:var(--dim)">${p.c}x</span></div>`});
    document.getElementById('peak-hours').innerHTML=pk||'<p style="font-size:.65rem;color:var(--dim)">Мэдээлэл байхгүй</p>';
    let bp='';d.barberPerf.forEach(b=>{bp+=`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:.7rem"><span>✂️ ${b.name}</span><div><span>${b.bookings}x</span><span style="color:var(--dim);margin-left:6px">₮${(b.revenue||0).toLocaleString()}</span><span style="color:var(--accent);margin-left:6px">+₮${(b.earnings||0).toLocaleString()}</span></div></div>`});
    document.getElementById('barber-perf').innerHTML=bp||'<p style="font-size:.65rem;color:var(--dim)">Мэдээлэл байхгүй</p>';
  }catch(e){}
}

// Commission
let _cr='today';
async function loadCommission(r){
  if(r){_cr=r;document.querySelectorAll('#cr-today,#cr-week,#cr-month').forEach(b=>{b.style.background='';b.style.color=''});const e=document.getElementById('cr-'+r);if(e){e.style.background='var(--text)';e.style.color='white'}}
  try{
    const r=await fetch(A+'/api/admin/commission?range='+_cr,{headers:H});
    const d=await r.json();
    let h=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px"><div class="stat"><div class="num">${d.totals.bookings}</div><div class="lbl">Захиалга</div></div><div class="stat"><div class="num">${d.totals.revenue.toLocaleString()}₮</div><div class="lbl">Орлого</div></div><div class="stat"><div class="num">${d.totals.earnings.toLocaleString()}₮</div><div class="lbl">Барберын цалин</div></div></div>`;
    d.barbers.forEach(b=>{h+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px"><div><div style="font-weight:600;font-size:.78rem">${b.name}</div><div style="font-size:.65rem;color:var(--dim)">${b.bookings} захиалга · ${b.revenue.toLocaleString()}₮ орлого</div></div><div style="display:flex;align-items:center;gap:6px"><div style="display:flex;align-items:center;gap:3px"><input type="number" value="${b.commission}" onchange="updateCommission('${b.id}',this.value)" style="width:42px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--text);text-align:center;font-size:.65rem;padding:2px;font-family:inherit" min="0" max="100">%</div><div style="font-size:.9rem;font-weight:700;color:var(--green)">${b.earnings.toLocaleString()}₮</div></div></div>`});
    document.getElementById('commission-data').innerHTML=h;
  }catch(e){}
}
async function updateCommission(id,v){const p=parseInt(v)||50;if(p<0||p>100)return;try{await fetch(A+'/api/admin/barbers/update',{method:'POST',headers:H,body:JSON.stringify({id,commission:p})});loadCommission()}catch(e){}}

// QR copy & download
function copyQRLink(type){var u=document.getElementById('qr-'+type);var url=u?decodeURIComponent(u.src.replace('https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=','')):'';if(!url)return;copyToClipboard(url)}
function copyIGLink(){var u=document.getElementById('set-iglink');if(!u)return;copyToClipboard(u.value)}
function copyToClipboard(text){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,99999);try{document.execCommand('copy')}catch(e){}document.body.removeChild(ta)}
function downloadQR(type){var img=document.getElementById('qr-'+type);if(!img||!img.src)return;var a=document.createElement('a');a.href=img.src;a.download='qr-'+type+'.png';document.body.appendChild(a);a.click();document.body.removeChild(a)}

// Init
loadStats();
loadQueue();
