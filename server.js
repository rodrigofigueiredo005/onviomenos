import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as onvio from "./onvio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// Atrás do proxy da Vercel o TLS termina na borda e o request chega como HTTP.
// Sem isto, req.protocol fica "http" e a lib `cookies` recusa (silenciosamente!)
// gravar o cookie `secure` em produção → toda sessão morre com 401.
app.set("trust proxy", 1);

app.use(express.json());
// Sessão guardada no próprio cookie (assinado) — stateless, funciona em serverless
// (Vercel/Cloudflare), onde não há memória persistente entre invocações.
app.use(
  cookieSession({
    name: "onviomenos",
    keys: [process.env.SESSION_SECRET || "onviomenos-dev-secret-troque-em-prod"],
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // HTTPS em produção; http no dev local
    maxAge: 1000 * 60 * 60 * 8,
  })
);
app.use(express.static(join(__dirname, "public")));

// Só dígitos (o usuário pode digitar CPF com pontos/traço).
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

// Garante um jwt válido na sessão, renovando via refreshToken se estiver perto de expirar.
async function validToken(req) {
  const s = req.session.onvio;
  if (!s?.jwtToken) {
    const e = new Error("Não autenticado.");
    e.status = 401;
    throw e;
  }
  // renova se faltam menos de 60s pro jwt expirar
  if (Date.now() > s.jwtExpiresAt - 60_000) {
    const r = await onvio.refresh(s.refreshToken);
    s.jwtToken = r.jwtToken;
    if (r.refreshToken) s.refreshToken = r.refreshToken;
    s.jwtExpiresAt = Date.now() + (r.jwtTokenExpiration || 900) * 1000;
  }
  return s.jwtToken;
}

function handleError(res, err) {
  const status = err.status || 502;
  if (status === 401) res.status(401).json({ error: err.message || "Sessão expirada." });
  else res.status(status).json({ error: err.message || "Erro inesperado." });
}

// --- Auth ---
app.post("/api/login", async (req, res) => {
  try {
    const cpf = onlyDigits(req.body.cpf);
    const senha = req.body.senha || "";
    if (cpf.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos." });
    if (!senha) return res.status(400).json({ error: "Informe a senha." });

    const r = await onvio.login(cpf, senha);
    req.session.onvio = {
      jwtToken: r.jwtToken,
      refreshToken: r.refreshToken,
      jwtExpiresAt: Date.now() + (r.jwtTokenExpiration || 900) * 1000,
    };
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/me", (req, res) => {
  res.json({ authenticated: !!req.session.onvio?.jwtToken });
});

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// --- Documentos ---
app.get("/api/holerites", async (req, res) => {
  try {
    const year = onlyDigits(req.query.year) || new Date().getFullYear();
    const jwt = await validToken(req);
    const docs = await onvio.listDocuments(jwt, year);
    const items = (Array.isArray(docs) ? docs : []).map((d) => ({
      id: d._id,
      reference: d.reference,
      type: d.type,
      group: d.group,
      clientName: d.client_name,
      employeeName: d.employee_name,
      publishedAt: d.published_at,
      viewedAt: d.viewed_at,
    }));
    res.json({ year: Number(year), items });
  } catch (err) {
    handleError(res, err);
  }
});

// Streama o PDF: ?download=1 força baixar; senão abre no navegador.
app.get("/api/holerites/:id/pdf", async (req, res) => {
  try {
    const year = onlyDigits(req.query.year) || new Date().getFullYear();
    const jwt = await validToken(req);
    const { url, filename } = await onvio.getDocumentLink(jwt, req.params.id, year);
    const pdf = await onvio.fetchPdf(url);
    const disp = req.query.download ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disp}; filename="${filename.replace(/"/g, "")}"`);
    res.send(pdf);
  } catch (err) {
    handleError(res, err);
  }
});

// Em serverless (Vercel) o app é importado por api/index.js e NÃO escuta porta.
// Localmente (`npm start`) sobe o servidor normalmente.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`OnvioMenos rodando em http://localhost:${PORT}`);
  });
}

export default app;
