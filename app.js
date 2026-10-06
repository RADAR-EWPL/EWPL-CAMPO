(()=>{'use strict';
const DB='EWPL_CAMPO_DB_V1',STORE='notas',TOKEN_KEY='EWPL_CAMPO_TOKEN_V1';let db,syncing=false;
const $=id=>document.getElementById(id),cfg=()=>window.EWPL_CAMPO_CONFIG||{};
function fechaLocal(d){const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function inferir(s){const t=(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');const h=new Date();let f='',hr='';if(/\bmanana\b/.test(t)){let d=new Date(h);d.setDate(d.getDate()+1);f=fechaLocal(d)}else if(/\bhoy\b/.test(t))f=fechaLocal(h);else{const ds=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];for(let i=0;i<7;i++)if(new RegExp('\\b'+ds[i]+'\\b').test(t)){let d=new Date(h),delta=(i-d.getDay()+7)%7;if(delta===0)delta=7;d.setDate(d.getDate()+delta);f=fechaLocal(d);break}}let m=t.match(/(?:a\s+las?\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/);if(m){let hh=+m[1],mm=+(m[2]||0);if(m[3]==='pm'&&hh<12)hh+=12;if(m[3]==='am'&&hh===12)hh=0;if(hh<24&&mm<60)hr=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')}return{fecha:f,hora:hr,recordar:/recuerd|recordar|acuerd|avis|no olvidar|tengo que/.test(t)}}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function tx(mode='readonly'){return db.transaction(STORE,mode).objectStore(STORE)}
function put(x){return new Promise((res,rej)=>{const r=tx('readwrite').put(x);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function del(id){return new Promise((res,rej)=>{const r=tx('readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function all(){return new Promise((res,rej)=>{const r=tx().getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function nuevoId(){return 'NC:'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2))}
function token(){return localStorage.getItem(TOKEN_KEY)||''}
function configOK(){return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(cfg().endpoint||'')&&token().length>20}
async function pintar(){const q=await all();$('pendientes').textContent=q.length;const on=navigator.onLine;$('estado').textContent=on?'● Con conexión':'● Sin conexión';$('estado').className='status'+(on?'':' offline');$('pareoEstado').textContent=configOK()?'Servidor: emparejado':'Servidor: sin emparejar';$('pareoEstado').className='hint '+(configOK()?'paired':'notpaired')}
function mensaje(s,c=''){$('mensaje').textContent=s;$('mensaje').className='msg '+c}
async function guardar(){const texto=$('texto').value.trim();if(!texto)return mensaje('Escribe o dicta una nota.','warn');const rec=$('recordatorio').checked,fecha=$('fecha').value,hora=$('hora').value;if(rec&&(!fecha||!hora))return mensaje('Confirma fecha y hora del recordatorio.','warn');await put({id:nuevoId(),texto,creada:new Date().toISOString(),recordatorio:rec,fecha,hora,modoRecordatorio:'NORMAL',intentos:0});$('texto').value='';$('recordatorio').checked=false;$('fechaHora').classList.add('hidden');$('interpretacion').textContent='';mensaje('Nota guardada en el teléfono.','ok');await pintar();if(navigator.onLine&&configOK())sincronizar()}
function vencida(n){return !!(n.recordatorio&&n.fecha&&n.hora&&new Date(n.fecha+'T'+n.hora).getTime()<Date.now()&&n.modoRecordatorio==='NORMAL')}
function resolverVencida(n){return new Promise(resolve=>{const d=$('dlgVencido');$('dlgVencidoTexto').textContent=`${n.texto} · ${n.fecha} ${n.hora}`;const fin=v=>{d.close();resolve(v)};$('vReprogramar').onclick=()=>fin('REPROGRAMAR');$('vCrear').onclick=()=>fin('VENCIDO');$('vSolo').onclick=()=>fin('SOLO_ANTEFICHA');$('vCancelar').onclick=()=>fin('CANCELAR');d.showModal()})}
async function reprogramar(n){const f=prompt('Nueva fecha (AAAA-MM-DD):',fechaLocal(new Date()));if(!f)return false;const h=prompt('Nueva hora (HH:MM):','09:00');if(!h)return false;n.fecha=f;n.hora=h;n.recordatorio=true;n.modoRecordatorio='NORMAL';await put(n);return true}
async function enviar(n){
  const t=window.localStorage.getItem(TOKEN_KEY)||'';
  if(!t) throw new Error('EWPL Campo no está emparejado');

  const base=String(cfg().endpoint||'').replace(/\/+$/,'');
  if(!base) throw new Error('Endpoint EWPL no configurado');

  /*
   * V1.8 — transporte aislado.
   * 1) POST simple no-cors: el navegador no necesita leer la respuesta.
   * 2) Confirmación JSONP separada por Source ID.
   * La nota sólo sale de IndexedDB cuando el servidor confirma que NC: existe.
   */
  const cuerpo=JSON.stringify({accion:'nota',token:t,nota:n});

  try{
    await fetch(base,{
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:cuerpo,
      cache:'no-store',
      redirect:'follow'
    });
  }catch(err){
    throw new Error('No se pudo enviar la nota al servidor EWPL');
  }

  await new Promise(r=>setTimeout(r,900));

  return new Promise((resolve,reject)=>{
    const id=String(n&&n.id||'');
    const cb='ewplCampoCb_'+id.replace(/[^A-Za-z0-9_]/g,'_')+'_'+Date.now();
    const s=document.createElement('script');
    let terminado=false;

    function limpiar(){
      try{delete window[cb]}catch(_){window[cb]=undefined}
      try{s.remove()}catch(_){}
    }
    function fin(err,res){
      if(terminado)return;
      terminado=true;
      clearTimeout(timer);
      limpiar();
      if(err)reject(err); else resolve(res);
    }

    window[cb]=function(res){
      if(res&&res.ok&&res.confirmada===true){
        fin(null,res);
      }else{
        fin(new Error((res&&res.error)||'El servidor no confirmó la nota'));
      }
    };

    s.onerror=function(){
      fin(new Error('La nota fue enviada, pero no se pudo confirmar con el servidor'));
    };

    s.src=base+
      '?ewplCampoConfirmar=1'+
      '&callback='+encodeURIComponent(cb)+
      '&token='+encodeURIComponent(t)+
      '&id='+encodeURIComponent(id)+
      '&_='+Date.now();

    s.async=true;
    const timer=setTimeout(
      ()=>fin(new Error('La nota fue enviada, pero el servidor no confirmó su registro')),
      15000
    );
    document.head.appendChild(s);
  });
}
async function sincronizar(manual=false){if(syncing){if(manual)mensaje('Ya hay una sincronización en curso. Espera unos segundos.','warn');return;}if(!navigator.onLine)return mensaje('Sin Internet. Las notas permanecen guardadas.','warn');if(!configOK())return mensaje('Primero empareja EWPL Campo con el servidor.','warn');syncing=true;$('sync').disabled=true;let q=await all(),ok=0,fallos=0,cancelado=false;for(const n of q){if(vencida(n)){const a=await resolverVencida(n);if(a==='CANCELAR'){cancelado=true;break}if(a==='REPROGRAMAR'){if(!(await reprogramar(n))){cancelado=true;break}}else if(a==='VENCIDO'){n.modoRecordatorio='VENCIDO';await put(n)}else if(a==='SOLO_ANTEFICHA'){n.recordatorio=false;n.modoRecordatorio='SOLO_ANTEFICHA';await put(n)}}try{await enviar(n);await del(n.id);ok++}catch(e){n.intentos=(n.intentos||0)+1;n.ultimoError=String(e&&e.message||e);await put(n);fallos++;break}}await pintar();$('sync').disabled=false;syncing=false;if(cancelado)mensaje(`${ok} sincronizadas. Sincronización detenida por el usuario.`,'warn');else if(fallos){const q2=await all(),detalle=q2[0]&&q2[0].ultimoError?` Error: ${q2[0].ultimoError}`:'';mensaje(`${ok} sincronizadas; ${fallos} sigue pendiente. No se borró del teléfono.${detalle}`,'warn');}else if(ok)mensaje(`${ok} nota(s) confirmadas por EWPL.`,'ok');else mensaje('No hay notas pendientes.','ok')}
function abrirParear(){$('tokenInput').value='';$('dlgParear').showModal();setTimeout(()=>$('tokenInput').focus(),50)}
$('parear').onclick=abrirParear;$('parearCancelar').onclick=()=>$('dlgParear').close();$('parearGuardar').onclick=async()=>{const t=$('tokenInput').value.trim();if(t.length<20)return alert('El código no parece válido.');localStorage.setItem(TOKEN_KEY,t);$('dlgParear').close();await pintar();mensaje('Dispositivo emparejado.','ok');if(navigator.onLine)sincronizar()};
$('texto').addEventListener('input',()=>{const x=inferir($('texto').value);if(x.recordar||x.fecha||x.hora){$('recordatorio').checked=!!(x.recordar||x.fecha||x.hora);$('fechaHora').classList.remove('hidden');if(x.fecha)$('fecha').value=x.fecha;if(x.hora)$('hora').value=x.hora;$('interpretacion').textContent='Interpretado: '+(x.fecha||'fecha pendiente')+(x.hora?' · '+x.hora:' · hora pendiente')+' — confirma antes de guardar.'}});
$('recordatorio').addEventListener('change',()=>$('fechaHora').classList.toggle('hidden',!$('recordatorio').checked));$('guardar').onclick=guardar;$('sync').onclick=()=>sincronizar(true);window.addEventListener('online',()=>{pintar();if(configOK())sincronizar()});window.addEventListener('offline',pintar);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine&&configOK())sincronizar()});
(async()=>{await openDB();await pintar();if('serviceWorker'in navigator)try{await navigator.serviceWorker.register('./sw.js')}catch(e){}if(navigator.onLine&&configOK())sincronizar()})();
})();