# Política de Privacidade do Halyard Browser

**Última atualização:** 7 de novembro de 2026

Esta política explica quais dados o Halyard Browser ("Halyard", "nós") trata, por quê e quais são os seus direitos, de acordo com a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).

**Controlador dos dados:** Yan, desenvolvedor do Halyard.
**Contato do encarregado (DPO):** halyardbrowser@gmail.com

## 1. O resumo

- **Seu histórico, favoritos, abas, senhas digitadas e downloads ficam só no seu computador.** O Halyard não tem servidor que receba o que você navega.
- **Não vendemos, alugamos nem compartilhamos dados para publicidade.** O Halyard não tem anúncios nem rastreadores próprios.
- **A conta é opcional.** Sem conta, o Halyard não envia nenhum dado pessoal para nós.

## 2. Dados que ficam apenas no seu computador

Histórico, favoritos, abas e espaços, configurações, permissões de sites, lista de downloads, cookies e dados dos sites que você visita, e o modelo de IA local (com tudo o que você conversa com ele). Esses dados ficam na pasta do Halyard no seu usuário do Windows. Os cookies são gravados criptografados. Você pode apagar tudo em **Configurações › Privacidade › Limpar dados**, ou com o botão de pânico.

## 3. Dados que tratamos quando você cria uma conta

| Dado | Para quê | Base legal (LGPD) |
|---|---|---|
| E-mail | Identificar a conta, entrar e recuperar a senha | Execução de contrato (art. 7º, V) |
| Senha | Entrar na conta. Guardamos só um hash (bcrypt), nunca a senha em si | Execução de contrato |
| Nome de exibição, idioma e tema | Sincronizar suas preferências entre computadores | Execução de contrato |
| Data de criação e de alteração | Segurança e suporte | Legítimo interesse (art. 7º, IX) |

A conta usa o **Supabase** (Supabase Inc.) como provedor de autenticação e banco de dados. Cada pessoa só consegue ler e alterar a própria linha (segurança em nível de linha). **Nenhum dado de navegação é enviado para a conta.**

## 4. Serviços de terceiros que o Halyard contata

Para funcionar e proteger você, o Halyard fala com alguns serviços. Nenhum deles recebe seu histórico.

| Serviço | Quando | O que recebe |
|---|---|---|
| **Provedor de DNS seguro** (Cloudflare, Quad9 ou Google, à sua escolha) | Sempre que você abre um site | O nome do site (é assim que todo navegador encontra o endereço). Você pode trocar ou desligar. |
| **Mecanismo de busca** escolhido (DuckDuckGo por padrão) | Quando você pesquisa ou com sugestões ligadas | O que você digita na barra de endereço |
| **Ghostery / listas de bloqueio** | Uma vez por dia | Nada pessoal: só baixa as listas |
| **malware-filter (GitLab)** | A cada 12 horas | Nada pessoal: só baixa as listas de sites perigosos |
| **Have I Been Pwned** | Quando você digita uma senha num site, se a verificação estiver ligada | Só os 5 primeiros caracteres do hash SHA-1 da senha (k-anonimato). A senha nunca sai do computador. |
| **Google Tradutor** | Só quando você pede para traduzir uma página | O endereço da página |
| **Hugging Face** | Só quando você baixa o modelo de IA | Nada pessoal: só baixa o arquivo |
| **GitHub** | Para procurar atualizações do Halyard | Nada pessoal: a versão instalada é comparada com a mais nova |
| **Microsoft Defender** (no seu PC) | Ao baixar programas, scripts e arquivos compactados | O Defender roda no seu computador e pode consultar a nuvem da Microsoft, conforme as configurações do Windows |

Todos esses serviços têm políticas próprias. Recomendamos ler as que você usar.

## 5. Por quanto tempo guardamos

Os dados da conta ficam guardados enquanto a conta existir. Quando você pede a exclusão pelo e-mail de contato, apagamos a conta e o perfil em até 15 dias. Os dados locais ficam no seu computador até você apagar.

## 6. Seus direitos (art. 18 da LGPD)

Você pode pedir a qualquer momento: confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação, portabilidade, informação sobre com quem compartilhamos, e revogação do consentimento. Basta escrever para **halyardbrowser@gmail.com**. Respondemos em até 15 dias. Você também pode reclamar na Autoridade Nacional de Proteção de Dados (ANPD).

## 7. Segurança

Usamos conexões criptografadas (HTTPS e TLS 1.2 ou superior), senhas com hash, cookies criptografados no disco, chaves de acesso públicas com segurança por linha no banco e o princípio do menor privilégio. Nenhum sistema é 100% seguro. Se houver um incidente que possa causar risco ou dano relevante, avisaremos você e a ANPD.

## 8. Crianças

O Halyard não é direcionado a menores de 13 anos, e não criamos contas sabendo que são de crianças. Adolescentes devem usar a conta com autorização dos responsáveis.

## 9. Transferência internacional

Alguns provedores (como o Supabase e os serviços da seção 4) podem processar dados fora do Brasil. Nesses casos, a transferência segue o art. 33 da LGPD, com provedores que oferecem garantias adequadas de proteção.

## 10. Mudanças nesta política

Se esta política mudar de forma relevante, avisaremos dentro do navegador antes de a mudança valer. A data no topo indica a última versão.
