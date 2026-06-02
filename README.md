# OnvioMenos

App web leve e não-oficial para ver e baixar seus **holerites, férias, 13º, PLR e informes
de rendimentos** do Domínio **"Para Você"** (o super app do funcionário) — direto do navegador,
sem precisar abrir o app oficial.

- 🔐 Login com o mesmo **CPF + senha** do app oficial
- 📅 Lista por **ano**, com filtro por **tipo** e **ordenação**
- 👁️ Abre o **PDF** no próprio app e permite **baixar**
- 🟢 Marca documentos ainda **não visualizados**
- 🎨 Interface escura, responsiva, sem build step

> Projeto pessoal. Acessa as **suas próprias** informações, com as **suas** credenciais.
> Sem afiliação com a Thomson Reuters / Domínio.

## Stack

Node + Express no back-end (proxy autenticado + stream do PDF), HTML/CSS/JS puro no front
(`public/`, sem framework e sem build). Sessão **stateless** em cookie assinado
(`cookie-session`) — por isso roda tanto local quanto em serverless (Vercel).

## Rodando localmente

Requer Node 18+.

```bash
npm install
cp .env.example .env     # preencha os valores (ver abaixo)
npm start                # http://localhost:3000
```

### Variáveis de ambiente

Definidas em `.env` no local (ver `.env.example`) e no painel do provedor em produção.

| Var               | Obrigatória | Descrição                                                        |
| ----------------- | :---------: | ---------------------------------------------------------------- |
| `ONVIO_AUTH_BASE` |     sim     | Base da API de **autenticação** do funcionário                   |
| `ONVIO_DOCS_BASE` |     sim     | Base da API de **documentos** do funcionário                     |
| `SESSION_SECRET`  |  recomendada| Segredo que assina o cookie de sessão (use algo longo/aleatório) |
| `PORT`            |     não     | Porta local (default `3000`)                                     |

Os endpoints ficam **fora do código de propósito** (em env vars), pra não serem indexados
pela busca de código do GitHub. Quem tem acesso ao app sabe quais são; o repositório público não os expõe.

## Como funciona

```
Browser ──► Express (este app) ──► API do Onvio
   │            │  guarda jwt+refresh no cookie de sessão (httpOnly, assinado)
   │            │  renova o jwt automaticamente quando perto de expirar
   └─ PDF ◄─────┘  baixa da URL S3 pré-assinada e streama pro browser
```

O CPF/senha **não** são armazenados — viram tokens que ficam só no cookie de sessão e
somem ao sair ou expirar. O `jwt` nunca é exposto ao JavaScript do browser.

### Rotas internas (este app)

| Método | Rota                       | Descrição                                      |
| ------ | -------------------------- | ---------------------------------------------- |
| POST   | `/api/login`               | `{ cpf, senha }` → cria a sessão               |
| GET    | `/api/me`                  | `{ authenticated }`                            |
| POST   | `/api/logout`              | encerra a sessão                               |
| GET    | `/api/holerites?year=`     | lista os documentos do ano                     |
| GET    | `/api/holerites/:id/pdf`   | streama o PDF (`?download=1` força download)   |

### Endpoints externos (API do Onvio)

Implementados em [`onvio.js`](./onvio.js). As bases vêm das env vars; abaixo só os **caminhos**.

**Autenticação** (relativo a `ONVIO_AUTH_BASE`):

| Método | Rota     | Corpo                          | Retorno                                                                              |
| ------ | -------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| POST   | `/login` | `{ documentNumber, password }` | `{ result: { jwtToken, refreshToken, jwtTokenExpiration, refreshTokenExpiration } }` |
| POST   | `/token` | `{ refreshToken }`             | `{ result: { jwtToken, refreshToken? } }`                                            |

- `documentNumber` = CPF só com dígitos (11 chars).
- O login do **funcionário** exige essa base mobile; o login web comum do Onvio rejeita
  funcionário com `PRIMARY_PRODUCT_MISMATCHING`.

**Documentos** (relativo a `ONVIO_DOCS_BASE`, exigem `Authorization: Bearer <jwtToken>`):

| Método | Rota            | Query           | Retorno                                                                                  |
| ------ | --------------- | --------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/document`     | `limit`, `year` | Array de documentos (campos abaixo)                                                      |
| GET    | `/document/:id` | `year`          | `{ document_url }` (link S3 pré-assinado) + nome do arquivo no `Content-Disposition`     |

O PDF em si é baixado direto da `document_url` (S3 pré-assinado, **sem** auth).

**Campos relevantes de cada documento:**

```jsonc
{
  "_id": "...",
  "reference": "2026-05-01T00:00:00Z",   // mês/ano de competência
  "type": "PAYSLIP_MONTHLY",             // ver tipos abaixo
  "client_name": "...",                  // empresa
  "employee_name": "...",
  "published_at": "...",
  "viewed_at": null                      // null = ainda não visualizado
}
```

### Tipos de documento

Mapeados para PT-BR em `public/app.js` (`TYPE_RULES`):

| `type` (forma observada)                | Rótulo                 |
| --------------------------------------- | ---------------------- |
| `payslip monthly`                       | Holerite mensal        |
| `vacation payment`                      | Férias                 |
| `payslip thirteenth salary full`        | 13º salário            |
| `payslip thirteenth salary advancement` | Adiantamento 13º       |
| `payslip profit sharing`                | PLR                    |
| `income earnings`                       | Informe de rendimentos |

O casamento é por **palavras-chave** (não frase exata): o `type` é normalizado
(minúsculo, separadores → espaço) e classificado por regras ordenadas. Assim
`...THIRTEENTH...ADVANCEMENT`, `...thirteenth...advance` e `...13...advance` caem todos em
**Adiantamento 13º**, enquanto o 13º cheio fica em **13º salário**. Tipos não mapeados
aparecem no filtro com rótulo derivado do nome.

## Deploy (Vercel)

O app já vem pronto pra Vercel: `api/index.js` reaproveita o mesmo Express e o `vercel.json`
reescreve todas as rotas pra ele. Como a sessão é stateless (cookie), funciona em serverless.

1. Suba o repositório para o GitHub.
2. Em [vercel.com](https://vercel.com) → **Add New… → Project** → importe o repo.
3. Em **Environment Variables**, adicione `ONVIO_AUTH_BASE`, `ONVIO_DOCS_BASE` e
   `SESSION_SECRET` (os mesmos valores do seu `.env`).
4. **Deploy**. Pronto — a URL `*.vercel.app` serve o app.

Passos detalhados (inclusive via CLI) estão em [`DEPLOY.md`](./DEPLOY.md).

## Estrutura

```
onvio.js          cliente da API do Onvio (login, refresh, listar, baixar PDF)
server.js         Express: sessão em cookie, proxy autenticado, stream do PDF
api/index.js      entry-point serverless (Vercel) que reexporta o app
vercel.json       reescreve todas as rotas para o app
.env.example      modelo das variáveis de ambiente
public/           front-end estático (sem build)
  index.html      telas de login, lista e modal de PDF
  app.js          login, filtros, ordenação, visualizador, mapa de tipos
  style.css       tema escuro
  favicon.svg     ícone
```

## Reportar bugs

Abra uma issue: <https://github.com/rodrigofigueiredo005/onviomenos/issues>
