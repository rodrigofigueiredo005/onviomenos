const $ = (sel) => document.querySelector(sel);

const loginView = $("#loginView");
const listView = $("#listView");

let allDocs = []; // documentos do ano atual (sem filtro/ordenação aplicados)

// ---------------- helpers ----------------
async function api(path, opts) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw { status: res.status, message: body?.error || `Erro ${res.status}` };
  return body;
}

function show(view) {
  loginView.hidden = view !== "login";
  listView.hidden = view !== "list";
}

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function refLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || "—";
  return `${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// Tipos de documento → rótulo PT-BR + ícone, por PALAVRAS-CHAVE (não frase exata).
// Casar por keyword é resiliente a variações do `type` da API: funciona com
// "PAYSLIP_THIRTEENTH_SALARY_ADVANCEMENT", "payslip thirteenth advance",
// "Payslip-13-Advancement" etc. A ORDEM importa — regras mais específicas primeiro
// (ex.: 13º com adiantamento antes do 13º "cheio", e antes do adiantamento salarial).
const TYPE_RULES = [
  { test: (n) => /(thirteen|13)/.test(n) && /advanc/.test(n), label: "Adiantamento 13º", icon: "🗓️" },
  { test: (n) => /(thirteen|13)/.test(n), label: "13º salário", icon: "🎁" },
  { test: (n) => /(vacation|feria)/.test(n), label: "Férias", icon: "🏖️" },
  { test: (n) => /(profit\s*sharing|plr)/.test(n), label: "PLR", icon: "📈" },
  { test: (n) => /(income|earning|rendiment)/.test(n), label: "Informe de rendimentos", icon: "📊" },
  { test: (n) => /(monthly|mensal)/.test(n), label: "Holerite mensal", icon: "💵" },
  { test: (n) => /(termination|rescis)/.test(n), label: "Rescisão", icon: "📑" },
  { test: (n) => /advanc/.test(n), label: "Adiantamento salarial", icon: "💵" },
];

function normType(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function typeInfo(t) {
  const n = normType(t);
  if (!n) return { label: "Documento", icon: "📄" };
  const rule = TYPE_RULES.find((r) => r.test(n));
  if (rule) return { label: rule.label, icon: rule.icon };
  // desconhecido: rótulo derivado do nome, ícone genérico
  return { label: n.replace(/^\w/, (c) => c.toUpperCase()), icon: "📄" };
}

function typeLabel(t) { return typeInfo(t).label; }
function typeIcon(t) { return typeInfo(t).icon; }

function maskCpf(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

// ---------------- login ----------------
$("#cpf").addEventListener("input", (e) => { e.target.value = maskCpf(e.target.value); });

$("#togglePw").addEventListener("click", () => {
  const inp = $("#senha");
  inp.type = inp.type === "password" ? "text" : "password";
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#loginSubmit");
  const err = $("#loginError");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Entrando…";
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpf: $("#cpf").value, senha: $("#senha").value }),
    });
    $("#senha").value = "";
    await enterList();
  } catch (e2) {
    err.textContent = e2.message || "Não foi possível entrar.";
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  allDocs = [];
  show("login");
});

// ---------------- lista ----------------
function buildYearOptions() {
  const sel = $("#yearSelect");
  if (sel.options.length) return;
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 6; y--) {
    const o = document.createElement("option");
    o.value = o.textContent = y;
    sel.appendChild(o);
  }
  sel.addEventListener("change", loadHolerites);
  $("#typeSelect").addEventListener("change", render);
  $("#sortSelect").addEventListener("change", render);
}

async function enterList() {
  show("list");
  buildYearOptions();
  await loadHolerites();
}

function showSkeletons(n = 4) {
  $("#docList").innerHTML = Array.from({ length: n }, () => '<div class="skeleton"></div>').join("");
}

async function loadHolerites() {
  const status = $("#listStatus");
  const year = $("#yearSelect").value;
  status.textContent = "Carregando…";
  showSkeletons();
  try {
    const { items } = await api(`/api/holerites?year=${year}`);
    allDocs = items || [];
    refreshTypeOptions();
    render();
  } catch (e) {
    if (e.status === 401) { show("login"); return; }
    allDocs = [];
    $("#docList").innerHTML = "";
    status.textContent = e.message || "Erro ao carregar.";
  }
}

// Popula o filtro de tipo com os tipos presentes no ano carregado.
function refreshTypeOptions() {
  const sel = $("#typeSelect");
  const current = sel.value;
  const types = [...new Set(allDocs.map((d) => d.type).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos os tipos</option>';
  for (const t of types) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = typeLabel(t);
    sel.appendChild(o);
  }
  // mantém a seleção anterior se ainda existir
  sel.value = types.includes(current) ? current : "";
}

// Aplica filtro de tipo + ordenação e renderiza.
function render() {
  const status = $("#listStatus");
  const list = $("#docList");
  const year = $("#yearSelect").value;
  const typeFilter = $("#typeSelect").value;
  const sort = $("#sortSelect").value;

  let docs = allDocs.filter((d) => !typeFilter || d.type === typeFilter);

  docs.sort((a, b) => {
    if (sort === "type") return (a.type || "").localeCompare(b.type || "") || (b.reference || "").localeCompare(a.reference || "");
    const cmp = (a.reference || "").localeCompare(b.reference || "");
    return sort === "ref_asc" ? cmp : -cmp;
  });

  if (!allDocs.length) {
    list.innerHTML = `<div class="empty"><span class="big">📭</span>Nenhum documento neste ano.</div>`;
    status.textContent = "";
    return;
  }
  if (!docs.length) {
    list.innerHTML = `<div class="empty"><span class="big">🔍</span>Nenhum documento para esse tipo.</div>`;
    status.textContent = `0 de ${allDocs.length} documento(s)`;
    return;
  }

  status.textContent =
    docs.length === allDocs.length
      ? `${docs.length} documento(s)`
      : `${docs.length} de ${allDocs.length} documento(s)`;

  list.innerHTML = "";
  for (const it of docs) {
    const card = document.createElement("div");
    card.className = "doc";
    const isNew = !it.viewedAt;
    const pdfUrl = `/api/holerites/${it.id}/pdf?year=${year}`;
    card.innerHTML = `
      <div class="doc-icon">${typeIcon(it.type)}</div>
      <div class="doc-info">
        <div class="doc-title">
          ${isNew ? '<span class="dot-new" title="Não visualizado"></span>' : ""}
          <strong>${refLabel(it.reference)}</strong>
        </div>
        <span class="doc-sub">${typeLabel(it.type)}${it.clientName ? " · " + it.clientName : ""}</span>
      </div>
      <div class="doc-actions">
        <button class="btn-sm view">👁 <span class="label">Ver</span></button>
        <a class="btn-sm ghost" href="${pdfUrl}&download=1" download title="Baixar">⬇</a>
      </div>`;
    card.querySelector(".view").addEventListener("click", () =>
      openPdf(pdfUrl, `${refLabel(it.reference)} — ${typeLabel(it.type)}`, `${pdfUrl}&download=1`)
    );
    list.appendChild(card);
  }
}

// ---------------- visualizador ----------------
function openPdf(url, title, downloadUrl) {
  $("#pdfTitle").textContent = title;
  $("#pdfDownload").href = downloadUrl;
  $("#pdfLoading").hidden = false;
  const frame = $("#pdfFrame");
  frame.onload = () => { $("#pdfLoading").hidden = true; };
  frame.src = url;
  $("#pdfModal").hidden = false;
}
function closePdf() {
  $("#pdfModal").hidden = true;
  $("#pdfFrame").src = "about:blank";
}
$("#pdfClose").addEventListener("click", closePdf);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#pdfModal").hidden) closePdf();
});

// ---------------- bootstrap ----------------
(async () => {
  try {
    const { authenticated } = await api("/api/me");
    if (authenticated) await enterList();
    else show("login");
  } catch {
    show("login");
  }
})();
