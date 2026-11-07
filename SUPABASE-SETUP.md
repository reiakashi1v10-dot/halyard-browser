# Ligar as contas do Halyard (Supabase)

O Halyard já está pronto para contas de verdade. Falta só criar o seu projeto no Supabase (é grátis para começar) e colocar dois códigos públicos no app. Leva uns 10 minutos.

## 1. Criar o projeto

1. Entre em https://supabase.com e crie sua conta.
2. Clique em **New project**. Dê um nome (ex.: `halyard-browser`), crie uma senha forte para o banco (guarde num lugar seguro, o app **não** usa essa senha) e escolha a região **South America (São Paulo)**.

## 2. Criar a tabela (com segurança)

1. No menu da esquerda, abra **SQL Editor** → **New query**.
2. Copie tudo do arquivo `supabase/schema.sql` desta pasta, cole e clique em **Run**.

Isso cria a tabela `profiles` com **RLS ligado**: cada pessoa só consegue ler e mudar os próprios dados, e quem não entrou na conta não vê nada.

## 3. Conferir o login por email

Em **Authentication → Sign In / Providers → Email**:

- **Email** ligado.
- **Confirm email** ligado (o padrão). Assim ninguém cria conta com o email dos outros.
- Em **Minimum password length**, coloque **8**.

Em **Authentication → URL Configuration**, o **Site URL** é a página que abre depois que a pessoa clica no link de confirmação. Se ainda não tiver um site do Halyard, pode deixar como está: a conta é confirmada do mesmo jeito.

## 4. Pegar os dois códigos públicos

Em **Project Settings → API Keys**:

- **Project URL**: algo como `https://abcdefgh.supabase.co`
- **Publishable key**: começa com `sb_publishable_`

> ⚠️ **Nunca** use a **secret key** (`sb_secret_...`) nem a antiga `service_role`. Elas passam por cima de toda a segurança do banco, e qualquer pessoa conseguiria tirá-las de dentro do `.exe`. O Halyard se recusa a funcionar com elas, e a geração do `.exe` também para com um erro se alguém tentar.

## 5. Colocar no Halyard

Na pasta do projeto, copie o arquivo `.env.example` para um arquivo chamado `.env` e preencha:

```
MAIN_VITE_SUPABASE_URL=https://abcdefgh.supabase.co
MAIN_VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Depois gere o `.exe` de novo (`npm run dist`), ou peça ao Claude para fazer isso.

## Antes de lançar para muita gente

- **Email próprio (SMTP):** o envio de email que vem grátis no Supabase é só para testes e manda poucos emails por hora. Para usuários de verdade, ligue um serviço de email (ex.: Resend, Postmark, Amazon SES) em **Authentication → Emails → SMTP Settings**.
- **Advisors:** em **Advisors → Security Advisor**, confira se não aparece nenhum alerta.
- **Plano:** projetos grátis pausam depois de uma semana sem uso. Para um produto no ar, use o plano pago.

## Como a segurança funciona no Halyard

- A senha vai direto do app para o Supabase (HTTPS) e **nunca é salva** no computador.
- A sessão (o "você está logado") fica salva **criptografada** com a proteção do Windows, num arquivo que só o seu usuário do Windows consegue abrir.
- Os sites que você visita e as páginas do Halyard nunca têm acesso à sua sessão: tudo roda na parte interna do app.
- Só nome, idioma e tema vão para a nuvem. Histórico, favoritos e sites visitados ficam só no seu PC.
