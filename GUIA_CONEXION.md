# Guía para conectar el sorteo RVC (guardar registros + enviar correos)

Tu página ya funciona como demo. Para que **los registros se guarden de verdad** y **los correos se envíen solos** una vez publicada en internet, conecta dos servicios gratuitos. Sigue los pasos en orden. Todo se configura en un solo lugar del archivo: el bloque **CONFIGURACIÓN**, cerca del final del `.html`.

---

## 🔑 Cómo entrar al panel de administrador

En el **pie de página** de tu web verás el texto discreto `· Administración`. Haz clic ahí. Se abrirá el panel de login:

- **Usuario:** `admin`
- **Contraseña:** `RvcSorteo2026` (cámbiala en el bloque CONFIGURACIÓN antes de publicar)

---

## ✅ Cómo funciona el flujo ahora

1. **Participante se registra** → queda en estado **Pendiente** (no recibe ningún correo todavía)
2. **Tú abres el panel** → ves la foto del comprobante de Yape
3. **Si el pago es válido** → haces clic en ✓ → se genera el código `RVC-XXXXXX` automáticamente y se envía al correo del participante
4. **Si el pago es falso** → haces clic en ✕ → queda como Rechazado

---

## Parte A — Guardar los registros (Supabase)

Supabase te da una base de datos y un almacén de imágenes gratis. Aquí se guardarán los datos de cada persona y la captura de su Yape.

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
  email text,
  tel text,
  dni text,
  ciudad text,
  code text default '',
  estado text default 'pendiente',
  comprobante_url text,
  fecha timestamptz default now()
);

alter table registros enable row level security;

-- Cualquiera puede inscribirse (insertar)
create policy "inscripcion_publica" on registros
  for insert to anon with check (true);

-- El panel puede leer y actualizar/eliminar
create policy "panel_lectura" on registros for select to anon using (true);
create policy "panel_update"  on registros for update to anon using (true);
create policy "panel_delete"  on registros for delete to anon using (true);
```

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

Listo: desde ahora cada inscripción se guarda en Supabase y la captura del Yape se sube al bucket. El panel de administrador leerá de ahí automáticamente.

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
- En el **cuerpo** (puedes usar HTML si activas el modo HTML) pon algo como:

```
Hola {{to_name}},

¡Tu participación en el Sorteo RVC de Moto Eléctrica ha sido CONFIRMADA!

Tu código de participante es:

  ✦  {{code}}  ✦

Guarda este código. Lo necesitarás el día del sorteo (28 de julio a las 8 PM).

Datos registrados:
  📍 Ciudad: {{ciudad}}
  📧 Email: {{email}}

El sorteo se realizará ante notario público. Si resultas ganador te contactaremos
por correo y por teléfono.

¡Mucha suerte!
— Equipo RVC Movilidad Eléctrica
```

- Guarda y anota el **Template ID** (ej. `template_xxx`).

**Variables disponibles en la plantilla:**
| Variable | Contenido |
|---|---|
| `{{to_name}}` | Nombre del participante |
| `{{to_email}}` | Correo electrónico |
| `{{code}}` | Código del ticket (ej. RVC-482931) |
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

## Publicar la página

Sube el archivo `.html` a cualquier hosting gratuito: **Netlify Drop** (https://app.netlify.com/drop — arrastras el archivo y listo), **Vercel** o **GitHub Pages**. Tu sorteo queda en línea con su propio enlace.

---

## Otros ajustes rápidos (bloque CONFIGURACIÓN)

```js
const ADMIN_USER = "admin";          // usuario del panel
const ADMIN_PASS = "RvcSorteo2026";  // contraseña del panel — cámbiala
const RAFFLE_DATE = {month:6, day:28, hour:20}; // fecha del sorteo (mes 6 = julio)
```

---

## Importante sobre seguridad (léelo)

Como la página no tiene un servidor propio, el usuario y la contraseña del panel, y la llave de Supabase, viajan dentro del archivo. Para un sitio público con datos personales y dinero de por medio esto tiene un límite real: alguien con conocimientos técnicos podría acceder a los datos. Para empezar el sorteo está bien, pero si crece, el siguiente paso correcto es proteger el panel con **inicio de sesión de Supabase (Supabase Auth)** y restringir la lectura solo a usuarios autenticados.
