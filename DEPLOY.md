# Deploy do OnvioMenos

Recomendado: **Vercel**. O app é um servidor Express, e a Vercel roda Express como função
serverless quase sem ajuste. (Cloudflare **Pages** roda no runtime Workers, que não executa
Express/Node diretamente — exigiria reescrever o back-end; por isso ficou de fora.)

Como a sessão é **stateless** (guardada num cookie assinado por `cookie-session`), não há
estado em memória — funciona bem em serverless, onde cada requisição pode cair numa instância
diferente.

## O que já está no repo

- `api/index.js` — entry-point serverless que reexporta o mesmo app de `server.js`.
- `vercel.json` — reescreve **todas** as rotas para `api/index`, então o Express trata
  estáticos (`public/`) e as rotas `/api/*` igual ao ambiente local.
- `server.js` — só chama `app.listen()` fora da Vercel (local); na Vercel apenas exporta o app.

Nenhuma mudança de código é necessária para publicar.

## Opção A — painel (mais simples)

1. Suba o projeto para um repositório no GitHub.
2. Acesse <https://vercel.com> e faça login (pode usar a conta do GitHub).
3. **Add New… → Project** e importe o repositório `onviomenos`.
4. A Vercel detecta Node automaticamente. Não precisa configurar build nem output.
5. Em **Environment Variables**, adicione (os mesmos valores do seu `.env`):
   - `ONVIO_AUTH_BASE`
   - `ONVIO_DOCS_BASE`
   - `SESSION_SECRET` — gere um valor forte:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
6. Clique em **Deploy**. Ao terminar, a URL `https://<seu-projeto>.vercel.app` já serve o app.

A cada `git push` na branch principal, a Vercel publica de novo automaticamente.

## Opção B — CLI

```bash
npm i -g vercel
vercel login

# na raiz do projeto:
vercel            # cria o projeto e faz um deploy de preview

# defina as variáveis (repita para cada uma; escolha os ambientes Production/Preview):
vercel env add ONVIO_AUTH_BASE
vercel env add ONVIO_DOCS_BASE
vercel env add SESSION_SECRET

vercel --prod     # publica em produção
```

## Verificando após o deploy

```bash
curl -s https://<seu-projeto>.vercel.app/api/me      # {"authenticated":false}
```

Depois abra a URL no navegador e faça login com o seu CPF/senha.

## Observações

- O cookie de sessão é `httpOnly` e, em produção, `secure` (só trafega sob HTTPS — a Vercel
  serve HTTPS por padrão). O `jwt` não fica acessível ao JavaScript do browser.
- O cookie carrega `jwt + refreshToken`; é assinado (não falsificável), porém **não**
  criptografado. Para um app pessoal sob HTTPS isso é aceitável. Se quiser blindar mais,
  dá pra criptografar o conteúdo da sessão antes de gravar.
- Se trocar o `SESSION_SECRET`, todas as sessões abertas são invalidadas (todo mundo
  precisa logar de novo).
- Domínio próprio: **Settings → Domains** no projeto da Vercel.
