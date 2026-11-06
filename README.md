# HERMÉTICA | PLATAFORMA DE EVALUACIÓN TÉCNICA

Sistema web para evaluar conocimientos técnicos y de SST del personal de **Hermética S.A.C.**
Funciona con **Supabase Free** (base de datos + login) y **GitHub Pages** (páginas web), sin costo de licencias.

- `index.html` → examen del técnico (PC, tablet y celular).
- `admin.html` → panel del evaluador.

---

## 1. Estructura de archivos

| Archivo / carpeta | Para qué sirve |
|---|---|
| `index.html`, `examen.js` | Examen del técnico y supervisión antifraude |
| `admin.html`, `admin.js` | Panel del evaluador: dashboard, resultados, bancos, evaluaciones, padrón, configuración, evaluadores, auditoría |
| `styles.css` | Diseño corporativo (azul #1E4BCD / #052882), adaptable a celular |
| `supabase.js` | Conexión con Supabase y utilidades comunes |
| `config.js` | **Único archivo que se edita en la instalación** (URL y clave pública) |
| `logo-hermetica.png`, `favicon.png`, `imagen-encabezado.jpg` | Imágenes **provisionales**: reemplácelas por las oficiales con el mismo nombre |
| `SQL/01 … 06` | Base de datos. Se ejecutan en orden y se pueden repetir sin borrar información |
| `EXCEL/` | Banco de preguntas, plantilla de importación y plantilla del padrón |
| `.github/workflows/` | Tarea que consulta la base cada 3 días para que Supabase Free no se pause |
| `GITHUB/` | Copia de la misma tarea, como referencia |

## 2. Seguridad (cómo está protegido)

- El público **no puede leer ninguna tabla**: Row Level Security activo y permisos revocados.
- El técnico solo usa 9 funciones autorizadas (`pub_*`). Las **respuestas correctas nunca llegan al navegador**.
- La **nota**, la **hora límite**, las **infracciones** y la **anulación** se deciden en el servidor.
- Cada examen tiene un **token secreto**; en la base solo se guarda su huella (SHA‑256).
- **Un intento por DNI** y evaluación (regla de la base de datos). Solo el evaluador autoriza un nuevo intento, con motivo y auditoría; el intento original se conserva.
- Solo pueden rendir los DNI **activos del padrón**. La validación no revela el nombre registrado.
- Funciones del evaluador (`adm_*`): verifican el rol en cada llamada. Escrituras solo por funciones; no hay permisos de escritura directa.
- `config.js` lleva solo la **clave pública**. **Nunca** coloque la `service_role` / `secret key` en ningún archivo.
- Cada examen guarda una **copia fija** de sus preguntas, alternativas y configuración: editar o borrar preguntas no altera el historial.

## 3. Supervisión antifraude: qué detecta y qué NO

| Control | Funciona en | Limitación real |
|---|---|---|
| Cambio de pestaña / app / minimizar (Visibility API) | Todos | En celular, una notificación o llamada también lo activa |
| Pérdida de foco de la ventana | PC | Puede activarse con ventanas emergentes del sistema |
| Pantalla completa (Fullscreen API) | PC, Android, iPad | **iPhone no lo permite**: el control se omite automáticamente |
| Copiar / pegar / cortar / clic derecho | Todos | Solo dentro de la página |
| Teclas (Ctrl+P, Ctrl+C, F12, Impr Pant…) | PC | Las combinaciones del sistema operativo (Alt+Tab, Win+Shift+S) no siempre llegan al navegador |
| Impresión | PC | — |
| Ventana reducida / pantalla dividida | PC, Android | Se compara el ancho; girar el celular no cuenta |
| Escritorio extendido (Screen API) | Solo Chrome/Edge en PC | Es una señal, no una prueba; no detecta monitores duplicados |
| Pantalla encendida (Wake Lock) | Navegadores modernos | Si no está disponible, solo se registra |

**No es posible detectar** de forma confiable: un segundo celular, capturas de pantalla, una persona dictando respuestas, ni todos los paneles laterales de todos los navegadores.
El sistema **disuade y deja registro**; no reemplaza la presencia del evaluador cuando la nota tiene consecuencias.

**Reglas por defecto (configurables por evaluación):** se toleran **3 infracciones**; la **4.ª anula**. En cada infracción las preguntas se ocultan **5 s** y el técnico tiene **30 s** para volver; si no vuelve, se anula. El tiempo del examen no se detiene.

## 4. Evaluaciones cargadas

| Evaluación | Banco | Configuración |
|---|---|---|
| Segregación y Gestión Adecuada de Residuos Sólidos – Evaluación de Capacitación SST (06/11/2026) | 6 preguntas oficiales, literales | 6 preguntas × 2 puntos = 12; mínimo **8/12**; 10 min; orden de alternativas fijo |
| Evaluación de Conocimientos Técnicos y SST | Banco General (5 temas, **vacío**) | 20 preguntas (4 por tema), 20 min, 20 / mínimo 13 |

Ambas inician **CERRADAS**. Antes de abrir la SST, el evaluador debe **aprobar las preguntas 3, 4 y 5** (colores) tras verificarlas contra el procedimiento de residuos de Hermética y la NTP 900.058:2019. La pregunta 2 conserva "Ambas alternativas son correctas" como **excepción oficial**.

## 5. Antes de usar con el personal

1. Reemplace `logo-hermetica.png`, `favicon.png` e `imagen-encabezado.jpg` por las imágenes oficiales (mismo nombre).
2. Importe el padrón real y **desactive los DNI de prueba** `00000001` a `00000004`.
3. Haga revisar el **aviso de datos personales** por RR. HH. / Legal (Configuración) y actualice su versión.
4. Verifique y apruebe las preguntas de colores; abra la evaluación SST.
5. Configure un **correo SMTP propio** en Supabase si necesita recuperación de contraseña para varios evaluadores (el correo incluido en el plan gratuito tiene límites muy bajos).
6. Desactive los registros públicos en Supabase (Authentication > Sign In / Providers > *Allow new users to sign up*: apagado).

## 6. Mantenimiento

- **Respaldo:** el plan gratuito no incluye restauración a un punto en el tiempo. Exporte el Excel de resultados al cierre de cada evaluación.
- **Supabase pausado:** si pasan 7 días sin uso y la tarea de GitHub está desactivada, entre a Supabase y pulse *Restore project*.
- **Tarea de GitHub:** GitHub la desactiva si el repositorio pasa 60 días sin cambios; reactívela en la pestaña *Actions*.
- Si modifica funciones SQL, vuelva a ejecutar `06_configuracion_seguridad.sql` al final.

## 7. Pruebas realizadas antes de la entrega

Ejecutadas en un entorno local equivalente (PostgreSQL 16 + PostgREST 12 + Chromium), **no** en su proyecto Supabase:

- **86/86 pruebas de base de datos:** seguridad del público, RLS, validación de DNI y padrón, selección aleatoria, mezcla, guardado, tiempo del servidor, envío por tiempo, cierre de intentos abandonados, notas (12/12, 8/12 límite, 6/12), anulación por infracciones y por plazo, pausa no saltable, segundo intento, reinicio con auditoría, importación todo‑o‑nada, histórico intacto, permisos de evaluadores.
- **29/29 pruebas en navegador:** login, aprobación de preguntas, apertura, examen completo en PC y celular, pausa de seguridad, anulación, resultados, detalle, exportación Excel de 4 hojas, importación de preguntas y padrón, dashboard, auditoría.
- Re‑ejecución de los 6 scripts SQL sobre una base con datos: sin pérdida ni duplicados.

Pendiente de probar en producción (Paso 10 de la instalación): Supabase Auth real (correo de recuperación), GitHub Pages, iPhone/Android reales y la tarea programada de GitHub.
