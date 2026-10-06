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
      '?accion=confirmar'+
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

/* ============================================================================
 * EWPL CAMPO V3.0 — CENTRO MÓVIL ONLINE
 * No altera el motor de Nota rápida anterior.
 * Pizarrón / fichas / Radar / acciones requieren conexión.
 * ========================================================================== */
(()=>{'use strict';
const TKEY='EWPL_CAMPO_TOKEN_V1';
const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
let dash=[], radar=[], actual=null;

function tok(){return localStorage.getItem(TKEY)||''}
function endpoint(){return String((window.EWPL_CAMPO_CONFIG||{}).endpoint||'').replace(/\/+$/,'')}
function online(){return navigator.onLine}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function cbname(){return 'ewplCampoCb_'+Date.now()+'_'+Math.random().toString(36).slice(2).replace(/[^A-Za-z0-9_]/g,'')}
function aviso(t,err=false){const e=q('#opMensaje'); if(!e)return; e.textContent=t||''; e.className='opmsg '+(err?'warn':'ok')}
function exigeOnline(){if(!online()){aviso('Esta función requiere Internet. La Nota rápida sigue disponible offline.',true);return false}if(!tok()){aviso('Empareja primero EWPL Campo con el servidor.',true);return false}return true}

function jsonp(op,data={}){
  return new Promise((resolve,reject)=>{
    if(!exigeOnline()) return reject(new Error('SIN_CONEXION'));
    const cb=cbname(), s=document.createElement('script'); let fin=false;
    const limpiar=()=>{try{delete window[cb]}catch(_){window[cb]=undefined}try{s.remove()}catch(_){}};
    const timer=setTimeout(()=>{if(fin)return;fin=true;limpiar();reject(new Error('Sin respuesta del servidor EWPL'));},20000);
    window[cb]=r=>{if(fin)return;fin=true;clearTimeout(timer);limpiar();r&&r.ok!==false?resolve(r):reject(new Error((r&&r.error)||'Error EWPL'));};
    s.onerror=()=>{if(fin)return;fin=true;clearTimeout(timer);limpiar();reject(new Error('No se pudo contactar al servidor EWPL'));};
    s.src=endpoint()+'?accion=api&callback='+encodeURIComponent(cb)+'&token='+encodeURIComponent(tok())+'&op='+encodeURIComponent(op)+'&data='+encodeURIComponent(JSON.stringify(data))+'&_='+Date.now();
    document.head.appendChild(s);
  });
}
function resultado(id){
  return new Promise((resolve,reject)=>{
    const cb=cbname(),s=document.createElement('script');let fin=false;
    const limpiar=()=>{try{delete window[cb]}catch(_){window[cb]=undefined}try{s.remove()}catch(_){}};
    const timer=setTimeout(()=>{if(fin)return;fin=true;limpiar();reject(new Error('No se confirmó la operación'));},15000);
    window[cb]=r=>{if(fin)return;if(r&&r.ok&&r.pendiente===false){fin=true;clearTimeout(timer);limpiar();resolve(r.resultado)}};
    s.onerror=()=>{if(fin)return;fin=true;clearTimeout(timer);limpiar();reject(new Error('No se pudo confirmar la operación'));};
    s.src=endpoint()+'?accion=resultado&callback='+encodeURIComponent(cb)+'&token='+encodeURIComponent(tok())+'&id='+encodeURIComponent(id)+'&_='+Date.now();
    document.head.appendChild(s);
  });
}
async function post(op,data={}){
  if(!exigeOnline()) throw new Error('SIN_CONEXION');
  const id='REQ_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  await fetch(endpoint(),{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({accion:'api',token:tok(),requestId:id,op,data}),cache:'no-store',redirect:'follow'});
  for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,i?800:450));try{const r=await resultado(id);if(r)return r}catch(e){if(i===11)throw e}}
  throw new Error('No se confirmó la operación');
}
function tab(id){
  qa('.view').forEach(x=>x.classList.add('hidden')); q('#view-'+id)?.classList.remove('hidden');
  qa('.navbtn').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));
  if(id==='pizarron') cargarPizarron();
  if(id==='radar') cargarRadar();
}
function estadoGrupo(e){e=String(e||'').toUpperCase();if(e==='EN PROCESO')return'EN PROCESO';if(e==='ESPERANDO RESPUESTA')return'ESPERANDO / REVISIÓN';return'PENDIENTE / VENCIDO'}
function cardActividad(a){
  return `<button class="actcard" data-folio="${esc(a.folio)}"><div class="acttop"><b>${esc(a.folio)}</b><span>${esc(a.prioridad||'Media')}</span></div><h3>${esc(a.actividad)}</h3><div class="muted">${esc(a.proyecto)}</div><div class="meta">${esc(a.responsable||'')} · ${esc(a.fechaCompromiso||'Sin fecha')}</div><div class="estadoTag">${esc(a.estado)}</div></button>`;
}
async function cargarPizarron(){
  if(!exigeOnline())return;
  q('#pizLista').innerHTML='<div class="muted">Actualizando…</div>';
  try{
    const r=await jsonp('dashboard');
    dash=(r.actividades||[]).filter(a=>{
      const e=String(a&&a.estado||'').trim().toUpperCase();
      return !['CERRADO','ATENDIDO','CANCELADO'].includes(e);
    });
    pintarPizarron(); aviso('Pizarrón actualizado.');
  }catch(e){q('#pizLista').innerHTML='<div class="warn">'+esc(e.message)+'</div>'}
}
function pintarPizarron(){
  const term=(q('#buscar')?.value||'').toLowerCase(), filtro=q('#fEstado')?.value||'';
  let xs=dash.filter(a=>!term||JSON.stringify(a).toLowerCase().includes(term)).filter(a=>!filtro||estadoGrupo(a.estado)===filtro);
  q('#pizResumen').textContent=`${xs.length} actividades visibles`;
  q('#pizLista').innerHTML=xs.length?xs.map(cardActividad).join(''):'<div class="empty">No hay actividades con este filtro.</div>';
  qa('.actcard').forEach(b=>b.onclick=()=>abrirFicha(b.dataset.folio));
}
async function abrirFicha(folio){
  if(!exigeOnline())return;
  try{
    const r=await jsonp('actividad',{folio}); actual=r.data||r; if(!actual.folio)throw new Error('No se recibió la ficha.');
    q('#fichaTitulo').textContent=actual.folio+' · '+(actual.actividad||'');
    q('#fichaBody').innerHTML=`
      <div class="detailgrid">
      <div><small>Proyecto</small><b>${esc(actual.proyecto)}</b></div><div><small>Responsable</small><b>${esc(actual.responsable)}</b></div>
      <div><small>Estado</small><b>${esc(actual.estado)}</b></div><div><small>Prioridad</small><b>${esc(actual.prioridad)}</b></div>
      <div><small>Compromiso</small><b>${esc(actual.fechaCompromiso||'—')}</b></div><div><small>Seguimiento</small><b>${esc(actual.proximoSeguimiento||'—')}</b></div>
      </div>
      <label>Próxima decisión</label><div class="readbox">${esc(actual.proximaDecision||'—')}</div>
      <label>Resultado / evidencia</label><div class="readbox">${esc(actual.resultadoEvidencia||'—')}</div>
      <label>Observaciones</label><div class="readbox">${esc(actual.observaciones||'—')}</div>`;
    q('#fEstadoEdit').value=actual.estado||'PENDIENTE'; q('#fPrioridadEdit').value=actual.prioridad||'Media';
    q('#dlgFicha').showModal(); cargarHistorial(folio);
  }catch(e){aviso(e.message,true)}
}
async function cargarHistorial(folio){
  q('#historial').innerHTML='<div class="muted">Cargando historial…</div>';
  try{const r=await jsonp('historial',{folio});const h=r.historial||[];q('#historial').innerHTML=h.length?h.map(x=>`<div class="hist"><b>${esc(x.fecha)} · ${esc(x.tipo)}</b><div>${esc(x.gestion)}</div><small>${esc(x.resultado||'')} ${esc(x.siguiente||'')}</small></div>`).join(''):'<div class="muted">Sin movimientos.</div>'}catch(e){q('#historial').innerHTML='<div class="warn">'+esc(e.message)+'</div>'}
}
async function guardarFicha(){
  try{const r=await post('actualizar',{folio:actual.folio,estado:q('#fEstadoEdit').value,prioridad:q('#fPrioridadEdit').value});if(r.ok===false)throw new Error(r.error);aviso(r.mensaje||'Ficha actualizada.');q('#dlgFicha').close();await cargarPizarron()}catch(e){aviso(e.message,true)}
}
async function registrarGestion(){
  const detalle=prompt('Describe la gestión realizada:'); if(!detalle)return;
  const siguiente=prompt('Siguiente acción / decisión:','')||'';
  try{const r=await post('gestion',{folio:actual.folio,tipo:'Nota / gestión interna',detalle,resultado:'',evidencia:'',siguiente});if(r.ok===false)throw new Error(r.error);aviso(r.mensaje||'Gestión registrada.');await cargarHistorial(actual.folio)}catch(e){aviso(e.message,true)}
}
function radarCard(x){
  const abrir=x.url?`<a class="mini" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir correo</a>`:'';
  return `<article class="radcard" data-fila="${x.fila}" data-source="${esc(x.sourceId)}"><div class="acttop"><b>${esc(x.fuente)}</b><span>${esc(x.estado)}</span></div><h3>${esc(x.asunto)}</h3><div class="muted">${esc(x.remitente)}</div><p>${esc(x.resumen)}</p><small>${esc(x.motivo)}</small><div class="actions">${abrir}<button class="mini vinc">Vincular</button><button class="mini crear">Crear actividad</button><button class="mini recordar">Recordarme</button><button class="mini atender">Atendido</button><button class="mini descartar">Descartar</button></div></article>`;
}
async function cargarRadar(){
  if(!exigeOnline())return;
  q('#radarLista').innerHTML='<div class="muted">Actualizando Radar…</div>';
  try{const r=await jsonp('radar');radar=r.data||[];q('#radarLista').innerHTML=radar.length?radar.map(radarCard).join(''):'<div class="empty">Radar sin antefichas pendientes.</div>';conectarRadar();aviso('Radar actualizado.')}catch(e){q('#radarLista').innerHTML='<div class="warn">'+esc(e.message)+'</div>'}
}
function conectarRadar(){
  qa('.radcard').forEach(c=>{
    const item=radar.find(x=>String(x.fila)===String(c.dataset.fila)); if(!item)return;
    c.querySelector('.atender').onclick=()=>resolverRadar(item,'ATENDIDO');
    c.querySelector('.descartar').onclick=()=>resolverRadar(item,'DESCARTAR');
    c.querySelector('.recordar').onclick=async()=>{const f=prompt('Recordar el día (AAAA-MM-DD):');if(f)resolverRadar(item,'POSPONER',{recordar:f})};
    c.querySelector('.vinc').onclick=async()=>{const f=prompt('Folio EWPL existente (ej. EWPL-0008):');if(f)resolverRadar(item,'VINCULAR',{folio:f})};
    c.querySelector('.crear').onclick=()=>crearDesdeRadar(item);
  });
}
async function resolverRadar(item,accion,extra={}){
  try{const r=await post('radarresolver',Object.assign({fila:item.fila,sourceId:item.sourceId,accion},extra));if(r.ok===false)throw new Error(r.error);aviso(r.mensaje||'Radar actualizado.');await cargarRadar();await cargarPizarron()}catch(e){aviso(e.message,true)}
}
async function crearDesdeRadar(item){
  const proyecto=prompt('Proyecto:',item.asunto||'')||''; if(!proyecto)return;
  const actividad=prompt('Actividad:',item.asunto||'')||''; if(!actividad)return;
  try{const r=await post('radarresolver',{fila:item.fila,sourceId:item.sourceId,accion:'CREAR',proyecto,actividad,responsable:'Eric Walberto Pérez López',prioridad:'Media',siguiente:'Atender asunto detectado por Radar EWPL.'});if(r.ok===false)throw new Error(r.error);aviso(r.mensaje||'Actividad creada.');await cargarRadar();await cargarPizarron()}catch(e){aviso(e.message,true)}
}
async function crearActividad(){
  const data={proyecto:q('#nProyecto').value.trim(),actividad:q('#nActividad').value.trim(),origen:'EWPL CAMPO',responsable:q('#nResponsable').value.trim()||'Eric Walberto Pérez López',prioridad:q('#nPrioridad').value,estado:'PENDIENTE',fechaCompromiso:q('#nFecha').value,proximoSeguimiento:q('#nSeguimiento').value,accion:q('#nAccion').value.trim(),esperandoDe:'',evidencia:'',nota:q('#nNota').value.trim()};
  if(!data.proyecto||!data.actividad)return aviso('Proyecto y actividad son obligatorios.',true);
  try{const r=await post('crear',data);if(r.ok===false)throw new Error(r.error);aviso('Actividad '+esc(r.folio||'')+' creada y verificada.');['nProyecto','nActividad','nFecha','nSeguimiento','nAccion','nNota'].forEach(id=>q('#'+id).value='');await cargarPizarron();tab('pizarron')}catch(e){aviso(e.message,true)}
}
qa('.navbtn').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
q('#buscar')?.addEventListener('input',pintarPizarron); q('#fEstado')?.addEventListener('change',pintarPizarron);
q('#refrescarPiz')?.addEventListener('click',cargarPizarron); q('#refrescarRadar')?.addEventListener('click',cargarRadar);
q('#crearActividad')?.addEventListener('click',crearActividad); q('#cerrarFicha')?.addEventListener('click',()=>q('#dlgFicha').close());
q('#guardarFicha')?.addEventListener('click',guardarFicha); q('#gestionFicha')?.addEventListener('click',registrarGestion);
window.addEventListener('online',()=>{aviso('Conexión recuperada.');if(!q('#view-pizarron')?.classList.contains('hidden'))cargarPizarron()});
window.addEventListener('offline',()=>aviso('Sin conexión: Pizarrón, fichas y Radar quedan pausados. Nota rápida sigue disponible.',true));
})();
