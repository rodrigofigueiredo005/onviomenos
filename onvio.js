// Cliente da API do "Domínio Para Você" (super app do funcionário).
// Fluxo confirmado: login -> lista de documentos -> link pré-assinado S3 -> PDF.
//
// As bases da API NÃO ficam no código (pra não serem indexadas pela busca do GitHub):
// vêm das env vars ONVIO_AUTH_BASE e ONVIO_DOCS_BASE (ver .env / .env.example).
// Lidas em tempo de chamada pra não depender da ordem de carregamento do dotenv.
function authBase() {
  const v = process.env.ONVIO_AUTH_BASE;
  if (!v) throw new OnvioError("ONVIO_AUTH_BASE não configurada (ver .env).", 500);
  return v.replace(/\/$/, "");
}
function docsBase() {
  const v = process.env.ONVIO_DOCS_BASE;
  if (!v) throw new OnvioError("ONVIO_DOCS_BASE não configurada (ver .env).", 500);
  return v.replace(/\/$/, "");
}

// Erro com status HTTP pra propagar pro cliente.
class OnvioError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// POST /v1/auth/login -> { jwtToken, refreshToken, jwtTokenExpiration, refreshTokenExpiration }
export async function login(documentNumber, password) {
  const res = await fetch(`${authBase()}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentNumber, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || data.status !== 200 || !data.result?.jwtToken) {
    const msg =
      data?.result?.message ||
      data?.result?.error ||
      data?.message ||
      "CPF ou senha inválidos.";
    throw new OnvioError(msg, res.status === 401 || res.status === 400 ? 401 : 502);
  }
  return data.result;
}

// POST /v1/auth/token -> novo { jwtToken, refreshToken? } a partir do refreshToken
export async function refresh(refreshToken) {
  const res = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.result?.jwtToken) {
    throw new OnvioError("Sessão expirada. Faça login novamente.", 401);
  }
  return data.result;
}

// GET /document?limit&year -> array de documentos (holerites, informes, etc.)
export async function listDocuments(jwt, year, limit = 60) {
  const res = await fetch(`${docsBase()}/document?limit=${limit}&year=${encodeURIComponent(year)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (res.status === 401) throw new OnvioError("Sessão expirada.", 401);
  if (!res.ok) throw new OnvioError(`Falha ao listar documentos (HTTP ${res.status}).`);
  return res.json();
}

// GET /document/:id?year -> { document_url (S3 pré-assinado) } + filename no Content-Disposition
export async function getDocumentLink(jwt, id, year) {
  const res = await fetch(`${docsBase()}/document/${encodeURIComponent(id)}?year=${encodeURIComponent(year)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (res.status === 401) throw new OnvioError("Sessão expirada.", 401);
  if (!res.ok) throw new OnvioError(`Falha ao obter o documento (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data.document_url) throw new OnvioError("Documento sem URL de download.");
  return {
    url: data.document_url,
    filename: parseFilename(res.headers.get("content-disposition")) || `documento-${id}.pdf`,
  };
}

// Baixa o PDF da URL pré-assinada do S3 (sem auth) -> Buffer
export async function fetchPdf(documentUrl) {
  const res = await fetch(documentUrl);
  if (!res.ok) throw new OnvioError(`Falha ao baixar o PDF do S3 (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

function parseFilename(contentDisposition) {
  if (!contentDisposition) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i.exec(contentDisposition);
  return m ? decodeURIComponent(m[1]).trim() : null;
}
