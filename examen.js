/* =====================================================================
   HERMÉTICA | examen.js — Examen del técnico (index.html)
   ---------------------------------------------------------------------
   * El navegador NUNCA recibe las respuestas correctas.
   * La hora límite, la nota y las infracciones se controlan en el servidor.
   * La supervisión del navegador registra eventos; NO puede detectar
     un segundo celular, capturas de pantalla ni ayuda de otra persona.
   ===================================================================== */
(function () {
  'use strict';
  const { rpc, mensajeError, codigoError, esc, fechaHora, num, almacen } = window.HDB;
  const $ = id => document.getElementById(id);
  const CLAVE_TOKEN = 'hermetica_eval_token';
  const LETRAS = 'abcdefghij';

  const S = {
    config: null, evals: [], ev: null,
    token: null, paq: null, i: 0, resp: {}, pendientes: {},
    segBase: 0, tBase: 0, timer: null, finalizando: false,
    enExamen: false, saliendoFS: false, fsSoportado: false,
    reglas: null, ultimoEvento: {}, cola: [],
    pausa: { activa: false, finPausa: 0, finPlazo: 0, vencidaEnviada: false, ticker: null },
    anchoBase: 0, orientacion: '', wakeLock: null, oyentes: []
  };

  // ------------------------------------------------------------------
  // Utilidades de interfaz
  // ------------------------------------------------------------------
  function toast(msg, tipo) {
    const t = document.createElement('div');
    t.className = 'toast ' + (tipo || '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  function alerta(cont, msg, tipo) {
    $(cont).innerHTML = msg ? `<div class="alerta ${tipo || 'error'}">${esc(msg)}</div>` : '';
  }
  function abrirModal(html, clase) {
    const f = document.createElement('div');
    f.className = 'modal-fondo';
    f.innerHTML = `<div class="modal ${clase || ''}" role="dialog" aria-modal="true">${html}</div>`;
    $('modales').appendChild(f);
    return f;
  }
  function cerrarModales() { $('modales').innerHTML = ''; }
  function mostrar(pantalla) {
    ['pInicio', 'pExamen', 'pResultado'].forEach(p => { $(p).hidden = p !== pantalla; });
    // El enlace administrativo y el encabezado solo existen fuera del examen
    $('cabecera').hidden = pantalla === 'pExamen';
    $('pie').hidden = pantalla === 'pExamen';
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------
  // Pantalla completa
  // ------------------------------------------------------------------
  function fsActivo() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function pedirFS() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* no soportado */ }
    return Promise.resolve();
  }
  function salirFS() {
    S.saliendoFS = true;
    try {
      if (document.exitFullscreen && fsActivo()) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen && fsActivo()) document.webkitExitFullscreen();
    } catch (e) { /* nada */ }
  }
  S.fsSoportado = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  async function iniciar() {
    if (!window.HDB.configurado) {
      alerta('msgInicio', 'El sistema aún no está configurado. El evaluador debe completar el archivo config.js.');
      return;
    }
    // ¿Hay una evaluación en curso en este navegador?
    const tok = almacen.get(CLAVE_TOKEN);
    if (tok) {
      try {
        const st = await rpc('pub_estado', { p_token: tok });
        if (st && st.estado === 'en_curso') { ofrecerRetomar(tok, st); return; }
        if (st && st.resultado) { S.token = tok; mostrarResultado(st.resultado); return; }
      } catch (e) {
        if (codigoError(e) === 'TOKEN_INVALIDO') almacen.del(CLAVE_TOKEN);
        else { alerta('msgInicio', mensajeError(e)); }
      }
    }
    await cargarConfig();
  }

  async function cargarConfig() {
    try {
      S.config = await rpc('pub_config');
    } catch (e) {
      alerta('msgInicio', mensajeError(e));
      return;
    }
    const c = S.config;
    $('tituloInicio').textContent = c.titulo_inicio;
    $('tituloSistema').textContent = c.titulo_sistema.replace(/^HERMÉTICA\s*\|\s*/i, '');
    document.title = c.titulo_sistema;
    $('avisoAntifraude').innerHTML = esc(c.aviso_antifraude).replace(/^IMPORTANTE:/, '<b>IMPORTANTE:</b>');
    $('enlaceAdmin').hidden = !c.mostrar_enlace_admin;
    $('enlaceAdmin').href = window.HDB.cfg.ADMIN_URL || 'admin.html';
    $('fZona').innerHTML = '<option value="">Seleccione…</option>' +
      c.zonas.map(z => `<option value="${z.id}">${esc(z.nombre)}</option>`).join('');

    S.evals = c.evaluaciones || [];
    if (!S.evals.length) {
      alerta('msgInicio', 'No hay evaluaciones publicadas en este momento.', 'info');
      return;
    }
    const param = new URLSearchParams(location.search).get('e') || window.HDB.cfg.EVALUACION_PREDETERMINADA;
    let ev = param ? S.evals.find(e => e.codigo === param) : null;
    if (param && !ev) alerta('msgInicio', 'El enlace indica una evaluación que no existe o no está publicada.', 'info');
    const abiertas = S.evals.filter(e => e.abierta);
    if (!ev && abiertas.length === 1) ev = abiertas[0];

    if (!ev || (!param && S.evals.length > 1)) {
      $('bloqueSelector').hidden = false;
      $('selectorEval').innerHTML = S.evals.map(e => `
        <button type="button" class="opcion-eval" data-cod="${esc(e.codigo)}">
          <div class="ico-c"><svg class="ico"><use href="#i-intento"/></svg></div>
          <div><b>${esc(e.nombre)}</b><div class="small muted">${e.total_preguntas} preguntas · ${e.tiempo_minutos} min · Puntaje máximo ${num(e.puntaje_maximo)}</div></div>
          <span class="badge ${e.abierta ? 'abierta' : 'cerrada'}">${e.abierta ? 'ABIERTA' : 'CERRADA'}</span>
        </button>`).join('');
      $('selectorEval').querySelectorAll('.opcion-eval').forEach(b =>
        b.addEventListener('click', () => seleccionarEval(S.evals.find(e => e.codigo === b.dataset.cod))));
    }
    if (ev) seleccionarEval(ev);
  }

  function seleccionarEval(ev) {
    S.ev = ev;
    document.querySelectorAll('.opcion-eval').forEach(b => b.classList.toggle('activa', b.dataset.cod === ev.codigo));
    $('bloqueEval').hidden = false;
    $('evNombre').textContent = ev.titulo || ev.nombre;
    $('evDetalle').textContent = [ev.titulo && ev.titulo !== ev.nombre ? ev.nombre : '', ev.empresa,
      ev.fecha_referencia ? 'Fecha: ' + window.HDB.fecha(ev.fecha_referencia) : ''].filter(Boolean).join(' · ');
    $('evEstado').className = 'badge ' + (ev.abierta ? 'abierta' : 'cerrada');
    $('evEstado').textContent = ev.abierta ? 'ABIERTA' : 'CERRADA';
    $('evInstrucciones').textContent = ev.instrucciones || '';
    $('infPreg').textContent = ev.total_preguntas;
    $('infTiempo').textContent = ev.tiempo_minutos + ' min';
    $('infMin').textContent = `${num(ev.puntaje_minimo)} / ${num(ev.puntaje_maximo)}`;
    $('infInt').textContent = ev.intentos_permitidos;
    $('avisoReglas').innerHTML = Number(ev.infracciones_permitidas) === 0
      ? `Reglas de supervisión: <b>cualquier salida de la evaluación</b> (cambiar de aplicación, pestaña o pantalla, ` +
        `minimizar o salir de pantalla completa) <b>ANULA el examen de inmediato</b>. Active "No molestar" en su celular antes de comenzar.`
      : `Reglas de supervisión: se toleran <b>${ev.infracciones_permitidas}</b> infracciones; ` +
        `la siguiente <b>anula</b> el examen. En cada infracción las preguntas se ocultan durante <b>${ev.pausa_segundos} s</b> ` +
        `y tiene <b>${ev.plazo_recuperacion_segundos} s</b> para volver a la evaluación.`;
    $('btnContinuar').disabled = !ev.abierta;
    if (!ev.abierta) alerta('msgForm', 'Esta evaluación no está abierta en este momento.', 'info');
    else alerta('msgForm', '');
  }

  // Validación local + validación de DNI en el servidor
  $('formDatos').addEventListener('submit', async ev => {
    ev.preventDefault();
    alerta('msgForm', '');
    const nombre = $('fNombre').value.trim().replace(/\s+/g, ' ');
    const dni = $('fDni').value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const zona = $('fZona').value;
    document.querySelectorAll('.campo').forEach(c => c.classList.remove('invalido'));
    const errores = [];
    if (nombre.length < 5 || nombre.split(' ').length < 2) { errores.push('Ingrese su nombre completo (nombres y apellidos).'); $('fNombre').parentElement.classList.add('invalido'); }
    if (!/^[0-9A-Z]{8,12}$/.test(dni)) { errores.push('Ingrese un DNI válido (8 dígitos).'); $('fDni').parentElement.classList.add('invalido'); }
    if (!zona) { errores.push('Seleccione su zona de trabajo.'); $('fZona').parentElement.classList.add('invalido'); }
    if (!$('fConsent').checked) errores.push('Debe aceptar el aviso de tratamiento de datos personales.');
    if (errores.length) { alerta('msgForm', errores.join(' ')); return; }

    const b = $('btnContinuar');
    b.disabled = true; b.innerHTML = '<span class="cargando"></span> Validando…';
    try {
      const v = await rpc('pub_validar_dni', { p_codigo: S.ev.codigo, p_dni: dni });
      if (!v.valido) { alerta('msgForm', v.mensaje); return; }
      ultimoAviso({ nombre, dni, zona: Number(zona) });
    } catch (e) {
      alerta('msgForm', mensajeError(e));
    } finally {
      b.disabled = false; b.textContent = 'Continuar';
    }
  });

  $('verPrivacidad').addEventListener('click', e => {
    e.preventDefault();
    const m = abrirModal(`
      <div class="modal-cab"><h2>Tratamiento de datos personales</h2></div>
      <div class="texto-legal">${esc(S.config ? S.config.aviso_privacidad : '')}</div>
      <div class="small muted mt">Versión ${esc(S.config ? S.config.version_privacidad : '')}</div>
      <div class="modal-pie"><button class="btn" id="mOk">Entendido</button></div>`);
    m.querySelector('#mOk').onclick = cerrarModales;
  });

  function ultimoAviso(datos) {
    const m = abrirModal(`
      <div class="ultimo-aviso">
        <div class="ico-grande"><svg class="ico"><use href="#i-alerta"/></svg></div>
        <h2>ÚLTIMO AVISO</h2>
        <p>Una vez iniciada la evaluación, comenzará a correr el tiempo y se aplicarán las reglas de supervisión.</p>
        <p class="small muted">${esc(S.ev.titulo || S.ev.nombre)} · ${S.ev.total_preguntas} preguntas · ${S.ev.tiempo_minutos} minutos.
          ${S.fsSoportado ? 'La evaluación se abrirá en pantalla completa.' : 'Su navegador no permite pantalla completa: no cambie de aplicación ni de pestaña.'}</p>
        <div id="mMsg"></div>
      </div>
      <div class="modal-pie" style="justify-content:center">
        <button class="btn sec grande" id="mCancelar">Cancelar</button>
        <button class="btn grande" id="mComenzar">COMENZAR EVALUACIÓN</button>
      </div>`);
    m.querySelector('#mCancelar').onclick = cerrarModales;
    m.querySelector('#mComenzar').onclick = () => comenzar(datos, m);
  }

  async function comenzar(d, modal) {
    // La pantalla completa se solicita en el MISMO clic (requisito del navegador)
    pedirFS();
    const b = modal.querySelector('#mComenzar');
    b.disabled = true; b.innerHTML = '<span class="cargando"></span> Iniciando…';
    modal.querySelector('#mCancelar').disabled = true;
    try {
      const p = await rpc('pub_iniciar', {
        p_codigo: S.ev.codigo, p_dni: d.dni, p_nombre: d.nombre, p_zona_id: d.zona,
        p_consentimiento: true, p_user_agent: navigator.userAgent, p_dispositivo: infoDispositivo()
      }, { reintentos: 0 });
      almacen.set(CLAVE_TOKEN, p.token);
      cerrarModales();
      entrarExamen(p, false);
    } catch (e) {
      salirFS(); setTimeout(() => { S.saliendoFS = false; }, 500);
      modal.querySelector('#mMsg').innerHTML = `<div class="alerta error">${esc(mensajeError(e))}</div>`;
      b.disabled = false; b.textContent = 'COMENZAR EVALUACIÓN';
      modal.querySelector('#mCancelar').disabled = false;
    }
  }

  function infoDispositivo() {
    return {
      pantalla: `${screen.width}x${screen.height}`,
      ventana: `${innerWidth}x${innerHeight}`,
      tactil: navigator.maxTouchPoints > 0,
      pantalla_completa_soportada: S.fsSoportado,
      monitor_extendido: 'isExtended' in screen ? screen.isExtended : null,
      plataforma: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '',
      idioma: navigator.language
    };
  }

  function ofrecerRetomar(tok, st) {
    mostrar('pInicio');
    $('bloqueEval').hidden = true;
    $('msgInicio').innerHTML = `
      <div class="tarjeta">
        <div class="tarjeta-titulo"><div class="ico-c"><svg class="ico"><use href="#i-alerta"/></svg></div><h2>Tiene una evaluación en curso</h2></div>
        <p><b>${esc(st.evaluacion)}</b><br>${esc(st.nombre)} · DNI ${esc(st.dni_mask)}</p>
        <p class="small muted">La página se cerró o se recargó durante la evaluación. Esto queda registrado como infracción.
          El tiempo siguió corriendo en el servidor.</p>
        <button class="btn grande" id="btnRetomar">Continuar evaluación</button>
      </div>`;
    $('btnRetomar').onclick = async () => {
      pedirFS();
      try {
        const p = await rpc('pub_estado', { p_token: tok });
        if (p.estado !== 'en_curso') { S.token = tok; mostrarResultado(p.resultado); return; }
        p.token = tok;
        entrarExamen(p, true);
      } catch (e) { toast(mensajeError(e), 'error'); }
    };
  }

  // ------------------------------------------------------------------
  // Examen
  // ------------------------------------------------------------------
  function entrarExamen(p, retomado) {
    S.token = p.token; S.paq = p; S.reglas = p.reglas; S.enExamen = true; S.finalizando = false;
    S.resp = {};
    p.preguntas.forEach(q => { if (q.respuesta) S.resp[q.n] = q.respuesta; });
    const primeraSin = p.preguntas.findIndex(q => !q.respuesta);
    S.i = primeraSin >= 0 ? primeraSin : 0;
    $('exNombre').textContent = p.nombre;
    $('exDatos').textContent = `DNI ${p.dni_mask} · ${p.evaluacion}`;
    mostrar('pExamen');
    sincronizarTiempo(p.segundos_restantes);
    S.timer = setInterval(tic, 250);
    tic();
    renderPregunta();
    activarSupervision();
    if (!S.fsSoportado) registrar('sin_pantalla_completa', 'El navegador no permite pantalla completa (por ejemplo, iPhone).');
    if (retomado) registrar('salida_pagina', 'La página se recargó o se cerró durante la evaluación.');
    if (p.reglas && p.reglas.pausa_activa) mostrarPausa(p.reglas);
  }

  function sincronizarTiempo(seg) {
    if (typeof seg !== 'number') return;
    S.segBase = seg; S.tBase = performance.now();
  }
  function restante() { return Math.max(0, S.segBase - (performance.now() - S.tBase) / 1000); }
  function tic() {
    const r = restante();
    const m = Math.floor(r / 60), s = Math.floor(r % 60);
    $('tiempo').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('reloj').classList.toggle('alerta', r <= 60);
    if (r <= 0 && !S.finalizando) finalizar('tiempo');
  }

  function renderPregunta() {
    const q = S.paq.preguntas[S.i], n = S.paq.preguntas.length;
    $('exContador').textContent = `Pregunta ${S.i + 1} de ${n}`;
    $('exTema').textContent = q.tema || '';
    $('exTema').hidden = !q.tema;
    $('exEnunciado').textContent = q.enunciado;
    $('exAlternativas').innerHTML = q.alternativas.map((a, j) => `
      <button type="button" class="alt ${S.resp[q.n] === a.k ? 'sel' : ''}" role="radio"
        aria-checked="${S.resp[q.n] === a.k}" data-k="${esc(a.k)}">
        <span class="letra">${LETRAS[j]}</span><span>${esc(a.t)}</span></button>`).join('');
    $('exAlternativas').querySelectorAll('.alt').forEach(b =>
      b.addEventListener('click', () => responder(q.n, b.dataset.k)));
    $('btnAnt').disabled = S.i === 0;
    $('btnSig').hidden = S.i === n - 1;
    $('btnEnviar').hidden = S.i !== n - 1;
    const resp = Object.keys(S.resp).length;
    $('barraProg').style.width = (100 * resp / n) + '%';
    $('exRespondidas').textContent = `Respondidas: ${resp} de ${n}. Puede cambiar sus respuestas antes de enviar.`;
    $('mapa').innerHTML = S.paq.preguntas.map((p, j) =>
      `<button type="button" class="${S.resp[p.n] ? 'resp' : ''} ${j === S.i ? 'act' : ''}" data-j="${j}" aria-label="Pregunta ${j + 1}">${j + 1}</button>`).join('');
    $('mapa').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.i = Number(b.dataset.j); renderPregunta(); }));
  }
  $('btnAnt').addEventListener('click', () => { if (S.i > 0) { S.i--; renderPregunta(); } });
  $('btnSig').addEventListener('click', () => { if (S.i < S.paq.preguntas.length - 1) { S.i++; renderPregunta(); } });
  $('btnEnviar').addEventListener('click', () => confirmarEnvio());

  function estadoGuardado(txt, error) {
    const e = $('estadoGuardado');
    e.classList.toggle('err', !!error);
    e.querySelector('span').textContent = txt;
  }

  async function responder(n, k) {
    if (!S.enExamen || S.pausa.activa) return;
    S.resp[n] = k; S.pendientes[n] = k;
    renderPregunta();
    await enviarPendientes();
  }

  let enviando = false;
  async function enviarPendientes() {
    if (enviando || !S.enExamen) return;
    enviando = true;
    try {
      while (Object.keys(S.pendientes).length && S.enExamen) {
        const n = Number(Object.keys(S.pendientes)[0]);
        const k = S.pendientes[n];
        estadoGuardado('Guardando…');
        let r;
        try {
          r = await rpc('pub_responder', { p_token: S.token, p_orden: n, p_clave: k }, { reintentos: 1 });
        } catch (e) {
          if (codigoError(e)) { delete S.pendientes[n]; toast(mensajeError(e), 'error'); continue; }
          estadoGuardado('Sin conexión: reintentando…', true);
          setTimeout(enviarPendientes, 3000);
          return;
        }
        if (r.ok) {
          if (S.pendientes[n] === k) delete S.pendientes[n];
          sincronizarTiempo(r.segundos_restantes);
          estadoGuardado('Respuestas guardadas en el servidor');
        } else if (r.estado === 'pausa') {
          mostrarPausa(r.reglas);
          return;
        } else if (r.resultado) {
          mostrarResultado(r.resultado);
          return;
        }
      }
    } finally {
      enviando = false;
    }
  }

  function confirmarEnvio() {
    const n = S.paq.preguntas.length, resp = Object.keys(S.resp).length;
    const m = abrirModal(`
      <div class="modal-cab"><h2>¿Enviar evaluación?</h2></div>
      <p>Ha respondido <b>${resp} de ${n}</b> preguntas.${resp < n ? ` <b style="color:#B5322B">${n - resp} sin responder</b> se calificarán como incorrectas.` : ''}</p>
      <p class="small muted">Una vez enviada no podrá modificar sus respuestas.</p>
      <div class="modal-pie"><button class="btn sec" id="mNo">Revisar</button><button class="btn exito" id="mSi">Enviar ahora</button></div>`);
    m.querySelector('#mNo').onclick = cerrarModales;
    m.querySelector('#mSi').onclick = () => { cerrarModales(); finalizar('manual'); };
  }

  async function finalizar(motivo) {
    if (S.finalizando) return;
    S.finalizando = true;
    estadoGuardado(motivo === 'tiempo' ? 'Tiempo terminado: enviando…' : 'Enviando…');
    if (motivo === 'tiempo') toast('El tiempo terminó. La evaluación se envía automáticamente.');
    for (let intento = 0; intento < 30; intento++) {
      try {
        // Último intento de guardar respuestas pendientes
        for (const n of Object.keys(S.pendientes)) {
          try { await rpc('pub_responder', { p_token: S.token, p_orden: Number(n), p_clave: S.pendientes[n] }, { reintentos: 0 }); }
          catch (e) { /* si ya venció el tiempo, el servidor no la acepta */ }
          delete S.pendientes[n];
        }
        const res = await rpc('pub_finalizar', { p_token: S.token, p_motivo: motivo }, { reintentos: 1 });
        mostrarResultado(res);
        return;
      } catch (e) {
        if (codigoError(e)) { toast(mensajeError(e), 'error'); break; }
        estadoGuardado('Sin conexión: reintentando el envío…', true);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    S.finalizando = false;
  }

  // ------------------------------------------------------------------
  // Resultado
  // ------------------------------------------------------------------
  function mostrarResultado(r) {
    S.enExamen = false;
    clearInterval(S.timer);
    desactivarSupervision();
    ocultarPausa();
    cerrarModales();
    salirFS();
    mostrar('pResultado');
    let h;
    if (r.estado === 'ANULADO') {
      h = `<svg class="ico" style="width:56px;height:56px;color:#5E6678"><use href="#i-bloq"/></svg>
        <h1>EXAMEN ANULADO</h1>
        <div class="estado-grande ANULADO">ANULADO</div>
        <div class="alerta error" style="text-align:left"><div><b>Motivo:</b> ${esc(r.motivo)}</div></div>
        <div class="datos-res">
          <div><span>Número de envío</span><b>${esc(r.numero_envio)}</b></div>
          <div><span>Fecha</span><b>${esc(fechaHora(r.fecha))}</b></div>
          <div><span>Evaluación</span><b>${esc(r.evaluacion)}</b></div>
        </div>`;
    } else if (r.estado === 'APROBADO' || r.estado === 'DESAPROBADO') {
      const ok = r.estado === 'APROBADO';
      h = `<svg class="ico" style="width:56px;height:56px;color:${ok ? '#16875A' : '#D9433B'}"><use href="#${ok ? 'i-ok' : 'i-x'}"/></svg>
        <h2>${esc(r.nombre)}</h2>
        <div class="estado-grande ${r.estado}">${r.estado}</div>
        <div class="nota-grande">${num(r.nota)}<small> / ${num(r.puntaje_maximo)}</small></div>
        <div class="muted">Nota obtenida</div>
        <div class="datos-res">
          <div><span>Respuestas correctas</span><b>${r.correctas} de ${r.total}</b></div>
          <div><span>Puntaje máximo</span><b>${num(r.puntaje_maximo)}</b></div>
          <div><span>Puntaje mínimo</span><b>${num(r.puntaje_minimo)}</b></div>
          <div><span>Estado</span><b>${r.estado}</b></div>
          <div><span>Número de envío</span><b>${esc(r.numero_envio)}</b></div>
          <div><span>Fecha</span><b>${esc(fechaHora(r.fecha))}</b></div>
        </div>`;
    } else {
      h = `<h2>Evaluación en proceso</h2><p>Número de envío ${esc(r.numero_envio || '')}</p>`;
    }
    $('cajaResultado').innerHTML = h + `
      <p class="small muted mt2">Guarde su número de envío. Para consultas, comuníquese con el evaluador.</p>
      <button class="btn sec" id="btnSalir">Finalizar</button>`;
    $('btnSalir').onclick = () => { almacen.del(CLAVE_TOKEN); location.href = location.pathname + location.search; };
    setTimeout(() => { S.saliendoFS = false; }, 800);
  }

  // ------------------------------------------------------------------
  // Supervisión (antifraude)
  // ------------------------------------------------------------------
  function esInfraccion(tipo) { return !!(S.reglas && S.reglas.tipos_infraccion.includes(tipo)); }

  async function registrar(tipo, detalle, datos) {
    if (!S.enExamen) return;
    const ahora = Date.now();
    if (S.ultimoEvento[tipo] && ahora - S.ultimoEvento[tipo] < 1000 && tipo !== 'condiciones_restablecidas') return;
    S.ultimoEvento[tipo] = ahora;
    if (esInfraccion(tipo) && !S.pausa.activa) {
      // Se cubren las preguntas de inmediato; el servidor confirma.
      mostrarPausa({
        pausa_restante: S.reglas.pausa_segundos, plazo_restante: S.reglas.plazo_recuperacion_segundos,
        infracciones: S.reglas.infracciones + 1, infracciones_permitidas: S.reglas.infracciones_permitidas
      }, tipo);
    }
    const params = { p_token: S.token, p_tipo: tipo, p_detalle: detalle || null, p_datos: datos || null,
                     p_cliente_en: new Date().toISOString() };
    try {
      const r = await rpc('pub_evento', params, { reintentos: 1 });
      procesarRespuestaEvento(r);
      return r;
    } catch (e) {
      if (!codigoError(e)) S.cola.push(params); // sin conexión: se reintenta
    }
  }

  function procesarRespuestaEvento(r) {
    if (!r) return;
    if (r.estado !== 'en_curso') { if (r.resultado) mostrarResultado(r.resultado); return; }
    sincronizarTiempo(r.segundos_restantes);
    S.reglas = r.reglas;
    if (r.reglas.pausa_activa) mostrarPausa(r.reglas);
    else if (S.pausa.activa) ocultarPausa();
  }

  async function vaciarCola() {
    while (S.cola.length && S.enExamen) {
      const p = S.cola[0];
      try { procesarRespuestaEvento(await rpc('pub_evento', p, { reintentos: 0 })); S.cola.shift(); }
      catch (e) { if (codigoError(e)) S.cola.shift(); else return; }
    }
  }

  const NOMBRES = {
    cambio_pestana: 'Cambió de pestaña, aplicación o minimizó el navegador.',
    salida_pagina: 'La página se cerró o se recargó.',
    perdida_foco: 'La ventana de la evaluación perdió el foco.',
    salida_pantalla_completa: 'Salió de la pantalla completa.',
    copiar: 'Intentó copiar.', pegar: 'Intentó pegar.', cortar: 'Intentó cortar.',
    tecla_restringida: 'Usó una combinación de teclas restringida.',
    imprimir: 'Intentó imprimir.', ventana_reducida: 'Redujo el tamaño de la ventana o usó pantalla dividida.',
    menu_contextual: 'Abrió el menú contextual.'
  };

  function mostrarPausa(reglas, tipo) {
    const ahora = performance.now();
    S.pausa.activa = true;
    S.pausa.finPausa = ahora + (reglas.pausa_restante || 0) * 1000;
    S.pausa.finPlazo = ahora + (reglas.plazo_restante || 0) * 1000;
    S.pausa.vencidaEnviada = false;
    if (tipo) $('pausaMotivo').textContent = NOMBRES[tipo] || 'Se detectó una salida de la evaluación.';
    const inf = reglas.infracciones, perm = reglas.infracciones_permitidas;
    $('pausaInfr').textContent = inf >= perm
      ? `Infracción ${inf} de ${perm} toleradas. La próxima infracción ANULARÁ el examen.`
      : `Infracción ${inf} de ${perm} toleradas.`;
    $('pausa').hidden = false;
    $('pExamen').setAttribute('aria-hidden', 'true');
    if (!S.pausa.ticker) S.pausa.ticker = setInterval(ticPausa, 200);
    ticPausa();
  }
  function ocultarPausa() {
    S.pausa.activa = false;
    clearInterval(S.pausa.ticker); S.pausa.ticker = null;
    $('pausa').hidden = true;
    $('pExamen').removeAttribute('aria-hidden');
    if (Object.keys(S.pendientes).length) enviarPendientes();
  }
  function ticPausa() {
    const ahora = performance.now();
    const c = Math.max(0, Math.ceil((S.pausa.finPausa - ahora) / 1000));
    const p = Math.max(0, Math.ceil((S.pausa.finPlazo - ahora) / 1000));
    $('pausaCuenta').textContent = c;
    $('pausaPlazo').textContent = p;
    $('btnReanudar').disabled = c > 0;
    if (p <= 0 && !S.pausa.vencidaEnviada && S.enExamen) {
      S.pausa.vencidaEnviada = true;
      registrar('pausa_vencida', 'No restableció las condiciones dentro del plazo.');
    }
  }
  function condicionesOk() {
    return document.visibilityState === 'visible' && document.hasFocus() && (fsActivo() || !S.fsSoportado);
  }
  $('btnReanudar').addEventListener('click', async () => {
    if (S.fsSoportado && !fsActivo()) await pedirFS();
    setTimeout(async () => {
      if (!condicionesOk()) { toast('Active la pantalla completa y mantenga la evaluación en primer plano.', 'error'); return; }
      const b = $('btnReanudar'); b.disabled = true;
      await registrar('condiciones_restablecidas', 'El técnico volvió a la evaluación.');
      S.anchoBase = innerWidth;
      b.disabled = false;
    }, 350);
  });

  // --- Oyentes ---
  function on(obj, ev, fn, opt) { obj.addEventListener(ev, fn, opt); S.oyentes.push([obj, ev, fn, opt]); }
  function orientacionActual() {
    return (screen.orientation && screen.orientation.type) || (innerWidth > innerHeight ? 'h' : 'v');
  }

  function activarSupervision() {
    S.orientacion = orientacionActual();
    setTimeout(() => { S.anchoBase = innerWidth; }, 900);

    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') registrar('cambio_pestana', 'La página dejó de estar visible.');
      else { vaciarCola(); pedirWakeLock(); if (S.pausa.activa) ticPausa(); }
    });
    on(window, 'blur', () => {
      setTimeout(() => {
        if (S.enExamen && document.visibilityState === 'visible' && !document.hasFocus()) {
          registrar('perdida_foco', 'La ventana perdió el foco (otra aplicación, panel lateral o ventana superpuesta).');
        }
      }, 400);
    });
    const alCambiarFS = () => {
      if (S.fsSoportado && !fsActivo() && !S.saliendoFS && S.enExamen) {
        registrar('salida_pantalla_completa', 'Salió de la pantalla completa.');
      }
    };
    on(document, 'fullscreenchange', alCambiarFS);
    on(document, 'webkitfullscreenchange', alCambiarFS);
    ['copy', 'cut', 'paste'].forEach(t => on(document, t, e => {
      e.preventDefault();
      registrar({ copy: 'copiar', cut: 'cortar', paste: 'pegar' }[t]);
    }));
    on(document, 'contextmenu', e => { e.preventDefault(); registrar('menu_contextual'); });
    on(document, 'dragstart', e => e.preventDefault());
    on(document, 'keydown', e => {
      const k = (e.key || '').toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      let tipo = null, combo = '';
      if (ctrl && k === 'p') { tipo = 'imprimir'; combo = 'Ctrl+P'; }
      else if (ctrl && ['c', 'v', 'x', 'a', 's', 'u', 'f', 'g', 'h', 'j', 'k', 'l', 'n', 't', 'w', 'r'].includes(k)) { tipo = 'tecla_restringida'; combo = 'Ctrl+' + k.toUpperCase(); }
      else if (ctrl && e.shiftKey && ['i', 'j', 'c', 's'].includes(k)) { tipo = 'tecla_restringida'; combo = 'Ctrl+Shift+' + k.toUpperCase(); }
      else if (k === 'f12' || k === 'f5' || k === 'f11') { tipo = 'tecla_restringida'; combo = e.key; }
      else if (e.altKey && (k === 'tab' || k === 'f4')) { tipo = 'tecla_restringida'; combo = 'Alt+' + e.key; }
      if (tipo) { e.preventDefault(); e.stopPropagation(); registrar(tipo, 'Combinación: ' + combo); }
    }, true);
    on(document, 'keyup', e => {
      if ((e.key || '') === 'PrintScreen') registrar('tecla_restringida', 'Tecla Impr Pant (captura de pantalla)');
    });
    on(window, 'beforeprint', () => registrar('imprimir', 'Intento de impresión'));
    let tRes = null;
    on(window, 'resize', () => {
      clearTimeout(tRes);
      tRes = setTimeout(() => {
        const o = orientacionActual();
        if (o !== S.orientacion) { S.orientacion = o; S.anchoBase = innerWidth; return; }
        if (innerWidth > S.anchoBase) { S.anchoBase = innerWidth; return; }
        if (S.anchoBase && innerWidth < S.anchoBase * 0.75) {
          registrar('ventana_reducida', `Ancho de ventana ${innerWidth}px (antes ${S.anchoBase}px).`);
        }
      }, 450);
    });
    on(window, 'beforeunload', e => { if (S.enExamen) { e.preventDefault(); e.returnValue = ''; } });
    on(window, 'online', () => { vaciarCola(); enviarPendientes(); estadoGuardado('Conexión restablecida'); });
    on(window, 'offline', () => estadoGuardado('Sin conexión: sus respuestas se enviarán al reconectar', true));
    history.pushState({ examen: true }, '');
    on(window, 'popstate', () => {
      if (S.enExamen) { history.pushState({ examen: true }, ''); registrar('otro', 'Intentó retroceder con el navegador.'); }
    });

    // Screen API (solo Chrome/Edge en PC): señal de segundo monitor
    if ('isExtended' in screen) {
      if (screen.isExtended) registrar('monitor_extendido', 'Se detectó un escritorio extendido (posible segundo monitor).');
      try { on(screen, 'change', () => { if (screen.isExtended) registrar('monitor_extendido', 'Se conectó una pantalla extendida.'); }); } catch (e) { /* nada */ }
    }
    pedirWakeLock();
  }

  function desactivarSupervision() {
    S.oyentes.forEach(([o, ev, fn, opt]) => o.removeEventListener(ev, fn, opt));
    S.oyentes = [];
    if (S.wakeLock) { S.wakeLock.release().catch(() => {}); S.wakeLock = null; }
  }

  async function pedirWakeLock() {
    if (!S.enExamen) return;
    if (!('wakeLock' in navigator)) {
      if (!S.wlAvisado) { S.wlAvisado = true; registrar('wake_lock_no_disponible', 'El dispositivo no permite mantener la pantalla encendida.'); }
      return;
    }
    try { S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denegado */ }
  }

  iniciar();
})();
