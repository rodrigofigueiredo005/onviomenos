# CLAUDE.md

Orientações para o Claude (e humanos) ao manter este projeto.

## O que é

**OnvioMenos** é um app web leve e não-oficial para um funcionário ver/baixar seus próprios
documentos (holerites, férias, 13º, PLR, informe de rendimentos) do Domínio **"Para Você"**,
sem usar o app móvel oficial. Foi construído depois de descobrir, por engenharia reversa do
APK, os endpoints da API que o super app do funcionário usa.

## Arquitetura

Stack mínima, **sem build step**: Node + Express no back, HTML/CSS/JS puro no front.

```
onvio.js     → cliente da API do Onvio. Concentra todas as chamadas externas. As BASES da
               API vêm de env vars (ONVIO_AUTH_BASE / ONVIO_DOCS_BASE), lidas em tempo de
               chamada — nunca hardcoded (pra não vazar na busca do GitHub).
server.js    → Express. Sessão STATELESS em cookie assinado (cookie-session): guarda
               jwt+refresh no próprio cookie httpOnly, nunca expõe o jwt ao browser. Renova
               o jwt via refreshToken quando falta < 60s pra expirar (validToken()). Só chama
               app.listen() fora da Vercel; sempre exporta `app` como default.
api/index.js → entry-point serverless da Vercel; só reexporta o app de server.js.
vercel.json  → reescreve TODAS as rotas para api/index (Express trata estáticos + /api/*).
public/      → front estático servido pelo Express.
  index.html → áreas no mesmo documento: #loginView, #listView, #pdfModal, footer .bug-note.
  app.js      → estado em `allDocs` (docs do ano). loadHolerites() busca do server; render()
                aplica filtro de tipo + ordenação no cliente (lista de um ano é pequena).
                typeInfo()/TYPE_RULES mapeiam o `type` → rótulo PT-BR + ícone por keyword.
  style.css   → tema escuro, variáveis CSS em :root.
```

### Fluxo

1. `POST /api/login` (CPF+senha) → `onvio.login()` → guarda `{jwtToken, refreshToken, jwtExpiresAt}` na sessão (cookie).
2. `GET /api/holerites?year=` → `onvio.listDocuments()` → server mapeia snake_case → camelCase.
3. `GET /api/holerites/:id/pdf?year=` → `onvio.getDocumentLink()` (link S3) → `onvio.fetchPdf()` → stream.
   `?download=1` força `Content-Disposition: attachment`; senão `inline` (abre no `<iframe>`).

## Endpoints externos (Onvio)

Implementados em `onvio.js`. As **bases** ficam só nas env vars (ver `.env.example`); o código
e os docs versionados não contêm as URLs literais — de propósito, pra não serem indexados.

- **Auth (mobile do funcionário)** — base em `ONVIO_AUTH_BASE`: `POST /login`, `POST /token`.
  O login web comum do Onvio **rejeita** funcionário (`PRIMARY_PRODUCT_MISMATCHING`); por isso
  usa-se a base mobile.
- **Documentos** — base em `ONVIO_DOCS_BASE`: `GET /document?limit&year`,
  `GET /document/:id?year` (devolve `document_url` no S3, baixado sem auth).

Se algum endpoint mudar, **mexa só no `onvio.js`** (e nas env vars) — o resto não conhece a API externa.

## Convenções

- Mensagens de erro voltam pro usuário em **português**, amigáveis (ver `OnvioError` em `onvio.js`).
- `401` em qualquer chamada de documento → front volta pra tela de login.
- Tipos de documento: `TYPE_RULES` em `app.js`, casados por **palavras-chave** (não frase
  exata), em ordem (específico → genérico). Ex.: 13º com `advanc` = Adiantamento 13º antes do
  13º cheio. Tipo desconhecido degrada (rótulo derivado + ícone genérico 📄).
- Nada de credenciais persistidas; só tokens no cookie de sessão.

## Como rodar / testar

```bash
npm install
cp .env.example .env     # preencher ONVIO_AUTH_BASE, ONVIO_DOCS_BASE, SESSION_SECRET
npm start                # http://localhost:3000
PORT=3999 npm start      # outra porta
```

Smoke test rápido (sem login real):
```bash
curl -s localhost:3000/api/me                            # {"authenticated":false}
curl -s -o /dev/null -w "%{http_code}" localhost:3000/   # 200
```
Não há suíte de testes automatizada.

## Deploy

Vercel (ver `DEPLOY.md`). Sessão stateless → roda em serverless sem store externo. Definir
`ONVIO_AUTH_BASE`, `ONVIO_DOCS_BASE` e `SESSION_SECRET` nas env vars do projeto.

## Cuidados ao editar

- **Não** logar CPF, senha, jwt ou `document_url` (link S3 dá acesso ao PDF sem auth).
- **Não** hardcodar as URLs da API — sempre via env var (busca do GitHub não pode indexá-las).
- Em produção o cookie é `secure` (HTTPS) e `httpOnly`. O cookie é assinado, não criptografado.
- Artefatos de engenharia reversa (APK, `_apk/`, `_apktool/`, `_venv/`, logs, `.env`) **não**
  ficam no repo — já estão no `.gitignore`. Não recommitar.
- Dependências do app: `express`, `cookie-session`, `dotenv`. Evitar inflar.
