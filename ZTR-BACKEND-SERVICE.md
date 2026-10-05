# Race Low Poly no ZTR Backend Cloud

Este repositório serve para duas coisas ao mesmo tempo:

1. GitHub Pages / site estático em `racelowpoly.ztrcompany.site`.
2. API Node.js hospedada no `backend.ztrcompany.site/#/services`.

## Repositório

`https://github.com/ZTRCOMPANY1/SITE-RACE-LOW-POLY.git`

## Cadastro do serviço no ZTR Backend Cloud

Use o repositório HTTPS acima e a branch `main`.

- Runtime: Node.js
- Build/install: `npm install --omit=dev`
- Start: `npm start`
- Porta: NÃO fixe uma porta no código. O servidor usa `process.env.PORT` fornecido pelo serviço.
- Health check: `/health`

## Variáveis de ambiente

Configure no serviço:

- `DATABASE_URL`: connection string do banco gerenciado pelo ZTR Cloud.
- `DB_SCHEMA=race_low_poly`
- `DB_SSL=false` para PostgreSQL local/interno; use `true` somente se a conexão do Cloud exigir SSL.
- `CORS_ORIGINS=https://racelowpoly.ztrcompany.site`
- `ADMIN_USER`: usuário administrativo.
- `ADMIN_PASS`: senha administrativa forte.
- `ADMIN_TOKEN_SECRET`: segredo aleatório longo para assinar os tokens administrativos.
- `HOST=127.0.0.1` (compatível com reverse proxy local do ZTR Backend Cloud).

## Banco

O projeto NÃO cria servidor PostgreSQL, usuário de Linux, PM2 próprio ou banco separado no sistema.
Ele usa a `DATABASE_URL` entregue pelo ZTR Cloud e cria somente o schema lógico `race_low_poly` e suas tabelas dentro da conexão configurada.

## Depois que o serviço ficar Online

O painel do ZTR Backend Cloud mostrará o link público da API. Abra `js/config.js` e substitua:

`https://COLE-AQUI-O-LINK-GERADO-PELO-ZTR-BACKEND`

pelo link real do serviço. Faça commit/push. O GitHub Pages passará a consumir a API hospedada no Armbian.

## Testes

- `GET <URL_DO_SERVICO>/health`
- abrir `https://racelowpoly.ztrcompany.site`
- verificar login/painel e atualizações

## Render

Não é necessário manter nenhum serviço no Render. As antigas URLs do Render não são usadas por esta versão.
