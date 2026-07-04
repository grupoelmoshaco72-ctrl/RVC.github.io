# Guía para conectar el sorteo RVC (guardar registros + enviar correos)

Tu página ya funciona como demo. Para que **los registros se guarden de verdad**, **los correos se envíen solos** y **el panel de admin tenga un login real** una vez publicada en internet, conecta dos servicios gratuitos. Sigue los pasos en orden. Todo se configura en un solo lugar del archivo: el bloque **CONFIGURACIÓN**, cerca del final del `.html`.

---

## 🔑 Cómo entrar al panel de administrador

En el **pie de página** de tu web verás el texto discreto `· Administración`. Haz clic ahí. Se abrirá el panel de login.

- **Sin Supabase configurado (modo demo):** usuario `admin` / contraseña `RvcSorteo2026` (cámbiala en el bloque CONFIGURACIÓN). Esta contraseña queda visible en el código fuente de la página — sirve solo para probar, no para producción.
- **Con Supabase configurado (recomendado):** el login pide **correo y contraseña reales**, verificados por Supabase Auth. Ninguna contraseña de admin queda guardada en el archivo `.html`. Ver Parte A, paso 5.

---

## ✅ Cómo funciona el flujo ahora

**Sin la Parte C activada (revisión 100% manual — así está configurado ahora mismo):**
1. **Participante se registra**, eligiendo cuántos tickets quiere (S/10 c/u) → queda en estado **Pendiente** (no recibe ningún correo todavía). Si su DNI o correo ya estaban registrados, la página se lo avisa y no lo deja duplicar el registro.
2. **Tú abres el panel** → ves la foto del comprobante de Yape
3. **Si el pago es válido** → haces clic en ✓ → se generan tantos códigos `RVC-XXXXXX` como tickets haya comprado, y se envían al correo del participante
4. **Si el pago es falso** → haces clic en ✕ → queda como Rechazado

**Con la Parte C activada (validación automática con IA):**
1. Participante se registra y sube su comprobante.
2. Al instante, una IA lee la captura: compara el monto, el destinatario y el número de operación contra lo esperado.
3. Si todo calza con confianza suficiente → se aprueba solo, se generan los códigos y se envía el correo al toque. El participante ve "¡Pago confirmado!" en pantalla.
4. Si algo no calza o la imagen no se puede leer bien → queda **Pendiente** igual que en el modo manual, con una nota (🤖) en el panel explicándote por qué la IA no pudo confirmarlo, para que lo revises tú.

---

## Parte A — Guardar los registros (Supabase)

Supabase te da una base de datos, un almacén de imágenes y un sistema de login, todo gratis. Aquí se guardarán los datos de cada persona, la captura de su Yape, y el usuario del panel de admin.

**1. Crea la cuenta y el proyecto**
- Entra a https://supabase.com y crea una cuenta gratis.
- Botón **New project**. Ponle un nombre (ej. `sorteo-rvc`), una contraseña de base de datos (guárdala) y la región más cercana. Espera 1–2 minutos a que se cree.

**2. Crea la tabla de registros**
- En el menú lateral entra a **SQL Editor** → **New query**.
- Pega esto **tal cual** y presiona **Run**:

```sql
create table registros (
  id text primary key,
  nombre text,
  email text unique,
  tel text,
  dni text unique,
  ciudad text,
  cantidad integer default 1,
  code text default '',
  estado text default 'pendiente',
  comprobante_url text,
  operacion_id text,
  ai_nota text,
  fecha timestamptz default now()
);

-- Evita que el mismo número de operación de Yape se use en dos registros distintos
create unique index registros_operacion_unica on registros (operacion_id)
  where operacion_id is not null and operacion_id <> '';

alter table registros enable row level security;

-- Cualquiera puede inscribirse (insertar) — pero NO puede leer, editar ni borrar
create policy "inscripcion_publica" on registros
  for insert to anon with check (true);

-- Solo un administrador logueado (Supabase Auth) puede leer/editar/eliminar
create policy "panel_lectura" on registros for select to authenticated using (true);
create policy "panel_update"  on registros for update to authenticated using (true);
create policy "panel_delete"  on registros for delete to authenticated using (true);
```

`cantidad` guarda cuántos tickets compró cada participante (S/10 cada uno). Cuando apruebas a alguien en el panel, se generan tantos códigos como tickets haya comprado, y todos se envían en el mismo correo. `operacion_id` y `ai_nota` los usa la validación automática con IA de la Parte C (más abajo) — puedes ignorarlos si no la activas.

