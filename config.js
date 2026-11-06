/* =====================================================================
   HERMÉTICA | PLATAFORMA DE EVALUACIÓN TÉCNICA
   config.js — ÚNICO archivo que debe editar durante la instalación.
   ---------------------------------------------------------------------
   * SUPABASE_URL: Supabase > Project Settings > API (o "Data API") > Project URL
   * SUPABASE_ANON_KEY: Supabase > Project Settings > API Keys >
       "Publishable key" (sb_publishable_...) o "anon public" (eyJ...)
   NUNCA coloque aquí la clave "service_role" ni la "secret key".
   La clave pública es segura de publicar: la base de datos está protegida
   con Row Level Security y solo permite las funciones autorizadas.
   ===================================================================== */
window.HERMETICA_CONFIG = {
  SUPABASE_URL: 'https://grynjthlhbrsgkcthowq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_582uqy1TU2nlkd_IEfUt9w_eEb3YbvA',

  // Código de la evaluación que se abre por defecto si el enlace no
  // indica ninguna (index.html?e=codigo). Vacío = la primera abierta.
  EVALUACION_PREDETERMINADA: '',

  // Nombre del archivo del panel del evaluador
  ADMIN_URL: 'admin.html'
};
