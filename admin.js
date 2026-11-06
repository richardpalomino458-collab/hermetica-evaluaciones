/* =====================================================================
   HERMÉTICA | admin.js — Panel del evaluador (admin.html)
   Toda escritura pasa por funciones RPC que verifican el rol en el
   servidor. Las lecturas directas están protegidas por RLS.
   ===================================================================== */
(function () {
  'use strict';
  const H = window.HDB;
  const { rpc, mensajeError, esc, fechaHora, fecha, duracion, num } = H;
  const sb = H.cliente;
  const $ = id => document.getElementById(id);
  const LETRAS = 'abcdefghij';
  const COL = { azul: '#1E4BCD', osc: '#052882', ok: '#16875A', mal: '#D9433B', anul: '#8C93A3', grid: '#E6EBF3', txt: '#43507A' };
  const TIPOS_INFRACCION = [
    ['cambio_pestana', 'Cambio de pestaña / aplicación / minimizar'],
    ['salida_pagina', 'Cierre o recarga de la página'],
    ['perdida_foco', 'Pérdida de foco de la ventana'],
    ['salida_pantalla_completa', 'Salida de pantalla completa'],
    ['copiar', 'Copiar'], ['pegar', 'Pegar'], ['cortar', 'Cortar'],
    ['tecla_restringida', 'Combinaciones de teclas restringidas'],
    ['imprimir', 'Imprimir'],
    ['ventana_reducida', 'Reducción de ventana / pantalla dividida'],
    ['menu_contextual', 'Menú contextual (clic derecho)'],
    ['monitor_extendido', 'Escritorio extendido (solo Chrome/Edge en PC)']
  ];
  const ESTADOS_PREG = { borrador: 'Borrador', pendiente_verificacion: 'Pendiente de verificación', aprobada: 'Aprobada' };

  const A = { perfil: null, vista: 'dashboard', evals: [], zonas: [], bancos: [], temas: [], graficos: {},
              bancoSel: null, preguntas: [], trabajadores: [], resultados: [] };

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  function toast(msg, tipo) {
    const t = document.createElement('div');
    t.className = 'toast ' + (tipo || '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }
  function err(e) { toast(mensajeError(e), 'error'); console.error(e); }
  function modal(html, clase) {
    const f = document.createElement('div');
    f.className = 'modal-fondo';
    f.innerHTML = `<div class="modal ${clase || ''}" role="dialog" aria-modal="true">${html}</div>`;
    $('modales').appendChild(f);
    f.cerrar = () => f.remove();
    f.q = s => f.querySelector(s);
    f.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', f.cerrar));
    return f;
  }
  function confirmar(titulo, texto, botón, clase) {
    return new Promise(res => {
      const m = modal(`<div class="modal-cab"><h2>${esc(titulo)}</h2></div><p>${texto}</p>
        <div class="modal-pie"><button class="btn sec" id="cNo">Cancelar</button>
        <button class="btn ${clase || ''}" id="cSi">${esc(botón || 'Confirmar')}</button></div>`);
      m.q('#cNo').onclick = () => { m.cerrar(); res(false); };
      m.q('#cSi').onclick = () => { m.cerrar(); res(true); };
    });
  }
  function pedirTexto(titulo, texto, etiqueta, botón, clase, valor) {
    return new Promise(res => {
      const m = modal(`<div class="modal-cab"><h2>${esc(titulo)}</h2></div><p>${texto}</p>
        <div class="campo"><label>${esc(etiqueta)}</label><textarea id="tTxt" maxlength="500">${esc(valor || '')}</textarea></div>
        <div class="modal-pie"><button class="btn sec" id="tNo">Cancelar</button>
        <button class="btn ${clase || ''}" id="tSi">${esc(botón || 'Aceptar')}</button></div>`);
      m.q('#tNo').onclick = () => { m.cerrar(); res(null); };
      m.q('#tSi').onclick = () => {
        const v = m.q('#tTxt').value.trim();
        if (v.length < 5) { toast('Escriba al menos 5 caracteres.', 'error'); return; }
        m.cerrar(); res(v);
      };
      setTimeout(() => m.q('#tTxt').focus(), 50);
    });
  }
  function opciones(lista, valor, vacio) {
    return (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
      lista.map(o => `<option value="${esc(o.id)}" ${String(o.id) === String(valor ?? '') ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('');
  }
  function badge(estado) {
    const t = ESTADOS_PREG[estado] || estado;
    return `<span class="badge ${esc(estado)}">${esc(String(t).toUpperCase())}</span>`;
  }
  // Fecha/hora Lima (UTC-5, sin horario de verano) <-> input datetime-local
  function aLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() - 5 * 3600 * 1000);
    return d.toISOString().slice(0, 16);
  }
  function deLocalInput(v) { return v ? v + ':00-05:00' : ''; }
  function norm(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  async function traerTodo(constructor) {
    const paso = 1000; let desde = 0; const todo = [];
    for (;;) {
      const { data, error } = await constructor().range(desde, desde + paso - 1);
      if (error) throw new Error(error.message);
      todo.push(...data);
      if (data.length < paso) return todo;
      desde += paso;
    }
  }
  async function sel(constructor) {
    const { data, error } = await constructor;
    if (error) throw new Error(error.message);
    return data;
  }
  function urlPublica(codigo) {
    const base = (A.config && A.config.url_publica) ||
      location.href.split('#')[0].split('?')[0].replace(/admin\.html$/, '');
    return base.replace(/\/?(index\.html)?$/, '/') + 'index.html?e=' + encodeURIComponent(codigo);
  }

  // ------------------------------------------------------------------
  // Acceso
  // ------------------------------------------------------------------
  function vista(v) { ['vLogin', 'vRecuperar', 'vPanel'].forEach(x => { $(x).hidden = x !== v; }); }

  async function arrancar() {
    if (!H.configurado || !sb) {
      vista('vLogin');
      $('msgLogin').innerHTML = '<div class="alerta error">El sistema aún no está configurado (config.js).</div>';
      $('btnLogin').disabled = true;
      return;
    }
    const esRecuperacion = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
    sb.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') vista('vRecuperar');
    });
    if (esRecuperacion) { vista('vRecuperar'); return; }
    const { data } = await sb.auth.getSession();
    if (data && data.session) await entrar();
    else vista('vLogin');
  }

  $('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    $('msgLogin').innerHTML = '';
    const b = $('btnLogin'); b.disabled = true; b.innerHTML = '<span class="cargando"></span> Ingresando…';
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('lEmail').value.trim(), password: $('lPass').value });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message);
      await entrar();
    } catch (x) {
      $('msgLogin').innerHTML = `<div class="alerta error">${esc(mensajeError(x))}</div>`;
    } finally { b.disabled = false; b.textContent = 'Ingresar'; }
  });

  $('btnOlvido').addEventListener('click', async () => {
    const email = $('lEmail').value.trim();
    if (!email) { $('msgLogin').innerHTML = '<div class="alerta info">Escriba su correo y vuelva a pulsar "¿Olvidó su contraseña?".</div>'; return; }
    const destino = location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: destino });
    $('msgLogin').innerHTML = error
      ? `<div class="alerta error">${esc(error.message)}</div>`
      : '<div class="alerta ok">Si el correo está registrado, recibirá un enlace para crear una nueva contraseña. Revise también la carpeta de spam.</div>';
  });

  $('formNueva').addEventListener('submit', async e => {
    e.preventDefault();
    const p1 = $('nPass').value, p2 = $('nPass2').value;
    if (p1.length < 10) { $('msgNueva').innerHTML = '<div class="alerta error">Use al menos 10 caracteres.</div>'; return; }
    if (p1 !== p2) { $('msgNueva').innerHTML = '<div class="alerta error">Las contraseñas no coinciden.</div>'; return; }
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { $('msgNueva').innerHTML = `<div class="alerta error">${esc(error.message)}</div>`; return; }
    history.replaceState(null, '', location.pathname);
    toast('Contraseña actualizada.', 'ok');
    await entrar();
  });

  $('btnSalir').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.href = location.pathname;
  });

  async function entrar() {
    let p;
    try { p = await rpc('adm_perfil'); } catch (e) { vista('vLogin'); err(e); return; }
    if (!p.es_admin) {
      await sb.auth.signOut();
      vista('vLogin');
      $('msgLogin').innerHTML = '<div class="alerta error">Su usuario no tiene permisos de evaluador. Solicite acceso al evaluador principal.</div>';
      return;
    }
    A.perfil = p;
    $('usuario').textContent = `${p.nombre || p.email} · ${p.rol === 'superadmin' ? 'Evaluador principal' : 'Evaluador'}`;
    $('btnSalir').hidden = false;
    $('mEvaluadores').hidden = p.rol !== 'superadmin';
    vista('vPanel');
    await cargarCatalogos();
    ir('dashboard');
  }

  async function cargarCatalogos() {
    try {
      [A.evals, A.zonas, A.bancos, A.temas, A.config] = await Promise.all([
        sel(sb.from('evaluaciones').select('*').order('orden').order('nombre')),
        sel(sb.from('zonas').select('*').order('orden').order('nombre')),
        sel(sb.from('bancos').select('*').order('nombre')),
        sel(sb.from('temas').select('*').order('orden').order('nombre')),
        sel(sb.from('config').select('*').eq('id', 1).maybeSingle())
      ]);
    } catch (e) { err(e); }
  }

  $('menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) ir(b.dataset.v);
  });
  // Evita que una vista que terminó de cargar tarde pise a la vista actual
  let navegacion = 0;
  const vigente = n => n === navegacion;
  function ir(v) {
    navegacion++;
    A.vista = v;
    document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('act', b.dataset.v === v));
    Object.values(A.graficos).forEach(g => g.destroy()); A.graficos = {};
    const f = { dashboard: vDashboard, resultados: vResultados, preguntas: vPreguntas, evaluaciones: vEvaluaciones,
                padron: vPadron, configuracion: vConfiguracion, evaluadores: vEvaluadores, auditoria: vAuditoria }[v];
    $('principal').innerHTML = '<div class="vacio"><span class="cargando az"></span></div>';
    f();
  }

  // ------------------------------------------------------------------
  // Filtros compartidos
  // ------------------------------------------------------------------
  function htmlFiltros(extra) {
    return `<form class="filtros" id="filtros">
      <div class="campo"><label>Evaluación</label><select name="ev">${opciones(A.evals, '', 'Todas')}</select></div>
      <div class="campo"><label>Zona</label><select name="zona">${opciones(A.zonas, '', 'Todas')}</select></div>
      ${extra || ''}
      <div class="campo"><label>Desde</label><input type="date" name="desde"></div>
      <div class="campo"><label>Hasta</label><input type="date" name="hasta"></div>
      <button class="btn" type="submit"><svg class="ico"><use href="#i-recargar"/></svg>Aplicar</button>
    </form>`;
  }
  function leerFiltros() {
    const f = new FormData($('filtros'));
    const v = k => (f.get(k) || '').toString().trim() || null;
    return {
      p_evaluacion: v('ev'), p_zona: v('zona') ? Number(v('zona')) : null,
      p_estado: v('estado'), p_texto: v('texto'), p_desde: v('desde'), p_hasta: v('hasta'),
      p_incluir_reiniciados: f.get('reiniciados') === 'on'
    };
  }

  // ------------------------------------------------------------------
  // DASHBOARD
  // ------------------------------------------------------------------
  function vDashboard() {
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Dashboard</h1></div>
      ${htmlFiltros()}
      <div class="kpis" id="kpis"></div>
      <div class="graficos">
        <div class="tarjeta"><h3>Aprobación</h3><p class="small muted">Intentos finalizados y anulados</p><div class="lienzo"><canvas id="gAprob"></canvas></div></div>
        <div class="tarjeta"><h3>Resultados por zona</h3><p class="small muted">Número de intentos por estado</p><div class="lienzo"><canvas id="gZona"></canvas></div></div>
        <div class="tarjeta"><h3>Promedio por tema</h3><p class="small muted">% de respuestas correctas (excluye anulados)</p><div class="lienzo"><canvas id="gTema"></canvas></div></div>
        <div class="tarjeta"><h3>Evolución mensual</h3><p class="small muted">Promedio en escala 0–20 (excluye anulados)</p><div class="lienzo"><canvas id="gMes"></canvas></div></div>
        <div class="tarjeta span2"><h3>Preguntas más falladas</h3><p class="small muted">Top 10 por número de errores</p><div class="lienzo" style="height:340px"><canvas id="gFall"></canvas></div>
          <div class="tabla-wrap mt"><table id="tFall"></table></div></div>
      </div></section>`;
    $('filtros').addEventListener('submit', e => { e.preventDefault(); cargarDashboard(); });
    cargarDashboard();
  }

  async function cargarDashboard() {
    const f = leerFiltros(), n = navegacion;
    let d;
    try {
      d = await rpc('adm_dashboard', { p_evaluacion: f.p_evaluacion, p_zona: f.p_zona, p_desde: f.p_desde, p_hasta: f.p_hasta });
    } catch (e) { err(e); return; }
    if (!vigente(n)) return;
    const t = d.tarjetas;
    const prom = t.mismo_maximo && t.puntaje_maximo
      ? `${num(t.promedio)}<small style="font-size:1rem"> / ${num(t.puntaje_maximo)}</small>`
      : `${num(t.promedio20)}<small style="font-size:1rem"> / 20</small>`;
    $('kpis').innerHTML = `
      <div class="kpi"><span>Técnicos evaluados</span><b>${t.evaluados}</b><small>${t.intentos} intentos</small></div>
      <div class="kpi"><span><i class="punto" style="background:${COL.ok}"></i>Aprobados</span><b>${t.aprobados}</b><small>${t.pct_aprobacion ?? 0}% de finalizados</small></div>
      <div class="kpi"><span><i class="punto" style="background:${COL.mal}"></i>Desaprobados</span><b>${t.desaprobados}</b><small>&nbsp;</small></div>
      <div class="kpi"><span><i class="punto" style="background:${COL.anul}"></i>Anulados</span><b>${t.anulados}</b><small>&nbsp;</small></div>
      <div class="kpi"><span>Promedio general</span><b>${t.promedio20 == null ? '—' : prom}</b><small>Excluye anulados${t.mismo_maximo ? '' : ' · escala 20'}</small></div>
      <div class="kpi"><span>En curso</span><b>${t.en_curso}</b><small>ahora</small></div>`;

    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.color = COL.txt;
    const graf = (id, cfg) => {
      if (A.graficos[id]) A.graficos[id].destroy();
      A.graficos[id] = new Chart($(id), cfg);
    };
    const ejes = (extra) => Object.assign({
      x: { grid: { display: false }, border: { color: COL.grid } },
      y: { grid: { color: COL.grid }, border: { display: false }, beginAtZero: true, ticks: { precision: 0 } }
    }, extra || {});
    const leyenda = { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8 } };

    graf('gAprob', {
      type: 'doughnut',
      data: { labels: ['Aprobados', 'Desaprobados', 'Anulados'],
        datasets: [{ data: [t.aprobados, t.desaprobados, t.anulados], backgroundColor: [COL.ok, COL.mal, COL.anul],
                     borderColor: '#fff', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: leyenda,
        tooltip: { callbacks: { label: c => {
          const tot = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
          return ` ${c.label}: ${c.raw} (${(100 * c.raw / tot).toFixed(1)}%)`; } } } } }
    });
    const z = d.por_zona;
    graf('gZona', {
      type: 'bar',
      data: { labels: z.map(x => x.zona), datasets: [
        { label: 'Aprobados', data: z.map(x => x.aprobados), backgroundColor: COL.ok },
        { label: 'Desaprobados', data: z.map(x => x.desaprobados), backgroundColor: COL.mal },
        { label: 'Anulados', data: z.map(x => x.anulados), backgroundColor: COL.anul }
      ].map(ds => Object.assign(ds, { borderColor: '#fff', borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 46 })) },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: COL.grid }, border: { display: false }, ticks: { precision: 0 } } },
        plugins: { legend: leyenda, tooltip: { mode: 'index', intersect: false,
          callbacks: { footer: it => { const r = z[it[0].dataIndex]; return r.promedio20 != null ? `Promedio: ${r.promedio20} / 20` : ''; } } } } }
    });
    const tm = d.por_tema;
    graf('gTema', {
      type: 'bar',
      data: { labels: tm.map(x => x.tema.length > 34 ? x.tema.slice(0, 32) + '…' : x.tema),
        datasets: [{ label: '% correctas', data: tm.map(x => x.pct), backgroundColor: COL.azul, borderRadius: 4, maxBarThickness: 26 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false,
        scales: { x: { min: 0, max: 100, grid: { color: COL.grid }, border: { display: false }, ticks: { callback: v => v + '%' } },
                  y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: it => tm[it[0].dataIndex].tema,
          label: c => ` ${c.raw}% correctas (${tm[c.dataIndex].correctas} de ${tm[c.dataIndex].respuestas})`,
          footer: it => `Equivale a ${tm[it[0].dataIndex].promedio20} / 20` } } } }
    });
    const ms = d.mensual;
    graf('gMes', {
      type: 'line',
      data: { labels: ms.map(x => x.mes),
        datasets: [{ label: 'Promedio (0–20)', data: ms.map(x => x.promedio20), borderColor: COL.azul, backgroundColor: COL.azul,
                     borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.25 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: ejes({ y: { min: 0, max: 20, grid: { color: COL.grid }, border: { display: false } } }),
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: c => ` Promedio: ${c.raw ?? '—'} / 20`,
          afterLabel: c => [`Aprobación: ${ms[c.dataIndex].pct_aprobacion ?? 0}%`, `Evaluados: ${ms[c.dataIndex].evaluados}`,
                            `Anulados: ${ms[c.dataIndex].anulados}`] } } } }
    });
    const fl = d.mas_falladas;
    graf('gFall', {
      type: 'bar',
      data: { labels: fl.map(x => (x.enunciado.length > 48 ? x.enunciado.slice(0, 46) + '…' : x.enunciado)),
        datasets: [{ label: 'Errores', data: fl.map(x => x.errores), backgroundColor: COL.osc, borderRadius: 4, maxBarThickness: 22 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, grid: { color: COL.grid }, border: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: it => fl[it[0].dataIndex].enunciado,
          label: c => ` ${fl[c.dataIndex].errores} errores de ${fl[c.dataIndex].veces} (${fl[c.dataIndex].pct_error}%)`,
          footer: it => 'Tema: ' + (fl[it[0].dataIndex].tema || '—') } } } }
    });
    $('tFall').innerHTML = `<thead><tr><th>#</th><th>Pregunta</th><th>Tema</th><th class="num">Veces</th><th class="num">Errores</th><th class="num">% error</th></tr></thead><tbody>` +
      (fl.length ? fl.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.enunciado)}</td><td>${esc(x.tema || '')}</td><td class="num">${x.veces}</td><td class="num">${x.errores}</td><td class="num">${x.pct_error}%</td></tr>`).join('')
        : '<tr><td colspan="6" class="vacio">Sin datos</td></tr>') + '</tbody>';
  }

  // ------------------------------------------------------------------
  // RESULTADOS
  // ------------------------------------------------------------------
  function vResultados() {
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Resultados</h1>
        <div class="row"><button class="btn peligro" id="btnEliminarSel" hidden>Eliminar seleccionados</button>
          <button class="btn" id="btnExportar"><svg class="ico"><use href="#i-excel"/></svg>Exportar Excel</button></div></div>
      ${htmlFiltros(`
        <div class="campo"><label>Estado</label><select name="estado"><option value="">Todos</option>
          <option>APROBADO</option><option>DESAPROBADO</option><option>ANULADO</option><option value="EN_CURSO">EN CURSO</option><option>REINICIADO</option></select></div>
        <div class="campo"><label>Trabajador / DNI / N.° envío</label><input name="texto" placeholder="Buscar…"></div>
        <div class="campo" style="flex:0 0 auto;min-width:0"><label>&nbsp;</label><label class="check"><input type="checkbox" name="reiniciados">Incluir reiniciados</label></div>`)}
      <p class="small muted" id="resCont"></p>
      <div class="tabla-wrap"><table id="tRes"></table></div></section>`;
    $('filtros').addEventListener('submit', e => { e.preventDefault(); cargarResultados(); });
    $('btnExportar').addEventListener('click', exportarResultados);
    $('btnEliminarSel').addEventListener('click', () => {
      const ids = [...document.querySelectorAll('.rChk:checked')].map(c => c.value);
      if (ids.length) eliminarExamenes(ids, `${ids.length} examen(es) seleccionado(s)`);
    });
    cargarResultados();
  }

  async function cargarResultados() {
    const n = navegacion;
    try { A.resultados = await rpc('adm_resultados', leerFiltros()); } catch (e) { err(e); return; }
    if (!vigente(n)) return;
    const r = A.resultados;
    $('resCont').textContent = `${r.length} registro(s). Haga clic en una fila para ver el detalle.`;
    const sa = esSuper();
    $('tRes').innerHTML = `<thead><tr>${sa ? '<th><input type="checkbox" id="rTodos" title="Seleccionar todos"></th>' : ''}<th>N.° envío</th><th>Nombre</th><th>DNI</th><th>Zona</th><th>Evaluación</th><th>Fecha</th>
      <th class="num">Nota</th><th>Estado</th><th class="num">Salidas</th><th class="num">Infracciones</th><th>Tiempo</th></tr></thead><tbody>` +
      (r.length ? r.map(x => `<tr class="clic" data-id="${x.id}">
        ${sa ? `<td><input type="checkbox" class="rChk" value="${x.id}"></td>` : ''}<td>${esc(x.numero_envio)}</td><td>${esc(x.nombre)}</td><td>${esc(x.dni)}</td><td>${esc(x.zona || '')}</td>
        <td>${esc(x.evaluacion)}</td><td>${fechaHora(x.inicio)}</td>
        <td class="num">${x.nota == null ? '—' : `<b>${num(x.nota)}</b> / ${num(x.puntaje_maximo)}`}</td>
        <td><span class="badge ${esc(x.estado)}">${esc(x.estado)}</span></td>
        <td class="num">${x.salidas}</td><td class="num">${x.infracciones}</td><td>${duracion(x.tiempo_segundos)}</td></tr>`).join('')
        : `<tr><td colspan="${sa ? 12 : 11}" class="vacio">No hay resultados con estos filtros.</td></tr>`) + '</tbody>';
    $('tRes').querySelectorAll('tr.clic').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('input')) return;
      verDetalle(tr.dataset.id);
    }));
    const contarSel = () => {
      const n = document.querySelectorAll('.rChk:checked').length;
      $('btnEliminarSel').hidden = !n;
      $('btnEliminarSel').textContent = `Eliminar seleccionados (${n})`;
    };
    if (sa) {
      $('rTodos').onchange = () => { document.querySelectorAll('.rChk').forEach(c => { c.checked = $('rTodos').checked; }); contarSel(); };
      document.querySelectorAll('.rChk').forEach(c => c.addEventListener('change', contarSel));
    }
    contarSel();
  }

  async function verDetalle(id) {
    let d;
    try { d = await rpc('adm_detalle', { p_intento: id }); } catch (e) { err(e); return; }
    const i = d.intento;
    const preg = d.preguntas.map(p => {
      const alts = p.alternativas.map((a, j) => {
        const elegida = a.k === p.respuesta, correcta = a.k === p.clave_correcta;
        return `<div class="det-alt ${correcta ? 'correcta' : (elegida ? 'elegida-mal' : '')}">
          <b>${LETRAS[j]})</b> ${esc(a.t)} ${correcta ? ' <b style="color:#16875A">✓ Correcta</b>' : ''}${elegida ? ' <b>← Marcada</b>' : ''}</div>`;
      }).join('');
      return `<div class="tarjeta" style="padding:14px;margin-top:10px">
        <div class="row between"><b>${p.orden}. ${esc(p.enunciado)}</b>
          <span class="badge ${p.es_correcta ? 'APROBADO' : 'DESAPROBADO'}">${p.respuesta ? (p.es_correcta ? 'CORRECTA' : 'INCORRECTA') : 'SIN RESPONDER'}</span></div>
        <div class="small muted">${esc(p.tema || '')}${p.respondida_en ? ' · respondida ' + fechaHora(p.respondida_en) : ''}</div>${alts}</div>`;
    }).join('');
    const eventos = d.eventos.map(e => `<div class="evento ${e.es_infraccion ? 'infr' : ''}">
      <span class="t">${new Date(e.creado_en).toLocaleTimeString('es-PE', { timeZone: 'America/Lima' })}</span>
      <div><b>${esc(e.tipo.replace(/_/g, ' '))}</b>${e.es_infraccion ? (e.contabilizada ? ' · infracción contabilizada' : ' · mismo incidente') : ''}
      ${e.detalle ? `<div class="small muted">${esc(e.detalle)}</div>` : ''}</div></div>`).join('');
    const m = modal(`
      <div class="modal-cab"><h2>Detalle ${esc(i.numero_envio)}</h2><button class="btn sec mini cerrar" data-cerrar>Cerrar</button></div>
      <div class="row between">
        <div><b style="font-size:1.1rem">${esc(i.nombre)}</b><div class="small muted">DNI ${esc(i.dni)} · ${esc(i.zona_nombre || '')} · ${esc(i.evaluacion_nombre)}</div>
        ${i.nombre_ingresado && norm(i.nombre_ingresado) !== norm(i.nombre) ? `<div class="small">Nombre ingresado: ${esc(i.nombre_ingresado)}</div>` : ''}</div>
        <span class="badge ${esc(i.estado_label)}">${esc(i.estado_label)}</span></div>
      <div class="datos-res">
        <div><span>Nota</span><b>${i.puntaje == null ? '—' : num(i.puntaje) + ' / ' + num(i.puntaje_maximo)}</b></div>
        <div><span>Correctas</span><b>${i.correctas ?? '—'} de ${i.total_preguntas}</b></div>
        <div><span>Mínimo aprobatorio</span><b>${num(i.puntaje_minimo)}</b></div>
        <div><span>Inicio</span><b>${fechaHora(i.inicio)}</b></div>
        <div><span>Tiempo empleado</span><b>${duracion(i.tiempo_segundos)}</b></div>
        <div><span>Fin</span><b>${esc(i.modo_fin || '—')}</b></div>
        <div><span>Infracciones</span><b>${i.infracciones} (tolera ${i.infracciones_permitidas})</b></div>
        <div><span>Salidas</span><b>${i.salidas}</b></div>
        <div><span>Intento N.°</span><b>${i.nro_intento}</b></div>
      </div>
      ${i.motivo_anulacion ? `<div class="alerta error mt"><div><b>Motivo de anulación:</b> ${esc(i.motivo_anulacion)}<br><span class="small">${fechaHora(i.anulado_en)}</span></div></div>` : ''}
      ${i.invalidado ? `<div class="alerta info mt"><div><b>Intento reiniciado:</b> ${esc(i.invalidado_motivo)} (${fechaHora(i.invalidado_en)})</div></div>` : ''}
      <div class="row mt">
        ${i.estado !== 'anulado' ? '<button class="btn peligro mini" id="dAnular">Anular examen</button>' : ''}
        ${!i.invalidado ? '<button class="btn sec mini" id="dReiniciar">Autorizar nuevo intento (reiniciar)</button>' : ''}
        ${esSuper() ? '<button class="btn sec mini" id="dEliminar" style="color:#B5322B">Eliminar examen</button>' : ''}
      </div>
      <div class="pestanas mt2"><button class="act" data-p="temas">Resultados por tema</button><button data-p="preg">Preguntas</button><button data-p="ev">Eventos (${d.eventos.length})</button></div>
      <div data-panel="temas"><div class="tabla-wrap"><table><thead><tr><th>Tema</th><th class="num">Preguntas</th><th class="num">Correctas</th><th class="num">%</th></tr></thead><tbody>
        ${d.por_tema.map(t => `<tr><td>${esc(t.tema)}</td><td class="num">${t.total}</td><td class="num">${t.correctas}</td><td class="num">${t.pct ?? 0}%</td></tr>`).join('')}</tbody></table></div></div>
      <div data-panel="preg" hidden>${preg}</div>
      <div data-panel="ev" hidden>${eventos || '<p class="muted">Sin eventos.</p>'}
        <p class="small muted mt">Limitaciones: el navegador no puede detectar un segundo celular, capturas de pantalla, ayuda de otra persona ni todos los paneles laterales. Los eventos son indicios, no pruebas concluyentes.</p></div>`, 'ancho');
    m.querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => {
      m.querySelectorAll('.pestanas button').forEach(x => x.classList.toggle('act', x === b));
      m.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.p; });
    }));
    const an = m.q('#dAnular');
    if (an) an.onclick = async () => {
      const motivo = await pedirTexto('Anular examen', 'El examen quedará ANULADO y no contará como aprobado ni desaprobado. Esta acción queda en auditoría.', 'Motivo de la anulación', 'Anular', 'peligro');
      if (!motivo) return;
      try { await rpc('adm_anular_intento', { p_intento: id, p_motivo: motivo }); toast('Examen anulado.', 'ok'); m.cerrar(); cargarResultados(); }
      catch (e) { err(e); }
    };
    const el = m.q('#dEliminar');
    if (el) el.onclick = () => { m.cerrar(); eliminarExamenes([id], `el examen ${i.numero_envio} de ${i.nombre}`); };
    const re = m.q('#dReiniciar');
    if (re) re.onclick = async () => {
      const motivo = await pedirTexto('Autorizar nuevo intento',
        'El intento actual se conservará en el historial como REINICIADO y el trabajador podrá volver a rendir la evaluación.',
        'Motivo de la autorización', 'Autorizar');
      if (!motivo) return;
      try { await rpc('adm_reiniciar_intento', { p_intento: id, p_motivo: motivo }); toast('Nuevo intento autorizado.', 'ok'); m.cerrar(); cargarResultados(); }
      catch (e) { err(e); }
    };
  }

  function esSuper() { return !!(A.perfil && A.perfil.rol === 'superadmin'); }

  function eliminarExamenes(ids, etiqueta) {
    const m = modal(`<div class="modal-cab"><h2>Eliminar exámenes</h2></div>
      <div class="alerta error"><div>Se eliminará <b>${esc(etiqueta)}</b> con sus respuestas y eventos. <b>No se puede deshacer.</b>
        El DNI podrá volver a rendir. Queda constancia en Auditoría.<br>
        <span class="small">Si es un técnico real y solo quiere darle otra oportunidad, use "Reiniciar": conserva el historial.</span></div></div>
      <div class="campo mt"><label>Motivo</label><textarea id="eMot" maxlength="300" placeholder="Ej.: examen de prueba del sistema"></textarea></div>
      <div class="campo mt"><label>Escriba <b>ELIMINAR</b> para confirmar</label><input id="eConf" autocomplete="off"></div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn peligro" id="eOk">Eliminar definitivamente</button></div>`);
    m.q('#eOk').onclick = async () => {
      const motivo = m.q('#eMot').value.trim();
      if (motivo.length < 5) { toast('Escriba el motivo (mínimo 5 caracteres).', 'error'); return; }
      if (m.q('#eConf').value.trim().toUpperCase() !== 'ELIMINAR') { toast('Escriba ELIMINAR para confirmar.', 'error'); return; }
      try {
        const r = await rpc('adm_eliminar_intentos', { p_ids: ids, p_motivo: motivo });
        m.cerrar(); toast(`${r.eliminados} examen(es) eliminado(s).`, 'ok'); cargarResultados();
      } catch (e) { err(e); }
    };
  }

  // ------------------------------------------------------------------
  // EXCEL (xlsx-js-style)
  // ------------------------------------------------------------------
  const BORDE = { style: 'thin', color: { rgb: 'D0D7E2' } };
  const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };
  const COLOR_ESTADO = {
    APROBADO: { fill: 'E3F4EC', font: '0E6B46' }, DESAPROBADO: { fill: 'FCE9E7', font: 'A12A23' },
    ANULADO: { fill: 'ECEEF2', font: '3A4152' }, REINICIADO: { fill: 'ECEEF2', font: '3A4152' },
    'EN CURSO': { fill: 'E8EEFC', font: '052882' }, CORRECTA: { fill: 'E3F4EC', font: '0E6B46' },
    INCORRECTA: { fill: 'FCE9E7', font: 'A12A23' }, 'SIN RESPONDER': { fill: 'FFF4DC', font: '8A5A00' }
  };
  function hoja(columnas, filas, colEstado) {
    const aoa = [columnas.map(c => c.h), ...filas];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const rango = XLSX.utils.decode_range(ws['!ref']);
    for (let R = rango.s.r; R <= rango.e.r; R++) {
      for (let C = rango.s.c; C <= rango.e.c; C++) {
        const ref = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        const cel = ws[ref];
        if (R === 0) {
          cel.s = { font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri', sz: 11 },
                    fill: { fgColor: { rgb: '1E4BCD' } }, alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border: BORDES };
        } else {
          const par = R % 2 === 0;
          cel.s = { font: { name: 'Calibri', sz: 10, color: { rgb: '0F1B3D' } },
                    fill: { fgColor: { rgb: par ? 'F4F7FB' : 'FFFFFF' } },
                    alignment: { vertical: 'top', wrapText: !!columnas[C].wrap }, border: BORDES };
          if (columnas[C].fmt) cel.z = columnas[C].fmt;
          const est = COLOR_ESTADO[String(cel.v)];
          if (colEstado !== undefined && (C === colEstado || (Array.isArray(colEstado) && colEstado.includes(C))) && est) {
            cel.s.fill = { fgColor: { rgb: est.fill } };
            cel.s.font = { name: 'Calibri', sz: 10, bold: true, color: { rgb: est.font } };
            cel.s.alignment = { horizontal: 'center', vertical: 'top' };
          }
        }
      }
    }
    ws['!cols'] = columnas.map((c, i) => {
      if (c.w) return { wch: c.w };
      const max = Math.max(String(c.h).length, ...filas.slice(0, 300).map(f => String(f[i] ?? '').length));
      return { wch: Math.min(Math.max(max + 2, 8), 60) };
    });
    ws['!rows'] = [{ hpt: 30 }];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1), c: columnas.length - 1 } }) };
    return ws;
  }
  function libro(hojas, nombre) {
    const wb = XLSX.utils.book_new();
    hojas.forEach(([n, ws]) => XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31)));
    XLSX.writeFile(wb, nombre);
  }
  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const fechaXls = v => v ? new Date(v).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }) : '';

  async function exportarResultados() {
    const f = leerFiltros();
    let x;
    try {
      x = await rpc('adm_exportar', { p_evaluacion: f.p_evaluacion, p_zona: f.p_zona, p_estado: f.p_estado,
        p_texto: f.p_texto, p_desde: f.p_desde, p_hasta: f.p_hasta });
    } catch (e) { err(e); return; }
    const res = hoja([
      { h: 'N.° envío' }, { h: 'Nombre' }, { h: 'DNI' }, { h: 'Zona' }, { h: 'Evaluación', w: 40 }, { h: 'Inicio' }, { h: 'Fin' },
      { h: 'Nota', fmt: '0.00' }, { h: 'Puntaje máximo' }, { h: 'Puntaje mínimo' }, { h: 'Correctas' }, { h: 'Total preguntas' },
      { h: 'Estado' }, { h: 'Salidas' }, { h: 'Infracciones' }, { h: 'Tiempo (min)', fmt: '0.0' }, { h: 'Forma de fin' },
      { h: 'Motivo de anulación', w: 50, wrap: true }],
      x.resultados.map(r => [r.numero_envio, r.nombre, r.dni, r.zona || '', r.evaluacion, fechaXls(r.inicio), fechaXls(r.fin),
        r.nota == null ? '' : Number(r.nota), Number(r.puntaje_maximo), Number(r.puntaje_minimo), r.correctas ?? '', r.total,
        r.estado, r.salidas, r.infracciones, r.tiempo_segundos == null ? '' : Math.round(r.tiempo_segundos / 6) / 10,
        r.modo_fin || '', r.motivo_anulacion || '']), 12);
    const det = hoja([
      { h: 'N.° envío' }, { h: 'Nombre' }, { h: 'DNI' }, { h: 'Zona' }, { h: 'Evaluación', w: 34 }, { h: 'Estado del examen' },
      { h: 'N.°' }, { h: 'Tema', w: 30 }, { h: 'Pregunta', w: 60, wrap: true }, { h: 'Respuesta marcada', w: 40, wrap: true },
      { h: 'Respuesta correcta', w: 40, wrap: true }, { h: 'Resultado' }, { h: 'Puntos', fmt: '0.00' }],
      x.detalle.map(r => [r.numero_envio, r.nombre, r.dni, r.zona || '', r.evaluacion, r.estado, r.orden, r.tema || '',
        r.pregunta, r.respuesta || '', r.correcta || '',
        r.respuesta ? (r.es_correcta ? 'CORRECTA' : 'INCORRECTA') : 'SIN RESPONDER', r.puntos == null ? '' : Number(r.puntos)]), [5, 11]);
    const tem = hoja([
      { h: 'N.° envío' }, { h: 'Nombre' }, { h: 'DNI' }, { h: 'Zona' }, { h: 'Evaluación', w: 34 }, { h: 'Estado' },
      { h: 'Tema', w: 40 }, { h: 'Preguntas' }, { h: 'Correctas' }, { h: '% acierto', fmt: '0.0' }],
      x.por_tema.map(r => [r.numero_envio, r.nombre, r.dni, r.zona || '', r.evaluacion, r.estado, r.tema, r.preguntas, r.correctas,
        r.pct == null ? '' : Number(r.pct)]), 5);
    const fal = hoja([
      { h: '#' }, { h: 'Pregunta', w: 70, wrap: true }, { h: 'Tema', w: 34 }, { h: 'Evaluación', w: 34 }, { h: 'Veces evaluada' },
      { h: 'Errores' }, { h: '% error', fmt: '0.0' }],
      x.mas_falladas.map((r, i) => [i + 1, r.pregunta, r.tema || '', r.evaluacion || '', r.veces, r.errores, r.pct_error == null ? '' : Number(r.pct_error)]));
    libro([['RESULTADOS', res], ['DETALLE POR PREGUNTA', det], ['RESULTADOS POR TEMA', tem], ['PREGUNTAS MÁS FALLADAS', fal]],
      `Hermetica_Resultados_${hoy()}.xlsx`);
    toast('Excel generado.', 'ok');
  }

  // Lectura de Excel -> filas de objetos según encabezados
  function leerExcel(archivo, mapa) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error('No se pudo leer el archivo.'));
      r.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(r.result), { type: 'array', cellDates: true });
          const nombreHoja = wb.SheetNames.find(n => /pregunta|padron|padrón|trabajador|importa/i.test(n)) || wb.SheetNames[0];
          const ws = wb.Sheets[nombreHoja];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
          const iCab = aoa.findIndex(f => f.some(c => mapa[norm(c)]));
          if (iCab < 0) throw new Error('No se encontraron los encabezados esperados. Use la plantilla.');
          const cab = aoa[iCab].map(c => mapa[norm(c)] || null);
          const filas = [];
          for (let i = iCab + 1; i < aoa.length; i++) {
            const f = aoa[i];
            if (!f.some(c => String(c).trim() !== '')) continue;
            const o = { fila: i + 1, _avisos: [] };
            cab.forEach((k, j) => {
              if (!k) return;
              let v = f[j];
              if (v instanceof Date) v = new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
              if (k === 'dni' && typeof v === 'number') {
                v = String(Math.round(v));
                if (v.length < 8) { o._avisos.push(`DNI ${v} completado con ceros a la izquierda`); v = v.padStart(8, '0'); }
              }
              o[k] = typeof v === 'string' ? v.trim() : String(v);
            });
            filas.push(o);
          }
          res({ filas, hoja: nombreHoja });
        } catch (e) { rej(e); }
      };
      r.readAsArrayBuffer(archivo);
    });
  }
  const MAPA_PREG = {
    'tema': 'tema', 'categoria': 'categoria', 'pregunta': 'pregunta', 'correcta': 'correcta', 'respuesta correcta': 'correcta',
    'incorrecta 1': 'incorrecta1', 'incorrecta 2': 'incorrecta2', 'incorrecta 3': 'incorrecta3',
    'explicacion': 'explicacion', 'activa': 'activa', 'documento de referencia': 'documento', 'documento': 'documento',
    'fecha de capacitacion': 'fecha', 'fecha': 'fecha', 'posicion correcta': 'posicion_correcta', 'estado': 'estado'
  };
  const MAPA_PADRON = { 'dni': 'dni', 'nombre completo': 'nombre', 'nombre': 'nombre', 'zona': 'zona', 'cargo': 'cargo', 'activo': 'activo' };
  const COLS_PLANTILLA = [
    { h: 'Tema', w: 34 }, { h: 'Categoría', w: 20 }, { h: 'Pregunta', w: 60, wrap: true }, { h: 'Correcta', w: 36, wrap: true },
    { h: 'Incorrecta 1', w: 30, wrap: true }, { h: 'Incorrecta 2', w: 30, wrap: true }, { h: 'Incorrecta 3', w: 30, wrap: true },
    { h: 'Explicación', w: 40, wrap: true }, { h: 'Activa', w: 9 }, { h: 'Documento de referencia', w: 30 },
    { h: 'Fecha de capacitación', w: 14 }, { h: 'Posición correcta (orden fijo)', w: 14 }, { h: 'Estado', w: 22 }];

  // ------------------------------------------------------------------
  // BANCOS Y PREGUNTAS
  // ------------------------------------------------------------------
  function vPreguntas() {
    if (!A.bancoSel || !A.bancos.find(b => b.id === A.bancoSel)) A.bancoSel = A.bancos[0] && A.bancos[0].id;
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Bancos y preguntas</h1></div>
      <div class="filtros">
        <div class="campo" style="flex:3 1 260px"><label>Banco de preguntas</label><select id="selBanco">${opciones(A.bancos, A.bancoSel)}</select></div>
        <button class="btn sec" id="bNuevo"><svg class="ico"><use href="#i-mas"/></svg>Nuevo banco</button>
        <button class="btn sec" id="bEditar">Editar</button>
        <button class="btn sec" id="bCopiar">Copiar</button>
        <button class="btn sec" id="bEliminar">Eliminar</button>
      </div>
      <div class="pestanas"><button class="act" data-p="preg">Preguntas</button><button data-p="temas">Temas</button></div>
      <div id="panelBanco"></div></section>`;
    $('selBanco').onchange = () => { A.bancoSel = $('selBanco').value; panelPreguntas(); };
    $('bNuevo').onclick = () => editarBanco(null);
    $('bEditar').onclick = () => editarBanco(A.bancos.find(b => b.id === A.bancoSel));
    $('bCopiar').onclick = async () => {
      const b = A.bancos.find(x => x.id === A.bancoSel); if (!b) return;
      const n = await pedirTexto('Copiar banco', `Se copiarán los temas, preguntas y alternativas de <b>${esc(b.nombre)}</b>.`, 'Nombre del nuevo banco', 'Copiar', '', b.nombre + ' (copia)');
      if (!n) return;
      try { A.bancoSel = await rpc('adm_copiar_banco', { p_id: b.id, p_nuevo_nombre: n }); await cargarCatalogos(); vPreguntas(); toast('Banco copiado.', 'ok'); } catch (e) { err(e); }
    };
    $('bEliminar').onclick = async () => {
      const b = A.bancos.find(x => x.id === A.bancoSel); if (!b) return;
      if (!await confirmar('Eliminar banco', `¿Eliminar <b>${esc(b.nombre)}</b> con todos sus temas y preguntas? Los resultados históricos conservarán su copia de las preguntas.`, 'Eliminar', 'peligro')) return;
      try { await rpc('adm_eliminar_banco', { p_id: b.id }); A.bancoSel = null; await cargarCatalogos(); vPreguntas(); toast('Banco eliminado.', 'ok'); } catch (e) { err(e); }
    };
    document.querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.pestanas button').forEach(x => x.classList.toggle('act', x === b));
      b.dataset.p === 'preg' ? panelPreguntas() : panelTemas();
    }));
    panelPreguntas();
  }

  function editarBanco(b) {
    const m = modal(`<div class="modal-cab"><h2>${b ? 'Editar banco' : 'Nuevo banco'}</h2></div>
      <div class="campo"><label>Nombre</label><input id="bNom" value="${esc(b ? b.nombre : '')}"></div>
      <div class="campo mt"><label>Descripción</label><textarea id="bDes">${esc(b ? b.descripcion || '' : '')}</textarea></div>
      <label class="check mt"><input type="checkbox" id="bAct" ${!b || b.activo ? 'checked' : ''}>Activo</label>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="bOk">Guardar</button></div>`);
    m.q('#bOk').onclick = async () => {
      try {
        A.bancoSel = await rpc('adm_guardar_banco', { p_id: b ? b.id : null, p_nombre: m.q('#bNom').value, p_descripcion: m.q('#bDes').value || null, p_activo: m.q('#bAct').checked });
        m.cerrar(); await cargarCatalogos(); vPreguntas(); toast('Banco guardado.', 'ok');
      } catch (e) { err(e); }
    };
  }

  function temasDe(banco) { return A.temas.filter(t => t.banco_id === banco); }

  async function panelPreguntas() {
    const p = $('panelBanco'), n = navegacion, banco = A.bancoSel;
    if (!A.bancoSel) { p.innerHTML = '<div class="vacio">Cree un banco de preguntas para comenzar.</div>'; return; }
    p.innerHTML = '<div class="vacio"><span class="cargando az"></span></div>';
    try {
      A.preguntas = await traerTodo(() => sb.from('preguntas').select('*, alternativas(*)').eq('banco_id', A.bancoSel)
        .order('orden').order('creado_en'));
    } catch (e) { err(e); return; }
    if (!vigente(n) || banco !== A.bancoSel || !document.body.contains(p)) return;
    const temas = temasDe(A.bancoSel);
    p.innerHTML = `
      <div class="filtros">
        <div class="campo"><label>Tema</label><select id="fTema">${opciones(temas, '', 'Todos')}</select></div>
        <div class="campo"><label>Estado</label><select id="fEst"><option value="">Todos</option>
          ${Object.entries(ESTADOS_PREG).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Activa</label><select id="fAct"><option value="">Todas</option><option value="1">Activas</option><option value="0">Inactivas</option></select></div>
        <div class="campo" style="flex:2 1 200px"><label>Buscar</label><input id="fTxt" placeholder="Texto de la pregunta o código"></div>
      </div>
      <div class="row mb">
        <button class="btn" id="pNueva"><svg class="ico"><use href="#i-mas"/></svg>Nueva pregunta</button>
        <button class="btn sec" id="pImportar"><svg class="ico"><use href="#i-subir"/></svg>Importar Excel</button>
        <button class="btn sec" id="pExportar"><svg class="ico"><use href="#i-excel"/></svg>Exportar Excel</button>
        <button class="btn sec" id="pPlantilla">Descargar plantilla</button>
        <span class="grow"></span>
        <span class="small muted" id="pSel">0 seleccionadas</span>
        <select id="pAccion" style="width:auto;min-height:40px"><option value="">Acción con seleccionadas…</option>
          <option value="aprobada">Aprobar (publicar)</option><option value="pendiente_verificacion">Marcar pendiente de verificación</option>
          <option value="borrador">Pasar a borrador</option><option value="activar">Activar</option><option value="desactivar">Desactivar</option>
          <option value="eliminar">Eliminar</option></select>
        <button class="btn sec mini" id="pAplicar">Aplicar</button>
      </div>
      <div class="alerta info mb small"><div>Solo las preguntas <b>aprobadas y activas</b> entran a los exámenes. Las preguntas oficiales (🔒) deben conservar su redacción literal.</div></div>
      <p class="small muted" id="pCont"></p>
      <div class="tabla-wrap"><table id="tPreg"></table></div>`;
    ['fTema', 'fEst', 'fAct'].forEach(i => $(i).onchange = pintarPreguntas);
    $('fTxt').oninput = pintarPreguntas;
    $('pNueva').onclick = () => editarPregunta(null);
    $('pImportar').onclick = importarPreguntas;
    $('pExportar').onclick = exportarBanco;
    $('pPlantilla').onclick = descargarPlantillaPreguntas;
    $('pAplicar').onclick = accionMasiva;
    pintarPreguntas();
  }

  function pintarPreguntas() {
    const t = $('fTema').value, e = $('fEst').value, a = $('fAct').value, q = norm($('fTxt').value);
    const temas = Object.fromEntries(A.preguntas.length ? temasDe(A.bancoSel).map(x => [x.id, x.nombre]) : []);
    const lista = A.preguntas.filter(p => (!t || p.tema_id === t) && (!e || p.estado === e) &&
      (!a || String(Number(p.activa)) === a) && (!q || norm(p.enunciado + ' ' + (p.codigo || '')).includes(q)));
    $('pCont').textContent = `${lista.length} de ${A.preguntas.length} preguntas · ` +
      `${A.preguntas.filter(p => p.estado === 'aprobada' && p.activa).length} disponibles para exámenes`;
    $('tPreg').innerHTML = `<thead><tr><th><input type="checkbox" id="pTodas"></th><th>Código</th><th>Tema</th><th>Pregunta</th>
      <th class="num">Alt.</th><th>Estado</th><th>Activa</th><th>Fecha cap.</th><th></th></tr></thead><tbody>` +
      (lista.length ? lista.map(p => `<tr>
        <td><input type="checkbox" class="pChk" value="${p.id}"></td>
        <td class="small">${p.es_oficial ? '🔒 ' : ''}${esc(p.codigo || '')}</td>
        <td class="small">${esc(temas[p.tema_id] || '')}</td>
        <td>${esc(p.enunciado)}${p.nota_verificacion ? `<div class="small" style="color:#8A5A00">${esc(p.nota_verificacion)}</div>` : ''}</td>
        <td class="num">${p.alternativas.length}</td><td>${badge(p.estado)}</td>
        <td>${p.activa ? '<span class="badge si">SÍ</span>' : '<span class="badge inactiva">NO</span>'}</td>
        <td class="small">${fecha(p.fecha_capacitacion)}</td>
        <td><button class="btn sec mini" data-ed="${p.id}">Editar</button></td></tr>`).join('')
        : '<tr><td colspan="9" class="vacio">No hay preguntas. Use "Nueva pregunta" o "Importar Excel".</td></tr>') + '</tbody>';
    $('tPreg').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editarPregunta(A.preguntas.find(p => p.id === b.dataset.ed)));
    const contar = () => { $('pSel').textContent = `${document.querySelectorAll('.pChk:checked').length} seleccionadas`; };
    $('pTodas').onchange = () => { document.querySelectorAll('.pChk').forEach(c => { c.checked = $('pTodas').checked; }); contar(); };
    document.querySelectorAll('.pChk').forEach(c => c.onchange = contar);
    contar();
  }

  async function accionMasiva() {
    const ids = [...document.querySelectorAll('.pChk:checked')].map(c => c.value);
    const acc = $('pAccion').value;
    if (!ids.length || !acc) { toast('Seleccione preguntas y una acción.', 'error'); return; }
    try {
      if (acc === 'eliminar') {
        if (!await confirmar('Eliminar preguntas', `¿Eliminar ${ids.length} pregunta(s)? Los resultados históricos conservan su copia. Si solo quiere retirarlas, use "Desactivar".`, 'Eliminar', 'peligro')) return;
        await rpc('adm_eliminar_preguntas', { p_ids: ids });
      } else if (acc === 'activar' || acc === 'desactivar') {
        await rpc('adm_activar_preguntas', { p_ids: ids, p_activa: acc === 'activar' });
      } else {
        if (acc === 'aprobada') {
          const pend = A.preguntas.filter(p => ids.includes(p.id) && p.nota_verificacion && p.estado !== 'aprobada');
          if (pend.length && !await confirmar('Verificación técnica', `${pend.length} pregunta(s) tienen una nota de verificación pendiente (por ejemplo, colores de recipientes). Confirme que las verificó contra el procedimiento de Hermética y la normativa aplicable.`, 'Ya verifiqué, aprobar')) return;
        }
        await rpc('adm_estado_preguntas', { p_ids: ids, p_estado: acc });
      }
      toast('Acción aplicada.', 'ok');
      panelPreguntas();
    } catch (e) { err(e); }
  }

  async function editarPregunta(p) {
    const temas = temasDe(A.bancoSel);
    if (!temas.length) { toast('Primero cree un tema en la pestaña "Temas".', 'error'); return; }
    const alts = p ? [...p.alternativas].sort((a, b) => a.orden - b.orden) : [{ texto: '', es_correcta: true }, { texto: '' }, { texto: '' }, { texto: '' }];
    let uso = '';
    if (p) {
      try {
        const u = await sel(sb.from('intento_preguntas').select('es_correcta').eq('pregunta_id', p.id).limit(5000));
        const ok = u.filter(x => x.es_correcta).length;
        uso = u.length ? `Usada en ${u.length} exámenes · ${Math.round(100 * ok / u.length)}% de acierto. Los exámenes ya rendidos conservan la versión original.` : 'Aún no se ha usado en exámenes.';
      } catch (e) { /* sin estadística */ }
    }
    const m = modal(`<div class="modal-cab"><h2>${p ? 'Editar pregunta' : 'Nueva pregunta'}</h2></div>
      ${p && p.es_oficial ? '<div class="alerta info mb"><div>🔒 Pregunta <b>oficial</b>: conserve la redacción literal, las alternativas y su orden.</div></div>' : ''}
      ${uso ? `<p class="small muted">${esc(uso)}</p>` : ''}
      <div class="campos">
        <div class="campo"><label>Tema</label><select id="eTema">${opciones(temas, p ? p.tema_id : temas[0].id)}</select></div>
        <div class="campo"><label>Categoría</label><input id="eCat" value="${esc(p ? p.categoria || '' : '')}"></div>
        <div class="campo full"><label>Pregunta</label><textarea id="eEnun">${esc(p ? p.enunciado : '')}</textarea></div>
        <div class="campo full"><label>Alternativas (marque la correcta)</label><div id="eAlts"></div>
          <button class="btn link" id="eMas" type="button">+ Agregar alternativa</button>
          <label class="check"><input type="checkbox" id="eFijo" ${p && p.orden_fijo ? 'checked' : ''}>Orden fijo (no mezclar las alternativas de esta pregunta)</label></div>
        <div class="campo full"><label>Explicación</label><textarea id="eExp">${esc(p ? p.explicacion || '' : '')}</textarea></div>
        <div class="campo"><label>Documento de referencia</label><input id="eDoc" value="${esc(p ? p.documento_ref || '' : '')}"></div>
        <div class="campo"><label>Fecha de capacitación</label><input type="date" id="eFec" value="${esc(p ? p.fecha_capacitacion || '' : '')}"></div>
        <div class="campo"><label>Código (opcional)</label><input id="eCod" value="${esc(p ? p.codigo || '' : '')}"></div>
        <div class="campo"><label>Estado</label><select id="eEst">${Object.entries(ESTADOS_PREG).map(([k, v]) => `<option value="${k}" ${(p ? p.estado : 'borrador') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="campo full"><label>Nota de verificación</label><input id="eNota" value="${esc(p ? p.nota_verificacion || '' : '')}"></div>
        <label class="check"><input type="checkbox" id="eAct" ${!p || p.activa ? 'checked' : ''}>Activa</label>
      </div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="eOk">Guardar</button></div>`, 'ancho');
    const pintarAlts = () => {
      m.q('#eAlts').innerHTML = alts.map((a, i) => `<div class="alt-edit">
        <input type="radio" name="eCorr" value="${i}" ${a.es_correcta ? 'checked' : ''} title="Respuesta correcta">
        <span class="letra">${LETRAS[i]})</span><input class="grow" data-i="${i}" value="${esc(a.texto)}" placeholder="${a.es_correcta ? 'Respuesta correcta' : 'Alternativa incorrecta'}">
        ${alts.length > 2 ? `<button class="btn sec mini" type="button" data-q="${i}">Quitar</button>` : ''}</div>`).join('');
      m.q('#eAlts').querySelectorAll('input[data-i]').forEach(inp => inp.oninput = () => { alts[inp.dataset.i].texto = inp.value; });
      m.q('#eAlts').querySelectorAll('input[name=eCorr]').forEach(r => r.onchange = () => { alts.forEach((a, i) => { a.es_correcta = i === Number(r.value); }); pintarAlts(); });
      m.q('#eAlts').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
        const fueCorrecta = alts[b.dataset.q].es_correcta; alts.splice(Number(b.dataset.q), 1);
        if (fueCorrecta) alts[0].es_correcta = true; pintarAlts();
      });
      m.q('#eMas').hidden = alts.length >= 6;
    };
    m.q('#eMas').onclick = () => { alts.push({ texto: '', es_correcta: false }); pintarAlts(); };
    pintarAlts();
    m.q('#eOk').onclick = async () => {
      const estado = m.q('#eEst').value;
      if (estado === 'aprobada' && m.q('#eNota').value.trim() && (!p || p.estado !== 'aprobada') &&
          !await confirmar('Verificación técnica', 'Esta pregunta tiene una nota de verificación. Confirme que la verificó antes de aprobarla.', 'Ya verifiqué')) return;
      try {
        await rpc('adm_guardar_pregunta', { p: {
          id: p ? p.id : null, banco_id: A.bancoSel, tema_id: m.q('#eTema').value, categoria: m.q('#eCat').value,
          enunciado: m.q('#eEnun').value, explicacion: m.q('#eExp').value, documento_ref: m.q('#eDoc').value,
          fecha_capacitacion: m.q('#eFec').value || null, codigo: m.q('#eCod').value, estado,
          activa: m.q('#eAct').checked, orden_fijo: m.q('#eFijo').checked, nota_verificacion: m.q('#eNota').value,
          orden: p ? p.orden : A.preguntas.length + 1,
          alternativas: alts.map(a => ({ texto: a.texto, es_correcta: !!a.es_correcta })) } });
        m.cerrar(); toast('Pregunta guardada.', 'ok'); panelPreguntas();
      } catch (e) { err(e); }
    };
  }

  function filasBanco(lista) {
    const temas = Object.fromEntries(A.temas.map(t => [t.id, t.nombre]));
    return lista.map(p => {
      const alts = [...p.alternativas].sort((a, b) => a.orden - b.orden);
      const ok = alts.find(a => a.es_correcta), inc = alts.filter(a => !a.es_correcta);
      return [temas[p.tema_id] || '', p.categoria || '', p.enunciado, ok ? ok.texto : '', inc[0] ? inc[0].texto : '',
        inc[1] ? inc[1].texto : '', inc[2] ? inc[2].texto : '', p.explicacion || '', p.activa ? 'SI' : 'NO',
        p.documento_ref || '', p.fecha_capacitacion ? fecha(p.fecha_capacitacion) : '',
        p.orden_fijo && ok ? LETRAS[alts.indexOf(ok)] : '', p.estado];
    });
  }
  function exportarBanco() {
    const b = A.bancos.find(x => x.id === A.bancoSel);
    libro([['PREGUNTAS', hoja(COLS_PLANTILLA, filasBanco(A.preguntas))]],
      `Banco_${norm(b.nombre).replace(/ /g, '_').slice(0, 40)}_${hoy()}.xlsx`);
  }
  function descargarPlantillaPreguntas() {
    const ej = [['Fabricación de puertas industriales', 'Interpretación de planos', '(Escriba aquí la pregunta)', '(Respuesta correcta)',
      '(Incorrecta creíble)', '(Incorrecta creíble)', '(Incorrecta creíble)', '(Por qué es correcta)', 'SI', '(Documento fuente)', '06/11/2026', '', 'pendiente_verificacion']];
    const instr = hoja([{ h: 'INSTRUCCIONES', w: 110, wrap: true }], [
      ['1. Una fila por pregunta. Tema y Pregunta y Correcta son obligatorios; al menos 1 incorrecta (se recomiendan 3).'],
      ['2. Activa: SI o NO. Estado: borrador, pendiente_verificacion o aprobada (vacío = pendiente_verificacion).'],
      ['3. Posición correcta (orden fijo): déjela vacía para mezclar alternativas. Si escribe a, b, c o d, la correcta se mostrará en esa letra y las incorrectas en las demás, en el orden del archivo.'],
      ['4. No use "Todas las anteriores". Si el tema no existe en el banco, se crea automáticamente.'],
      ['5. Fecha de capacitación en formato DD/MM/AAAA.']]);
    libro([['PREGUNTAS', hoja(COLS_PLANTILLA, ej)], ['INSTRUCCIONES', instr]], 'plantilla_importacion.xlsx');
  }

  function importarPreguntas() {
    const b = A.bancos.find(x => x.id === A.bancoSel);
    const m = modal(`<div class="modal-cab"><h2>Importar preguntas desde Excel</h2></div>
      <p class="small">Banco destino: <b>${esc(b.nombre)}</b>. Use las columnas de la plantilla (Tema | Categoría | Pregunta | Correcta | Incorrecta 1 | Incorrecta 2 | Incorrecta 3 | Explicación | Activa …).</p>
      <div class="campo"><label>Archivo Excel (.xlsx)</label><input type="file" id="iArch" accept=".xlsx,.xls"></div>
      <div class="row mt"><label class="check"><input type="radio" name="iModo" value="agregar" checked>Agregar al banco</label>
        <label class="check"><input type="radio" name="iModo" value="reemplazar">Reemplazar todas las preguntas del banco</label></div>
      <div id="iRes" class="mt"></div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn sec" id="iPrev">Vista previa</button>
        <button class="btn" id="iOk" disabled>Confirmar importación</button></div>`, 'ancho');
    let filas = null;
    const modo = () => m.q('input[name=iModo]:checked').value;
    m.querySelectorAll('input[name=iModo]').forEach(r => r.onchange = () => { m.q('#iOk').disabled = true; });
    m.q('#iArch').onchange = () => { m.q('#iOk').disabled = true; };
    m.q('#iPrev').onclick = async () => {
      const f = m.q('#iArch').files[0];
      if (!f) { toast('Seleccione un archivo.', 'error'); return; }
      try {
        const r = await leerExcel(f, MAPA_PREG);
        filas = r.filas.map(({ _avisos, ...x }) => x);
        const v = await rpc('adm_importar_preguntas', { p_banco_id: A.bancoSel, p_modo: modo(), p_filas: filas, p_solo_validar: true });
        m.q('#iRes').innerHTML = resumenImport(v, filas, ['fila', 'tema', 'pregunta', 'correcta', 'incorrecta1', 'estado']) +
          (modo() === 'reemplazar' ? `<div class="alerta error mt"><div>Modo REEMPLAZAR: se eliminarán las ${A.preguntas.length} preguntas actuales del banco (los resultados históricos se conservan).</div></div>` : '');
        m.q('#iOk').disabled = v.errores.length > 0;
      } catch (e) { m.q('#iRes').innerHTML = `<div class="alerta error">${esc(mensajeError(e))}</div>`; }
    };
    m.q('#iOk').onclick = async () => {
      try {
        const v = await rpc('adm_importar_preguntas', { p_banco_id: A.bancoSel, p_modo: modo(), p_filas: filas, p_solo_validar: false });
        if (!v.guardado) { m.q('#iRes').innerHTML = resumenImport(v, filas, []); return; }
        m.cerrar(); toast(v.mensaje, 'ok'); await cargarCatalogos(); panelPreguntas();
      } catch (e) { err(e); }
    };
  }

  function resumenImport(v, filas, cols) {
    const errores = v.errores || [], adv = v.advertencias || [];
    return `<div class="alerta ${errores.length ? 'error' : 'ok'}"><div><b>${esc(v.mensaje)}</b><br>
      Filas leídas: ${v.filas}${v.validas != null ? ` · válidas: ${v.validas}` : ''} · errores: ${errores.length} · advertencias: ${adv.length}
      ${(v.temas_nuevos || v.zonas_nuevas || []).length ? `<br>Se crearán: ${esc((v.temas_nuevos || v.zonas_nuevas).join(', '))}` : ''}</div></div>
      ${errores.length ? `<h3 class="mt">Errores</h3><div class="tabla-wrap"><table><thead><tr><th>Fila</th><th>Error</th></tr></thead><tbody>${errores.map(x => `<tr><td>${x.fila}</td><td>${esc(x.mensaje)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${adv.length ? `<h3 class="mt">Advertencias</h3><div class="tabla-wrap"><table><thead><tr><th>Fila</th><th>Advertencia</th></tr></thead><tbody>${adv.map(x => `<tr><td>${x.fila}</td><td>${esc(x.mensaje)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${cols.length && filas.length ? `<h3 class="mt">Vista previa (primeras 10 filas)</h3><div class="tabla-wrap"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${filas.slice(0, 10).map(f => `<tr>${cols.map(c => `<td class="small">${esc(f[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  function panelTemas() {
    const temas = temasDe(A.bancoSel);
    const cuenta = {};
    A.preguntas.forEach(p => { cuenta[p.tema_id] = (cuenta[p.tema_id] || 0) + 1; });
    $('panelBanco').innerHTML = `<div class="row mb"><button class="btn" id="tNuevo"><svg class="ico"><use href="#i-mas"/></svg>Nuevo tema</button></div>
      <div class="tabla-wrap"><table><thead><tr><th class="num">Orden</th><th>Tema</th><th>Descripción</th><th class="num">Preguntas</th><th>Activo</th><th></th></tr></thead><tbody>
      ${temas.length ? temas.map(t => `<tr><td class="num">${t.orden}</td><td><b>${esc(t.nombre)}</b></td><td class="small">${esc(t.descripcion || '')}</td>
        <td class="num">${cuenta[t.id] || 0}</td><td>${t.activo ? '<span class="badge si">SÍ</span>' : '<span class="badge inactiva">NO</span>'}</td>
        <td class="row"><button class="btn sec mini" data-ed="${t.id}">Editar</button><button class="btn sec mini" data-del="${t.id}">Eliminar</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="vacio">Sin temas.</td></tr>'}</tbody></table></div>`;
    $('tNuevo').onclick = () => editarTema(null);
    $('panelBanco').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editarTema(temas.find(t => t.id === b.dataset.ed)));
    $('panelBanco').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmar('Eliminar tema', '¿Eliminar este tema? Solo es posible si no tiene preguntas.', 'Eliminar', 'peligro')) return;
      try { await rpc('adm_eliminar_tema', { p_id: b.dataset.del }); await cargarCatalogos(); panelTemas(); toast('Tema eliminado.', 'ok'); } catch (e) { err(e); }
    });
  }
  function editarTema(t) {
    const m = modal(`<div class="modal-cab"><h2>${t ? 'Editar tema' : 'Nuevo tema'}</h2></div>
      <div class="campo"><label>Nombre</label><input id="tNom" value="${esc(t ? t.nombre : '')}"></div>
      <div class="campo mt"><label>Descripción</label><textarea id="tDes">${esc(t ? t.descripcion || '' : '')}</textarea></div>
      <div class="campo mt"><label>Orden</label><input type="number" id="tOrd" value="${t ? t.orden : temasDe(A.bancoSel).length + 1}"></div>
      <label class="check mt"><input type="checkbox" id="tAct" ${!t || t.activo ? 'checked' : ''}>Activo (los temas inactivos no entran a los exámenes)</label>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="tOk">Guardar</button></div>`);
    m.q('#tOk').onclick = async () => {
      try {
        await rpc('adm_guardar_tema', { p_id: t ? t.id : null, p_banco_id: A.bancoSel, p_nombre: m.q('#tNom').value,
          p_descripcion: m.q('#tDes').value || null, p_orden: Number(m.q('#tOrd').value) || 0, p_activo: m.q('#tAct').checked });
        m.cerrar(); await cargarCatalogos(); panelTemas(); toast('Tema guardado.', 'ok');
      } catch (e) { err(e); }
    };
  }

  // ------------------------------------------------------------------
  // EVALUACIONES
  // ------------------------------------------------------------------
  async function vEvaluaciones() {
    const n = navegacion;
    await cargarCatalogos();
    if (!vigente(n)) return;
    const bancos = Object.fromEntries(A.bancos.map(b => [b.id, b.nombre]));
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Evaluaciones</h1><div class="row"><button class="btn" id="evNueva"><svg class="ico"><use href="#i-mas"/></svg>Nueva evaluación</button></div></div>
      <p class="small muted">Cada evaluación tiene su propia configuración. Los cambios no alteran los resultados ya registrados.</p>
      <div class="lista-eval">${A.evals.map(e => `<div class="tarjeta" style="margin:0">
        <div class="row between"><span class="badge ${e.estado}">${e.estado.toUpperCase()}</span><span class="small muted">${e.requiere_padron ? 'Solo padrón' : 'Abierta a todos'}${e.mostrar_en_inicio ? '' : ' · Oculta en inicio'}</span></div>
        <h3 class="mt" style="margin-bottom:4px">${esc(e.nombre)}</h3>
        <div class="small muted">Banco: ${esc(bancos[e.banco_id] || '')}</div>
        <div class="small mt">${e.total_preguntas} preguntas (${e.modo_seleccion === 'por_tema' ? 'por tema' : 'del banco completo'}) · ${e.tiempo_minutos} min ·
          Máx. ${num(e.puntaje_maximo)} · Mín. ${num(e.puntaje_minimo)} · ${e.intentos_permitidos} intento(s) · tolera ${e.infracciones_permitidas} infracciones</div>
        ${e.apertura || e.cierre ? `<div class="small">Apertura: ${fechaHora(e.apertura)} · Cierre: ${fechaHora(e.cierre)}</div>` : ''}
        <div class="enlace-copia mt"><input readonly value="${esc(urlPublica(e.codigo))}"><button class="btn sec mini" data-copiar="${esc(urlPublica(e.codigo))}">Copiar enlace</button></div>
        <div class="row mt">
          <button class="btn mini ${e.estado === 'abierta' ? 'peligro' : 'exito'}" data-est="${e.id}" data-v="${e.estado === 'abierta' ? 'cerrada' : 'abierta'}">${e.estado === 'abierta' ? 'Cerrar' : 'Abrir'}</button>
          <button class="btn sec mini" data-ver="${e.id}">Verificar banco</button>
          <button class="btn sec mini" data-ed="${e.id}">Editar</button>
          <button class="btn sec mini" data-del="${e.id}">Eliminar</button></div></div>`).join('') || '<div class="vacio">Sin evaluaciones.</div>'}</div></section>`;
    $('evNueva').onclick = () => editarEvaluacion(null);
    const pr = $('principal');
    pr.querySelectorAll('[data-copiar]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Enlace copiado.', 'ok'); }
      catch (e) { b.previousElementSibling.select(); toast('Seleccione y copie el enlace manualmente.'); }
    });
    pr.querySelectorAll('[data-est]').forEach(b => b.onclick = async () => {
      try { await rpc('adm_estado_evaluacion', { p_id: b.dataset.est, p_estado: b.dataset.v }); toast(b.dataset.v === 'abierta' ? 'Evaluación abierta.' : 'Evaluación cerrada.', 'ok'); vEvaluaciones(); }
      catch (e) { err(e); }
    });
    pr.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => verificarEvaluacion(b.dataset.ver));
    pr.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => editarEvaluacion(A.evals.find(e => e.id === b.dataset.ed)));
    pr.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmar('Eliminar evaluación', 'Solo se puede eliminar si no tiene resultados. Si ya tiene resultados, ciérrela y ocúltela.', 'Eliminar', 'peligro')) return;
      try { await rpc('adm_eliminar_evaluacion', { p_id: b.dataset.del }); toast('Evaluación eliminada.', 'ok'); vEvaluaciones(); } catch (e) { err(e); }
    });
  }

  async function verificarEvaluacion(id) {
    try {
      const v = await rpc('adm_verificar_evaluacion', { p_id: id });
      modal(`<div class="modal-cab"><h2>Verificación del banco</h2></div>
        <div class="alerta ${v.ok ? 'ok' : 'error'}"><div>${v.ok ? `El banco alcanza para generar exámenes de ${v.total} preguntas.` : 'El banco NO tiene suficientes preguntas aprobadas y activas. La evaluación no se podrá abrir.'}</div></div>
        <div class="tabla-wrap mt"><table><thead><tr><th>Tema</th><th class="num">Requeridas</th><th class="num">Disponibles</th><th></th></tr></thead><tbody>
        ${v.detalle.map(d => `<tr><td>${esc(d.tema)}</td><td class="num">${d.requeridas}</td><td class="num">${d.disponibles}</td><td>${d.ok ? '<span class="badge si">OK</span>' : '<span class="badge no">FALTAN</span>'}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted mt">Disponibles = preguntas aprobadas, activas, con 1 respuesta correcta y al menos 2 alternativas, en temas activos.</p>
        <div class="modal-pie"><button class="btn" data-cerrar>Cerrar</button></div>`);
    } catch (e) { err(e); }
  }

  async function editarEvaluacion(e) {
    const ev = e || { codigo: '', nombre: '', empresa: 'Hermética S.A.C.', banco_id: A.bancos[0] && A.bancos[0].id, modo_seleccion: 'por_tema',
      preguntas_por_tema: 4, total_preguntas: 20, puntaje_maximo: 20, puntaje_minimo: 13, tiempo_minutos: 20, intentos_permitidos: 1,
      infracciones_permitidas: 3, pausa_segundos: 5, plazo_recuperacion_segundos: 30, mezclar_preguntas: true, mezclar_alternativas: true,
      tipos_infraccion: TIPOS_INFRACCION.slice(0, 10).map(t => t[0]), mostrar_en_inicio: true, requiere_padron: false, estado: 'cerrada', orden: A.evals.length + 1 };
    let dist = [];
    if (e) { try { dist = await sel(sb.from('evaluacion_temas').select('*').eq('evaluacion_id', e.id)); } catch (x) { /* nada */ } }
    const v = (k) => esc(ev[k] ?? '');
    const m = modal(`<div class="modal-cab"><h2>${e ? 'Editar evaluación' : 'Nueva evaluación'}</h2></div>
      ${e ? '<div class="alerta info mb small"><div>Los cambios se aplican a los próximos exámenes. Los resultados ya registrados conservan su configuración original.</div></div>' : ''}
      <h3>General</h3>
      <div class="campos">
        <div class="campo full"><label>Nombre de la evaluación</label><input id="xNom" value="${v('nombre')}"></div>
        <div class="campo"><label>Título en pantalla</label><input id="xTit" value="${v('titulo')}"></div>
        <div class="campo"><label>Código del enlace (minúsculas, números, guiones)</label><input id="xCod" value="${v('codigo')}" placeholder="ej. sst-epp-2026-12"></div>
        <div class="campo"><label>Empresa</label><input id="xEmp" value="${v('empresa')}"></div>
        <div class="campo"><label>Fecha de referencia</label><input type="date" id="xFec" value="${v('fecha_referencia')}"></div>
        <div class="campo full"><label>Instrucciones</label><textarea id="xIns">${v('instrucciones')}</textarea></div>
        <div class="campo"><label>Banco de preguntas</label><select id="xBan">${opciones(A.bancos, ev.banco_id)}</select></div>
        <div class="campo"><label>Orden en la pantalla de inicio</label><input type="number" id="xOrd" value="${v('orden')}"></div>
        <label class="check"><input type="checkbox" id="xMos" ${ev.mostrar_en_inicio ? 'checked' : ''}>Mostrar en la pantalla de inicio</label>
        <label class="check"><input type="checkbox" id="xPad" ${ev.requiere_padron ? 'checked' : ''}>Solo trabajadores del padrón (desmarcado: cualquier DNI puede rendir, una sola vez)</label>
      </div>
      <h3 class="mt2">Preguntas</h3>
      <div class="campos">
        <div class="campo"><label>Selección</label><select id="xModo">
          <option value="por_tema" ${ev.modo_seleccion === 'por_tema' ? 'selected' : ''}>Aleatoria por tema</option>
          <option value="total" ${ev.modo_seleccion === 'total' ? 'selected' : ''}>Aleatoria del banco completo</option></select></div>
        <div class="campo" id="cTot"><label>Total de preguntas</label><input type="number" min="1" id="xTot" value="${v('total_preguntas')}"></div>
        <div class="campo" id="cPpt"><label>Preguntas por tema (igual para todos)</label><input type="number" min="0" id="xPpt" value="${v('preguntas_por_tema')}"></div>
        <div class="campo full" id="cDist"><label>Distribución por tema</label><div class="tabla-wrap"><table class="dist-tabla" id="xDist"></table></div>
          <span class="ayuda" id="xDistTot"></span></div>
        <label class="check"><input type="checkbox" id="xMp" ${ev.mezclar_preguntas ? 'checked' : ''}>Mezclar el orden de las preguntas</label>
        <label class="check"><input type="checkbox" id="xMa" ${ev.mezclar_alternativas ? 'checked' : ''}>Mezclar alternativas (excepto preguntas con orden fijo)</label>
      </div>
      <h3 class="mt2">Calificación y tiempo</h3>
      <div class="campos">
        <div class="campo"><label>Puntaje máximo</label><input type="number" step="0.5" min="1" id="xMax" value="${v('puntaje_maximo')}"></div>
        <div class="campo"><label>Puntaje mínimo aprobatorio</label><input type="number" step="0.5" min="0" id="xMin" value="${v('puntaje_minimo')}"></div>
        <div class="campo"><label>Tiempo (minutos)</label><input type="number" min="1" id="xTie" value="${v('tiempo_minutos')}"></div>
        <div class="campo"><label>Intentos permitidos por DNI</label><input type="number" min="1" id="xInt" value="${v('intentos_permitidos')}"></div>
        <div class="campo full ayuda" id="xPpq"></div>
      </div>
      <h3 class="mt2">Supervisión</h3>
      <div class="campos">
        <div class="campo"><label>Infracciones toleradas (la siguiente anula)</label><input type="number" min="0" id="xInf" value="${v('infracciones_permitidas')}"></div>
        <div class="campo"><label>Pausa de seguridad (segundos)</label><input type="number" min="0" id="xPau" value="${v('pausa_segundos')}"></div>
        <div class="campo"><label>Plazo para volver (segundos)</label><input type="number" min="5" id="xPla" value="${v('plazo_recuperacion_segundos')}"></div>
        <div class="campo full"><label>Eventos que cuentan como infracción</label>
          ${TIPOS_INFRACCION.map(([k, t]) => `<label class="check"><input type="checkbox" class="xTi" value="${k}" ${ev.tipos_infraccion.includes(k) ? 'checked' : ''}>${esc(t)}</label>`).join('')}
          <span class="ayuda">Los eventos no marcados se registran igual, pero no suman infracciones. En iPhone no existe pantalla completa: ese control se omite automáticamente.</span></div>
      </div>
      <h3 class="mt2">Disponibilidad</h3>
      <div class="campos">
        <div class="campo"><label>Estado</label><select id="xEst"><option value="cerrada" ${ev.estado === 'cerrada' ? 'selected' : ''}>Cerrada</option><option value="abierta" ${ev.estado === 'abierta' ? 'selected' : ''}>Abierta</option></select></div>
        <div class="campo"></div>
        <div class="campo"><label>Apertura (hora de Perú, opcional)</label><input type="datetime-local" id="xApe" value="${aLocalInput(ev.apertura)}"></div>
        <div class="campo"><label>Cierre (hora de Perú, opcional)</label><input type="datetime-local" id="xCie" value="${aLocalInput(ev.cierre)}"></div>
      </div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="xOk">Guardar</button></div>`, 'ancho');

    let disponibles = {};
    const cargarDisp = async () => {
      try {
        const ps = await traerTodo(() => sb.from('preguntas').select('tema_id, estado, activa').eq('banco_id', m.q('#xBan').value));
        disponibles = {};
        ps.forEach(p => { if (p.estado === 'aprobada' && p.activa) disponibles[p.tema_id] = (disponibles[p.tema_id] || 0) + 1; });
      } catch (x) { disponibles = {}; }
    };
    const pintar = () => {
      const modo = m.q('#xModo').value;
      m.q('#cTot').hidden = modo !== 'total';
      m.q('#cPpt').hidden = m.q('#cDist').hidden = modo !== 'por_tema';
      const temas = temasDe(m.q('#xBan').value).filter(t => t.activo);
      const ppt = Number(m.q('#xPpt').value) || 0;
      const actual = Object.fromEntries(dist.map(d => [d.tema_id, d.cantidad]));
      const usarDist = dist.length && m.q('#xBan').value === ev.banco_id;
      m.q('#xDist').innerHTML = `<thead><tr><th>Tema</th><th class="num">Preguntas por examen</th><th class="num">Disponibles (aprobadas)</th></tr></thead><tbody>` +
        temas.map(t => `<tr><td>${esc(t.nombre)}</td><td class="num"><input type="number" min="0" class="xCant" data-t="${t.id}" value="${usarDist ? (actual[t.id] || 0) : ppt}"></td>
          <td class="num">${disponibles[t.id] || 0}</td></tr>`).join('') + '</tbody>';
      m.q('#xDist').querySelectorAll('.xCant').forEach(i => i.oninput = totDist);
      totDist();
    };
    const totDist = () => {
      const modo = m.q('#xModo').value;
      const tot = modo === 'por_tema' ? [...m.q('#xDist').querySelectorAll('.xCant')].reduce((s, i) => s + (Number(i.value) || 0), 0) : Number(m.q('#xTot').value) || 0;
      m.q('#xDistTot').textContent = `Total por examen: ${tot} preguntas.`;
      const max = Number(m.q('#xMax').value) || 0;
      m.q('#xPpq').textContent = tot ? `Cada pregunta valdrá ${(max / tot).toFixed(2)} puntos.` : '';
    };
    m.q('#xPpt').oninput = () => { dist = []; pintar(); };
    m.q('#xModo').onchange = pintar;
    m.q('#xBan').onchange = async () => { await cargarDisp(); pintar(); };
    ['#xTot', '#xMax'].forEach(s => { m.q(s).oninput = totDist; });
    await cargarDisp(); pintar();

    m.q('#xOk').onclick = async () => {
      const modo = m.q('#xModo').value;
      const cants = [...m.q('#xDist').querySelectorAll('.xCant')].map(i => ({ tema_id: i.dataset.t, cantidad: Number(i.value) || 0 }));
      const ppt = Number(m.q('#xPpt').value) || 0;
      const uniforme = cants.every(c => c.cantidad === ppt);
      const datos = {
        id: e ? e.id : null, codigo: m.q('#xCod').value.trim().toLowerCase(), nombre: m.q('#xNom').value, titulo: m.q('#xTit').value,
        empresa: m.q('#xEmp').value, fecha_referencia: m.q('#xFec').value || null, instrucciones: m.q('#xIns').value,
        banco_id: m.q('#xBan').value, orden: Number(m.q('#xOrd').value) || 0, mostrar_en_inicio: m.q('#xMos').checked,
        requiere_padron: m.q('#xPad').checked,
        modo_seleccion: modo, total_preguntas: Number(m.q('#xTot').value) || 1, preguntas_por_tema: ppt,
        mezclar_preguntas: m.q('#xMp').checked, mezclar_alternativas: m.q('#xMa').checked,
        puntaje_maximo: Number(m.q('#xMax').value), puntaje_minimo: Number(m.q('#xMin').value),
        tiempo_minutos: Number(m.q('#xTie').value), intentos_permitidos: Number(m.q('#xInt').value),
        infracciones_permitidas: Number(m.q('#xInf').value), pausa_segundos: Number(m.q('#xPau').value),
        plazo_recuperacion_segundos: Number(m.q('#xPla').value),
        tipos_infraccion: [...m.querySelectorAll('.xTi:checked')].map(c => c.value),
        estado: m.q('#xEst').value, apertura: deLocalInput(m.q('#xApe').value), cierre: deLocalInput(m.q('#xCie').value),
        distribucion: modo === 'por_tema' ? (uniforme ? [] : cants) : []
      };
      if (datos.plazo_recuperacion_segundos <= datos.pausa_segundos) { toast('El plazo para volver debe ser mayor que la pausa de seguridad.', 'error'); return; }
      try { await rpc('adm_guardar_evaluacion', { p: datos }); m.cerrar(); toast('Evaluación guardada.', 'ok'); vEvaluaciones(); }
      catch (x) { err(x); }
    };
  }

  // ------------------------------------------------------------------
  // PADRÓN Y ZONAS
  // ------------------------------------------------------------------
  async function vPadron() {
    const n = navegacion;
    await cargarCatalogos();
    try { A.trabajadores = await traerTodo(() => sb.from('trabajadores').select('*').order('nombre')); } catch (e) { err(e); return; }
    if (!vigente(n)) return;
    const zonas = Object.fromEntries(A.zonas.map(z => [z.id, z.nombre]));
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Padrón de trabajadores y zonas</h1></div>
      <div class="graficos" style="grid-template-columns:1fr 2fr">
        <div class="tarjeta"><div class="row between"><h3 style="margin:0">Zonas</h3><button class="btn mini" id="zNueva">+ Zona</button></div>
          <div class="tabla-wrap mt"><table><thead><tr><th>Zona</th><th>Activa</th><th></th></tr></thead><tbody>
          ${A.zonas.map(z => `<tr><td>${esc(z.nombre)}</td><td>${z.activa ? '<span class="badge si">SÍ</span>' : '<span class="badge inactiva">NO</span>'}</td>
            <td class="row"><button class="btn sec mini" data-zed="${z.id}">Editar</button><button class="btn sec mini" data-zdel="${z.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></div>
        <div class="tarjeta"><div class="row between"><h3 style="margin:0">Trabajadores habilitados</h3>
          <div class="row"><button class="btn mini" id="tNuevoT">+ Trabajador</button><button class="btn sec mini" id="tImp">Importar Excel</button>
          <button class="btn sec mini" id="tExp">Exportar</button><button class="btn sec mini" id="tPla">Plantilla</button></div></div>
          <div class="filtros mt" style="margin-bottom:10px">
            <div class="campo" style="flex:2 1 200px"><label>Buscar</label><input id="tBus" placeholder="Nombre o DNI"></div>
            <div class="campo"><label>Zona</label><select id="tZon">${opciones(A.zonas, '', 'Todas')}</select></div>
            <div class="campo"><label>Estado</label><select id="tAct"><option value="1">Activos</option><option value="0">Inactivos</option><option value="">Todos</option></select></div></div>
          <p class="small muted" id="tCont"></p>
          <div class="tabla-wrap" style="max-height:60vh"><table id="tTrab"></table></div></div>
      </div>
      <div class="alerta info mt small"><div>Solo los DNI <b>activos</b> del padrón pueden rendir evaluaciones. Los trabajadores no se eliminan: se desactivan para conservar su historial.
        Los DNI de prueba (00000001 a 00000004) deben desactivarse antes de usar el sistema con el personal.</div></div></section>`;
    const pintar = () => {
      const q = norm($('tBus').value), z = $('tZon').value, a = $('tAct').value;
      const l = A.trabajadores.filter(t => (!q || norm(t.nombre + ' ' + t.dni).includes(q)) && (!z || String(t.zona_id) === z) && (!a || String(Number(t.activo)) === a));
      $('tCont').textContent = `${l.length} de ${A.trabajadores.length} trabajadores`;
      $('tTrab').innerHTML = `<thead><tr><th>DNI</th><th>Nombre</th><th>Zona</th><th>Cargo</th><th>Activo</th><th></th></tr></thead><tbody>` +
        (l.length ? l.slice(0, 500).map(t => `<tr><td>${esc(t.dni)}</td><td>${esc(t.nombre)}</td><td>${esc(zonas[t.zona_id] || '')}</td><td class="small">${esc(t.cargo || '')}</td>
          <td>${t.activo ? '<span class="badge si">SÍ</span>' : '<span class="badge inactiva">NO</span>'}</td><td><button class="btn sec mini" data-ted="${esc(t.dni)}">Editar</button></td></tr>`).join('')
          : '<tr><td colspan="6" class="vacio">Sin trabajadores. Importe el padrón en Excel.</td></tr>') + '</tbody>';
      $('tTrab').querySelectorAll('[data-ted]').forEach(b => b.onclick = () => editarTrabajador(A.trabajadores.find(t => t.dni === b.dataset.ted)));
    };
    ['tBus', 'tZon', 'tAct'].forEach(i => { $(i).oninput = pintar; $(i).onchange = pintar; });
    pintar();
    $('zNueva').onclick = () => editarZona(null);
    document.querySelectorAll('[data-zed]').forEach(b => b.onclick = () => editarZona(A.zonas.find(z => String(z.id) === b.dataset.zed)));
    document.querySelectorAll('[data-zdel]').forEach(b => b.onclick = async () => {
      if (!await confirmar('Eliminar zona', 'Si la zona tiene trabajadores o resultados, se desactivará en lugar de eliminarse.', 'Continuar', 'peligro')) return;
      try { const r = await rpc('adm_eliminar_zona', { p_id: Number(b.dataset.zdel) }); toast(r.mensaje, 'ok'); vPadron(); } catch (e) { err(e); }
    });
    $('tNuevoT').onclick = () => editarTrabajador(null);
    $('tImp').onclick = importarPadron;
    $('tExp').onclick = () => libro([['PADRON', hoja([{ h: 'DNI' }, { h: 'Nombre completo' }, { h: 'Zona' }, { h: 'Cargo' }, { h: 'Activo' }],
      A.trabajadores.map(t => [t.dni, t.nombre, zonas[t.zona_id] || '', t.cargo || '', t.activo ? 'SI' : 'NO']))]], `Padron_Hermetica_${hoy()}.xlsx`);
    $('tPla').onclick = () => {
      const ws = hoja([{ h: 'DNI' }, { h: 'Nombre completo', w: 40 }, { h: 'Zona' }, { h: 'Cargo' }, { h: 'Activo' }],
        [['07654321', 'APELLIDOS Y NOMBRES DEL TRABAJADOR', 'Norte', 'Técnico instalador', 'SI']]);
      ws['A2'].t = 's'; ws['A2'].z = '@';
      libro([['PADRON', ws]], 'plantilla_padron_trabajadores.xlsx');
    };
  }
  function editarZona(z) {
    const m = modal(`<div class="modal-cab"><h2>${z ? 'Editar zona' : 'Nueva zona'}</h2></div>
      <div class="campo"><label>Nombre</label><input id="zNom" value="${esc(z ? z.nombre : '')}"></div>
      <div class="campo mt"><label>Orden</label><input type="number" id="zOrd" value="${z ? z.orden : A.zonas.length + 1}"></div>
      <label class="check mt"><input type="checkbox" id="zAct" ${!z || z.activa ? 'checked' : ''}>Activa (visible en el formulario del técnico)</label>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="zOk">Guardar</button></div>`);
    m.q('#zOk').onclick = async () => {
      try { await rpc('adm_guardar_zona', { p_id: z ? z.id : null, p_nombre: m.q('#zNom').value, p_activa: m.q('#zAct').checked, p_orden: Number(m.q('#zOrd').value) || 0 });
        m.cerrar(); toast('Zona guardada.', 'ok'); vPadron(); } catch (e) { err(e); }
    };
  }
  function editarTrabajador(t) {
    const m = modal(`<div class="modal-cab"><h2>${t ? 'Editar trabajador' : 'Nuevo trabajador'}</h2></div>
      <div class="campos">
        <div class="campo"><label>DNI</label><input id="wDni" inputmode="numeric" value="${esc(t ? t.dni : '')}" ${t ? 'readonly' : ''}></div>
        <div class="campo"><label>Zona</label><select id="wZon">${opciones(A.zonas, t ? t.zona_id : '', 'Sin zona')}</select></div>
        <div class="campo full"><label>Nombre completo</label><input id="wNom" value="${esc(t ? t.nombre : '')}"></div>
        <div class="campo"><label>Cargo</label><input id="wCar" value="${esc(t ? t.cargo || '' : '')}"></div>
        <label class="check"><input type="checkbox" id="wAct" ${!t || t.activo ? 'checked' : ''}>Activo (habilitado para rendir)</label>
      </div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn" id="wOk">Guardar</button></div>`);
    m.q('#wOk').onclick = async () => {
      try { await rpc('adm_guardar_trabajador', { p_dni: m.q('#wDni').value, p_nombre: m.q('#wNom').value,
        p_zona_id: m.q('#wZon').value ? Number(m.q('#wZon').value) : null, p_cargo: m.q('#wCar').value || null, p_activo: m.q('#wAct').checked });
        m.cerrar(); toast('Trabajador guardado.', 'ok'); vPadron(); } catch (e) { err(e); }
    };
  }
  function importarPadron() {
    const m = modal(`<div class="modal-cab"><h2>Importar padrón desde Excel</h2></div>
      <p class="small">Columnas: <b>DNI | NOMBRE COMPLETO | ZONA | ACTIVO</b> (CARGO opcional). El DNI debe estar en formato <b>Texto</b> para conservar el cero inicial.</p>
      <div class="campo"><label>Archivo Excel (.xlsx)</label><input type="file" id="iArch" accept=".xlsx,.xls"></div>
      <div class="row mt"><label class="check"><input type="radio" name="iModo" value="agregar" checked>Agregar / actualizar</label>
        <label class="check"><input type="radio" name="iModo" value="reemplazar">Reemplazar (desactiva a quienes no estén en el archivo)</label></div>
      <div id="iRes" class="mt"></div>
      <div class="modal-pie"><button class="btn sec" data-cerrar>Cancelar</button><button class="btn sec" id="iPrev">Vista previa</button>
        <button class="btn" id="iOk" disabled>Confirmar importación</button></div>`, 'ancho');
    let filas = null, avisos = [];
    const modo = () => m.q('input[name=iModo]:checked').value;
    m.q('#iArch').onchange = () => { m.q('#iOk').disabled = true; };
    m.querySelectorAll('input[name=iModo]').forEach(r => r.onchange = () => { m.q('#iOk').disabled = true; });
    m.q('#iPrev').onclick = async () => {
      const f = m.q('#iArch').files[0];
      if (!f) { toast('Seleccione un archivo.', 'error'); return; }
      try {
        const r = await leerExcel(f, MAPA_PADRON);
        avisos = r.filas.filter(x => x._avisos.length).map(x => ({ fila: x.fila, mensaje: x._avisos.join('; ') }));
        filas = r.filas.map(({ _avisos, ...x }) => x);
        const v = await rpc('adm_importar_trabajadores', { p_filas: filas, p_modo: modo(), p_solo_validar: true });
        v.advertencias = avisos; v.validas = v.filas - v.errores.length;
        m.q('#iRes').innerHTML = resumenImport(v, filas, ['fila', 'dni', 'nombre', 'zona', 'activo']);
        m.q('#iOk').disabled = v.errores.length > 0;
      } catch (e) { m.q('#iRes').innerHTML = `<div class="alerta error">${esc(mensajeError(e))}</div>`; }
    };
    m.q('#iOk').onclick = async () => {
      try {
        const v = await rpc('adm_importar_trabajadores', { p_filas: filas, p_modo: modo(), p_solo_validar: false });
        if (!v.guardado) { v.validas = 0; m.q('#iRes').innerHTML = resumenImport(v, filas, []); return; }
        m.cerrar(); toast(v.mensaje + (v.desactivados ? ` Desactivados: ${v.desactivados}.` : ''), 'ok'); vPadron();
      } catch (e) { err(e); }
    };
  }

  // ------------------------------------------------------------------
  // CONFIGURACIÓN
  // ------------------------------------------------------------------
  async function vConfiguracion() {
    const n = navegacion;
    await cargarCatalogos();
    if (!vigente(n)) return;
    const c = A.config || {};
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Configuración general</h1></div>
      <div class="tarjeta">
        <div class="campos">
          <div class="campo full"><label>Título del sistema</label><input id="cTit" value="${esc(c.titulo_sistema || '')}"></div>
          <div class="campo full"><label>Título de la pantalla de inicio</label><input id="cIni" value="${esc(c.titulo_inicio || '')}"></div>
          <div class="campo"><label>Empresa</label><input id="cEmp" value="${esc(c.empresa || '')}"></div>
          <div class="campo"><label>Enlace público (URL de GitHub Pages)</label><input id="cUrl" value="${esc(c.url_publica || '')}" placeholder="https://usuario.github.io/hermetica-evaluaciones/"></div>
          <div class="campo full"><label>Aviso antifraude</label><textarea id="cAvi" style="min-height:120px">${esc(c.aviso_antifraude || '')}</textarea></div>
          <div class="campo full"><label>Aviso de tratamiento de datos personales</label><textarea id="cPri" style="min-height:260px">${esc(c.aviso_privacidad || '')}</textarea>
            <span class="ayuda">Texto sujeto a revisión de RR. HH. / Legal. Al cambiarlo, actualice la versión: cada intento registra la versión aceptada.</span></div>
          <div class="campo"><label>Versión del aviso</label><input id="cVer" value="${esc(c.version_privacidad || '')}"></div>
          <label class="check"><input type="checkbox" id="cAdm" ${c.mostrar_enlace_admin ? 'checked' : ''}>Mostrar el enlace "Evaluador" en la pantalla de inicio</label>
        </div>
        <div class="row end mt"><button class="btn" id="cOk">Guardar configuración</button></div>
      </div>
      <div class="tarjeta"><h3>Zonas, evaluaciones y parámetros</h3>
        <p class="small">Las zonas se administran en <b>Padrón y zonas</b>. El número de preguntas, tiempo, puntajes, infracciones, apertura y cierre se configuran por cada evaluación en <b>Evaluaciones</b>.</p></div></section>`;
    $('cOk').onclick = async () => {
      try {
        await rpc('adm_guardar_config', { p: { titulo_sistema: $('cTit').value, titulo_inicio: $('cIni').value, empresa: $('cEmp').value,
          url_publica: $('cUrl').value.trim(), aviso_antifraude: $('cAvi').value, aviso_privacidad: $('cPri').value,
          version_privacidad: $('cVer').value, mostrar_enlace_admin: $('cAdm').checked } });
        toast('Configuración guardada.', 'ok'); await cargarCatalogos();
      } catch (e) { err(e); }
    };
  }

  // ------------------------------------------------------------------
  // EVALUADORES (solo superadmin)
  // ------------------------------------------------------------------
  async function vEvaluadores() {
    let lista = [];
    const n = navegacion;
    try { lista = await sel(sb.from('admins').select('*').order('creado_en')); } catch (e) { err(e); }
    if (!vigente(n)) return;
    $('principal').innerHTML = `<section>
      <div class="titulo-sec"><h1>Evaluadores</h1></div>
      <div class="alerta info mb small"><div>Para agregar un evaluador: (1) en Supabase &gt; Authentication &gt; Users pulse <b>Add user</b> y cree el usuario con su correo;
        (2) regístrelo aquí con su rol. Solo un evaluador principal puede administrar evaluadores.</div></div>
      <div class="tarjeta"><div class="campos">
        <div class="campo"><label>Correo</label><input id="aEm" type="email"></div>
        <div class="campo"><label>Nombre</label><input id="aNo"></div>
        <div class="campo"><label>Rol</label><select id="aRo"><option value="evaluador">Evaluador</option><option value="superadmin">Evaluador principal (superadmin)</option></select></div>
        <div class="campo"><label>&nbsp;</label><button class="btn" id="aOk">Agregar / actualizar</button></div></div></div>
      <div class="tabla-wrap mt"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Activo</th><th>Desde</th><th></th></tr></thead><tbody>
        ${lista.map(a => `<tr><td>${esc(a.email)}</td><td>${esc(a.nombre)}</td><td>${a.rol === 'superadmin' ? 'Evaluador principal' : 'Evaluador'}</td>
          <td>${a.activo ? '<span class="badge si">SÍ</span>' : '<span class="badge inactiva">NO</span>'}</td><td>${fecha(a.creado_en)}</td>
          <td><button class="btn sec mini" data-tg='${esc(JSON.stringify(a))}'>${a.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}</tbody></table></div></section>`;
    $('aOk').onclick = async () => {
      try { await rpc('adm_guardar_admin', { p_email: $('aEm').value, p_nombre: $('aNo').value, p_rol: $('aRo').value, p_activo: true }); toast('Evaluador guardado.', 'ok'); vEvaluadores(); }
      catch (e) { err(e); }
    };
    document.querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => {
      const a = JSON.parse(b.dataset.tg);
      try { await rpc('adm_guardar_admin', { p_email: a.email, p_nombre: a.nombre, p_rol: a.rol, p_activo: !a.activo }); vEvaluadores(); } catch (e) { err(e); }
    });
  }

  // ------------------------------------------------------------------
  // AUDITORÍA
  // ------------------------------------------------------------------
  async function vAuditoria() {
    let l = [];
    const n = navegacion;
    try { l = await sel(sb.from('auditoria').select('*').order('creado_en', { ascending: false }).limit(300)); } catch (e) { err(e); }
    if (!vigente(n)) return;
    $('principal').innerHTML = `<section><div class="titulo-sec"><h1>Auditoría</h1></div>
      <p class="small muted">Últimas 300 acciones administrativas (reinicios, anulaciones, cambios de preguntas, evaluaciones y configuración).</p>
      <div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Evaluador</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
      ${l.map(a => `<tr><td class="small">${fechaHora(a.creado_en)}</td><td class="small">${esc(a.actor_email || '')}</td><td><b>${esc(a.accion.replace(/_/g, ' '))}</b></td>
        <td class="small">${esc(a.entidad || '')}</td><td class="small" style="max-width:520px;word-break:break-word">${esc(resumenDetalle(a.detalle))}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin registros.</td></tr>'}
      </tbody></table></div></section>`;
  }
  function resumenDetalle(d) {
    if (!d) return '';
    if (d.motivo) return 'Motivo: ' + d.motivo + (d.numero_envio ? ' · ' + d.numero_envio : '');
    const s = JSON.stringify(d.despues || d);
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  }

  arrancar();
})();