Dos mejoras importantes de seguridad respecto a antes:
- `email` y `dni` son `unique`: si alguien intenta registrarse dos veces, la base de datos rechaza el duplicado (la página ya avisa esto antes de enviarlo, pero esta es la barrera real de fondo).
- Las políticas de lectura/edición ahora exigen `authenticated` en vez de `anon`: **nadie puede ver ni tocar los registros por la API sin haber iniciado sesión de verdad** como admin (paso 5).

**3. Crea el almacén de las capturas**
- Menú lateral → **Storage** → **New bucket**.
- Nombre exacto: `comprobantes`. Marca la opción **Public bucket**. Crea.
- Entra al bucket creado → pestaña **Policies** → **New policy** → plantilla **"Allow access to everyone"** (o "For full customization") y permite **INSERT** y **SELECT** para el rol `anon`. Guarda.

**4. Copia tus llaves**
- Menú lateral → **Project Settings** → **API**.
- Copia el **Project URL** y la clave **anon / publishable**.
- En el archivo `.html`, pégalas aquí:

```js
const SUPA = {
  url: "https://TUPROYECTO.supabase.co",   // ← tu Project URL
  key: "eyJhbGciOi...."                    // ← tu clave anon / publishable
};
```

**5. Crea el usuario administrador (login real del panel)**
- Menú lateral → **Authentication** → **Users** → **Add user** → **Create new user**.
- Pon el correo y contraseña que usarás para entrar al panel de admin (ej. `admin@turaifa.com`). Marca **Auto Confirm User**.
- Guarda. Ese correo y contraseña son ahora las credenciales reales del panel — en cuanto `SUPA.url`/`SUPA.key` están completos, la página deja de usar `ADMIN_USER`/`ADMIN_PASS` y pide este login real automáticamente.
- Puedes crear varios usuarios si más de una persona administrará el sorteo.

Listo: desde ahora cada inscripción se guarda en Supabase, la captura del Yape se sube al bucket, y el panel de administrador solo lo puede abrir quien tenga una cuenta creada en el paso 5.

---

## Parte B — Enviar el ticket por correo (EmailJS)

El correo se envía **SOLO cuando tú aceptas al participante** desde el panel de admin. El correo incluirá el código `RVC-XXXXXX` único del participante.

**1. Crea la cuenta**
- Entra a https://www.emailjs.com y regístrate gratis (incluye 200 correos/mes).

**2. Conecta tu correo**
- **Email Services** → **Add New Service** → elige Gmail (u otro) y conéctalo. Anota el **Service ID** (ej. `service_xxx`).

**3. Crea la plantilla del correo (ticket bonito)**
- **Email Templates** → **Create New Template**.
- En **To Email** pon: `{{to_email}}`
- En **Subject** pon: `🎫 Tu código de participante — Sorteo RVC Moto Eléctrica`
- Cambia el editor a modo **Code / HTML** y pega esta plantilla (más profesional que texto plano, se ve bien en cualquier cliente de correo):

```html
<div style="background:#f4f1e8;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4ddc9;">
    <tr>
      <td style="background:#1b3f37;padding:26px 28px;text-align:center;">
        <span style="color:#e7ddc7;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Sorteo RVC · Moto Eléctrica</span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 28px 8px;">
        <p style="margin:0 0 6px;color:#1b3f37;font-size:16px;">Hola <b>{{to_name}}</b>,</p>
        <p style="margin:0 0 22px;color:#4a4a44;font-size:14.5px;line-height:1.6;">
          ¡Tu participación en el Sorteo RVC de Moto Eléctrica ha sido <b>confirmada</b>!
          Compraste <b>{{cantidad}}</b> ticket(s) por un total de <b>S/{{total}}</b>. Estos son tus códigos de participante:
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 24px;text-align:center;">
        <div style="display:inline-block;background:#f4f1e8;border:2px dashed #1b3f37;border-radius:10px;padding:16px 28px;">
          <span style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;letter-spacing:1px;color:#1b3f37;line-height:1.8;">{{codes}}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 24px;color:#4a4a44;font-size:13.5px;line-height:1.7;">
        Guarda estos códigos, los necesitarás el día del sorteo.<br>
        📍 Ciudad: {{ciudad}}<br>
        📧 Correo: {{email}}<br>
        📱 Celular: {{tel}}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 30px;color:#8a8578;font-size:12px;line-height:1.6;border-top:1px solid #eee;padding-top:18px;">
        El sorteo se realizará ante notario público. Si resultas ganador te contactaremos
        por correo y por teléfono. ¡Mucha suerte!<br><br>
        — Equipo RVC Movilidad Eléctrica
      </td>
    </tr>
  </table>
</div>
```

