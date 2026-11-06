/* =====================================================================
   HERMÉTICA | supabase.js — conexión y utilidades compartidas
   ===================================================================== */
(function () {
  'use strict';
  const cfg = window.HERMETICA_CONFIG || {};
  const configurado = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('SU-PROYECTO') &&
                      cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PEGUE');

  let cliente = null;
  if (configurado && window.supabase) {
    cliente = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  // Convierte errores del servidor ("CODIGO: mensaje") en texto amigable
  function mensajeError(err) {
    if (!err) return 'Error desconocido.';
    let m = err.message || String(err);
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) {
      return 'Sin conexión con el servidor. Verifique su internet e intente nuevamente.';
    }
    if (/permission denied|42501/i.test(m) && !/SIN_PERMISO/.test(m)) {
      return 'No tiene permisos para realizar esta acción.';
    }
    const i = m.indexOf(': ');
    if (i > 0 && /^[A-Z_]+$/.test(m.slice(0, i))) m = m.slice(i + 2);
    return m;
  }
  function codigoError(err) {
    const m = (err && err.message) || '';
    const i = m.indexOf(':');
    return i > 0 && /^[A-Z_]+$/.test(m.slice(0, i)) ? m.slice(0, i) : '';
  }

  // Llamada RPC con reintentos ante fallas de red
  async function rpc(nombre, params, opciones) {
    if (!cliente) throw new Error('CONFIGURACION: El sistema aún no está configurado (config.js).');
    const reintentos = (opciones && opciones.reintentos) ?? 2;
    let ultimo;
    for (let intento = 0; intento <= reintentos; intento++) {
      try {
        const { data, error } = await cliente.rpc(nombre, params || {});
        if (error) {
          const e = new Error(error.message || 'Error del servidor');
          e.code = error.code; e.esServidor = true;
          throw e;
        }
        return data;
      } catch (e) {
        ultimo = e;
        if (e.esServidor || intento === reintentos) break;
        await new Promise(r => setTimeout(r, 700 * (intento + 1)));
      }
    }
    throw ultimo;
  }

  // Escapa texto para insertarlo en HTML
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fechaHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    return d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit',
      year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fecha(v) {
    if (!v) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; }
    return new Date(v).toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
  }
  function duracion(seg) {
    if (seg == null) return '—';
    const m = Math.floor(seg / 60), s = seg % 60;
    return `${m} min ${String(s).padStart(2, '0')} s`;
  }
  function num(v, dec) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    return Number.isInteger(n) && !dec ? String(n) : n.toFixed(dec ?? 2).replace(/\.00$/, '');
  }

  // Almacenamiento local seguro (puede fallar en modo privado)
  const almacen = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };

  window.HDB = { cliente, configurado, rpc, mensajeError, codigoError, esc, fechaHora, fecha,
                 duracion, num, almacen, cfg };
})();
