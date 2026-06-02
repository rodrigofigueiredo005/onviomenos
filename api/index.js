// Entry-point serverless do Vercel: reaproveita o mesmo app Express.
// O vercel.json reescreve TODAS as rotas pra cá, então o Express trata
// estáticos (public/) e as rotas /api/* igual ao ambiente local.
import app from "../server.js";

export default app;