- Guarda y anota el **Template ID** (ej. `template_xxx`).

**Variables disponibles en la plantilla:**
| Variable | Contenido |
|---|---|
| `{{to_name}}` | Nombre del participante |
| `{{to_email}}` | Correo electrónico |
| `{{codes}}` | Todos los códigos comprados, separados por coma (ej. RVC-482931, RVC-773421) |
| `{{code}}` | Igual a `{{codes}}` cuando compró un solo ticket (compatibilidad) |
| `{{cantidad}}` | Cantidad de tickets comprados |
| `{{total}}` | Monto total pagado (cantidad × S/10) |
| `{{ciudad}}` | Departamento |
| `{{tel}}` | Número de celular |

**4. Copia tu llave pública**
- **Account** → copia tu **Public Key**.

**5. Pega los tres valores en el archivo:**

```js
const EMAILJS = { serviceId:"service_xxx", templateId:"template_xxx", publicKey:"TU_PUBLIC_KEY" };
```

Desde ahora, cuando aceptes a un participante en el panel de admin, le llegará su ticket al correo automáticamente.

---

## Parte C — Validación automática del comprobante con IA (opcional, desactivada)

**Esta parte está desactivada por defecto** (`AUTO_VALIDATE = false`) por decisión propia: se prefiere revisar cada comprobante a mano por seguridad. El código y estas instrucciones se dejan documentados por si más adelante quieres activarla — no necesitas nada de esta sección para operar el sorteo en modo manual.

Esta parte hace que el sistema **lea el comprobante de Yape solo**, con una IA de visión (Claude), y si el monto, el destinatario y el número de operación calzan, aprueba al participante y le envía sus códigos al instante — sin que tú tengas que revisarlo a mano. Si algo no calza o la imagen no se puede leer con confianza, el registro queda "Pendiente" igual que antes, con una nota para que tú lo revises.

**Importante — léelo antes de activarlo:**
- Ninguna validación automática es 100% infalible: una captura editada con Photoshop puede engañar a una IA igual que podría engañarte a ti a simple vista. Por eso el sistema solo aprueba automáticamente cuando está razonablemente seguro, y deja todo lo dudoso para revisión manual — nunca aprueba "a ciegas".
- Tiene un costo mínimo: cada comprobante leído usa la API de Anthropic (Claude), que cobra una fracción de centavo por imagen. Para un sorteo de cientos de inscripciones el costo es de pocos dólares en total.
- Requiere un paso técnico adicional (desplegar una función en Supabase) — un poco más avanzado que copiar y pegar en el bloque CONFIGURACIÓN, pero se hace todo desde el navegador, sin instalar nada.

**1. Crea tu llave de la API de Anthropic (Claude)**
- Entra a https://console.anthropic.com y crea una cuenta.
- Ve a **API Keys** → **Create Key**. Cópiala (empieza con `sk-ant-...`) y guárdala, no se vuelve a mostrar.
- Agrega saldo (Billing) — con unos pocos dólares alcanza para todo el sorteo.

**2. Consigue tu clave privada de EmailJS (para que el correo se envíe sin que tú estés presente)**
- En https://www.emailjs.com → **Account** → **API Keys** → copia el **Private Key**.

**3. Crea la Edge Function en Supabase**
- En tu proyecto de Supabase, menú lateral → **Edge Functions** → **Create a new function**.
- Nómbrala exactamente: `validar-comprobante`.
- Abre el editor de código que aparece y reemplaza todo su contenido por el archivo `supabase/functions/validar-comprobante/index.ts` que viene junto a esta guía (ábrelo con cualquier editor de texto, copia todo, y pégalo en el editor de Supabase).
- Guarda y despliega (**Deploy**).

**4. Configura los secretos de la función**
- Menú lateral → **Edge Functions** → **Manage secrets** (o **Settings** → **Edge Functions**).
- Agrega estos secretos uno por uno:

| Nombre | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | Tu llave `sk-ant-...` del paso 1 |
| `EMAILJS_SERVICE_ID` | El mismo `service_xxx` de la Parte B |
| `EMAILJS_TEMPLATE_ID` | El mismo `template_xxx` de la Parte B |
| `EMAILJS_PUBLIC_KEY` | La misma Public Key de la Parte B |
| `EMAILJS_PRIVATE_KEY` | La Private Key del paso 2 |
| `YAPE_NUMERO` | `953127153` |
| `YAPE_TITULAR` | `Ricardo Cajachagua` |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles automáticamente dentro de la función — no los agregues tú mismo.

