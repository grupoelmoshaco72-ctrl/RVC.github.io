// Supabase Edge Function: validar-comprobante
//
// Valida automáticamente un comprobante de Yape usando IA de visión (Claude).
// Si el monto, el destinatario y el número de operación calzan con lo esperado,
// aprueba al participante, genera sus códigos y le envía el correo.
// Si algo no calza o no se puede leer con confianza suficiente, deja el
// registro como "pendiente" (con una nota) para que el admin lo revise a mano.
// Nunca lanza un error visible al participante: cualquier falla cae en modo
// "pendiente para revisión manual", que es el comportamiento seguro por defecto.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const EMAILJS_SERVICE_ID = Deno.env.get("EMAILJS_SERVICE_ID") ?? "";
const EMAILJS_TEMPLATE_ID = Deno.env.get("EMAILJS_TEMPLATE_ID") ?? "";
const EMAILJS_PUBLIC_KEY = Deno.env.get("EMAILJS_PUBLIC_KEY") ?? "";
const EMAILJS_PRIVATE_KEY = Deno.env.get("EMAILJS_PRIVATE_KEY") ?? "";

const YAPE_NUMERO = (Deno.env.get("YAPE_NUMERO") ?? "953127153").replace(/\D/g, "").slice(-9);
const YAPE_TITULAR = Deno.env.get("YAPE_TITULAR") ?? "Ricardo Cajachagua";
const PRECIO_TICKET = 10;
const CONFIANZA_MINIMA = 0.72;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function normaliza(s: string) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
}

function nombreCoincide(leido: string) {
  const a = normaliza(leido), b = normaliza(YAPE_TITULAR);
  if (!a || !b) return false;
  const partesB = b.split(" ").filter((p) => p.length > 2);
  const coincidencias = partesB.filter((p) => a.includes(p)).length;
  return coincidencias >= Math.min(2, partesB.length);
}

function generarCodigos(n: number) {
  const set = new Set<string>();
  while (set.size < n) set.add("RVC-" + String(Math.floor(100000 + Math.random() * 899999)));
  return [...set];
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function marcarPendiente(id: string, nota: string) {
  try {
    await sbFetch(`registros?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ai_nota: nota }),
    });
  } catch (e) {
    console.warn("marcarPendiente:", e);
  }
}

async function enviarCorreo(meta: any, codes: string[]) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) return false;
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: meta.email,
        to_name: meta.nombre,
        code: codes.join(", "),
        codes: codes.join(", "),
        cantidad: meta.cantidad || 1,
        total: (meta.cantidad || 1) * PRECIO_TICKET,
        email: meta.email,
        name: meta.nombre,
        ciudad: meta.ciudad,
        tel: meta.tel,
      },
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { id } = await req.json();
    if (!id) return json({ ok: false, error: "falta id" }, 400);

    const rows = await sbFetch(`registros?id=eq.${encodeURIComponent(id)}&select=*`);
    const r = rows[0];
    if (!r) return json({ ok: false, error: "no encontrado" }, 404);
    if (r.estado !== "pendiente") return json({ ok: true, autoverificado: false, motivo: "ya procesado" });
    if (!r.comprobante_url) return json({ ok: true, autoverificado: false, motivo: "sin comprobante" });
    if (!ANTHROPIC_API_KEY) return json({ ok: true, autoverificado: false, motivo: "IA no configurada" });

    // 1) Descargar la imagen del comprobante
    const imgRes = await fetch(r.comprobante_url);
    if (!imgRes.ok) {
      await marcarPendiente(id, "No se pudo descargar la imagen del comprobante");
      return json({ ok: true, autoverificado: false, motivo: "no se pudo leer la imagen" });
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    let binary = "";
    for (const b of buf) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const mediaType = imgRes.headers.get("content-type")?.includes("png") ? "image/png" : "image/jpeg";

    // 2) Pedirle a Claude que lea el comprobante
    const montoEsperado = (r.cantidad || 1) * PRECIO_TICKET;
    const prompt = `Analiza esta captura de pantalla de un pago por Yape (app peruana de pagos). Responde SOLO con un JSON válido, sin texto adicional ni markdown, con estas claves exactas:
{"es_yape": boolean, "monto": number, "destinatario_nombre": string, "destinatario_telefono": string, "operacion": string, "confianza": number}
- "monto": el monto pagado en soles, solo el número (ej. 20, no "S/20").
- "destinatario_nombre": el nombre de quien RECIBIÓ el pago, tal como aparece en la captura.
- "destinatario_telefono": los dígitos del celular del destinatario si aparecen, o "" si no aparecen.
- "operacion": el número o código de operación/transacción si aparece, o "" si no aparece.
- "confianza": qué tan seguro estás de haber leído bien TODOS los datos anteriores, de 0 a 1.
Si la imagen no es una captura de Yape o no puedes leerla con claridad, responde {"es_yape": false, "monto": 0, "destinatario_nombre": "", "destinatario_telefono": "", "operacion": "", "confianza": 0}.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    if (!aiRes.ok) {
      await marcarPendiente(id, "IA no disponible (" + aiRes.status + ")");
      return json({ ok: true, autoverificado: false, motivo: "IA no disponible" });
    }
    const aiJson = await aiRes.json();
    const text = (aiJson?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : "{}");

    // 3) Validar contra lo esperado
    const motivos: string[] = [];
    if (!parsed.es_yape) motivos.push("no se reconoció como comprobante de Yape");

    const montoOk = Math.abs(Number(parsed.monto || 0) - montoEsperado) < 0.5;
    if (!montoOk) motivos.push(`monto leído S/${parsed.monto ?? "?"} (se esperaba S/${montoEsperado})`);

    const telLimpio = String(parsed.destinatario_telefono || "").replace(/\D/g, "");
    const telOk = telLimpio.length >= 7 && telLimpio.slice(-9) === YAPE_NUMERO;
    const nombreOk = nombreCoincide(parsed.destinatario_nombre || "");
    if (!telOk && !nombreOk) motivos.push("no se pudo confirmar el destinatario del pago");

    const confianzaOk = Number(parsed.confianza || 0) >= CONFIANZA_MINIMA;
    if (!confianzaOk) motivos.push("confianza de lectura baja");

    let operacionOk = true;
    const operacion = String(parsed.operacion || "").trim();
    if (operacion) {
      const dup = await sbFetch(
        `registros?operacion_id=eq.${encodeURIComponent(operacion)}&id=neq.${encodeURIComponent(id)}&select=id`,
      );
      if (dup.length > 0) {
        operacionOk = false;
        motivos.push("este número de operación ya fue usado en otro registro");
      }
    }

    const aprobado = parsed.es_yape && montoOk && (telOk || nombreOk) && confianzaOk && operacionOk;

    if (!aprobado) {
      await marcarPendiente(id, "IA: " + motivos.join("; "));
      return json({ ok: true, autoverificado: false, motivo: motivos.join("; ") });
    }

    // 4) Aprobar: generar códigos, guardar y enviar correo
    const codes = generarCodigos(r.cantidad || 1);
    await sbFetch(`registros?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        estado: "verificado",
        code: codes.join(", "),
        operacion_id: operacion || null,
        ai_nota: "Auto-verificado por IA",
      }),
    });
    const enviado = await enviarCorreo(r, codes).catch(() => false);

    return json({ ok: true, autoverificado: true, enviado });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 200);
  }
});