**5. Actívalo en el archivo `.html`**
- En el bloque CONFIGURACIÓN, deja `const AUTO_VALIDATE = true;` (ya viene así). Ponlo en `false` en cualquier momento si quieres volver a la revisión 100% manual sin tocar nada más.
- Los mismos `YAPE_NUMERO` y `YAPE_TITULAR` del bloque CONFIGURACIÓN son los que se muestran a los participantes en el formulario — mantenlos iguales a los que pusiste como secretos en el paso 4.

**Cómo probarlo:** regístrate tú mismo con un comprobante real de una Yapeada de prueba por el monto correcto. Si todo calza, en unos segundos deberías ver "¡Pago confirmado!" en pantalla y recibir el correo. Si quieres ver el caso "pendiente", sube una captura que no sea de Yape (por ejemplo una foto cualquiera) — debe quedar en Pendiente con una nota 🤖 en el panel explicando por qué.

**Ajustar qué tan estricta es la validación:** dentro de `index.ts`, la constante `CONFIANZA_MINIMA` (0.72 por defecto) controla qué tan segura debe estar la IA para aprobar solo. Súbela (ej. 0.85) si quieres que la IA sea más conservadora y mande más casos a revisión manual; bájala si quieres que apruebe más casos por sí sola.

---

## Bases y condiciones

Al hacer clic en "Bases" (menú superior, pie de página o el check de aceptación del formulario) se abre un cuadro emergente con el texto completo: organizador, requisitos para participar, mecánica del sorteo, notificación al ganador, protección de datos, etc. Para editarlo, busca `id="basesModal"` dentro del `.html` — es HTML normal, no hace falta tocar nada del bloque CONFIGURACIÓN.

**Es una plantilla general, no asesoría legal.** Antes de publicar el sorteo con dinero real de por medio, haz que un abogado la revise y confirme si tu sorteo necesita algún permiso o registro especial ante una autoridad peruana (depende del tipo y valor del premio), y ajusta la razón social / datos reales de tu empresa donde corresponda.

---

## Publicar la página

**Importante:** el sitio ahora usa fotos y videos reales de las motos que viven en la carpeta `assets/`, junto a `index.html`. Sube **toda la carpeta Sorteo_RVC** (o como mínimo `index.html` + `assets/` juntos, manteniendo esa misma estructura) — si subes solo el `.html` suelto, las motos no se van a ver.

Opciones de hosting gratuito: **Netlify Drop** (https://app.netlify.com/drop — arrastras la carpeta completa y listo), **Vercel** o **GitHub Pages**. Tu sorteo queda en línea con su propio enlace. Si consigues un dominio propio (ej. `sorteorvc.com`), estos tres hostings te dejan conectarlo gratis desde su panel — se ve más profesional que un subdominio genérico.

---

## Otros ajustes rápidos (bloque CONFIGURACIÓN)

```js
const ADMIN_USER = "admin";          // usuario del panel (solo se usa si NO configuras Supabase)
const ADMIN_PASS = "RvcSorteo2026";  // contraseña del panel (solo se usa si NO configuras Supabase) — cámbiala
const RAFFLE_DATE = {month:7, day:15, hour:20}; // fecha del sorteo (mes 7 = agosto; enero es 0)
const YAPE_NUMERO = "953 127 153";        // número Yape que se muestra a los participantes
const YAPE_TITULAR = "Ricardo Cajachagua"; // nombre del titular que se muestra a los participantes
const AUTO_VALIDATE = true;               // true = validación automática con IA (Parte C) · false = siempre manual
```

---

## Importante sobre seguridad (léelo)

Como la página no tiene servidor propio, la clave `anon` de Supabase y la llave pública de EmailJS viajan dentro del archivo — eso es **normal y seguro**, están diseñadas para ser públicas (por eso se llaman "anon"/"public key"): la protección real la dan las políticas de la base de datos (RLS), no el secreto de esa llave.

Lo que **sí era un problema real** es que antes la contraseña del panel de admin estaba escrita en texto plano en el `.html`, visible para cualquiera que abriera "Ver código fuente". Con Supabase Auth configurado (Parte A, paso 5) eso ya no ocurre: el login del panel se verifica contra Supabase, no contra un texto dentro del archivo. Mientras no configures Supabase, el sitio sigue funcionando en modo demo con `ADMIN_USER`/`ADMIN_PASS` — útil para probar, pero no para publicar con dinero real de por medio.
