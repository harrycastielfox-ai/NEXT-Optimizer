# NEXT — implantação Supabase em 13/09/2026

## Destino e escopo

Projeto autorizado: **NEXT OTIMIZAÇÃO**, `dtzyeinqcdjnzefgphcd`, `sa-east-1`, PostgreSQL 17. O proprietário confirmou que este projeto novo substitui o servidor antigo. Antes da implantação, não havia tabelas públicas, migrações nem Edge Functions. Nenhuma conta/licença antiga foi importada; o projeto antigo não foi modificado. Nenhum plano pago, VM ou certificado foi contratado.

Endpoint: `https://dtzyeinqcdjnzefgphcd.supabase.co`. O transporte Rust e a configuração pública padrão do frontend apontam para este destino. A chave `sb_publishable_` é pública e não concede administração. Credenciais `service_role` permanecem exclusivamente no runtime do servidor. Overrides de ambiente do frontend devem usar URL/chave do mesmo projeto; não alteram o host fixo do cliente nativo.

## Publicação

- `nex-license-session`: ACTIVE, versão 1, SHA256 do bundle `21ec2c0b64d15cc633df210de721105b04ec1128fc0fe387d6a66b6d43a02370`.
- `nex-license-admin`: ACTIVE, versão 1, SHA256 do bundle `143ec5700c67d1b6c22b979c94ae5bc8fd9a21385ae631f18710e00edf434c04`.
- Entrypoints, `deno.json`, `deno.lock` e dependência compartilhada publicados. `verify_jwt=false` usa autenticação própria (código/token/chave administrativa), não acesso administrativo anônimo.
- Dez migrações aplicadas. A última remove EXECUTE das quatro APIs OAuth antigas, concede leitura de histórico de transferências somente ao backend e adiciona três índices de chaves estrangeiras.

### Histórico remoto

O MCP atribui a versão no momento da aplicação, independentemente do timestamp do arquivo. Os SQLs foram enviados a partir dos arquivos locais, na ordem abaixo. Não reaplicar o bootstrap e não executar `supabase db push` sem reconciliar este histórico. Para futura adoção de CLI vinculada, conferir esquema/SQL e usar `migration repair` para alinhar somente os metadados, com backup; nunca usar reset em produção.

| Nome | Versão local | Versão remota |
| --- | --- | --- |
| create_nex_licensing_core | 20260716021847 | 20260913110805 |
| bind_entitlements_to_device | 20260716024641 | 20260913110809 |
| create_device_transfer_workflow | 20260716030742 | 20260913110813 |
| create_license_admin_api | 20260716032236 | 20260913110819 |
| add_nex_licensing_foreign_key_indexes | 20260716041036 | 20260913110822 |
| create_nex_license_admins | 20260716041840 | 20260913110827 |
| create_email_code_license_flow | 20260724165000 | 20260913110831 |
| create_license_admin_key_flow | 20260724172000 | 20260913110833 |
| harden_license_sessions | 20260912012737 | 20260913110836 |
| retire_legacy_license_rpcs | 20260913111002 | 20260913111108 |

## Verificações no serviço publicado

- `supabase/tests/license-sessions.sql`, removendo apenas a diretiva própria de psql `\set`, executado com rollback: grants/RLS, rate limit, ativação, e-mail incorreto, repetição sem estender assinatura, expiração, dispositivo diferente, transferência e revogação. Nenhuma fixture desse teste foi persistida.
- Smoke HTTP: **22 requisições aprovadas**, incluindo administração negada sem chave/com chave inválida; criação e listagem de código; leitura de transferências; ativação válida/inválida; verificação; bloqueio de outro dispositivo; repetição invalidando a sessão anterior; logout; transferência e revogação definitiva.
- Script reproduzível: `scripts/smoke-license-server.mjs --live-smoke <URL>`, usando Node em terminal interativo. Exige inserção autorizada do hash temporário impresso e entrada `{"ready":true}`. A chave é aleatória e existe somente na memória do processo; código e tokens não são impressos. Sempre remover apenas os IDs/predicados da fixture após sucesso ou falha. Não executar automaticamente em produção com clientes.
- Fixture desta execução: `24ccbd2b-44f8-4cac-8469-7aaa104eb54d`. Conta, código, sessões e chave administrativa temporários removidos. Contagem final dessas quatro categorias: **zero**. Auditorias e contadores de rate limit preservados.
- Advisors finais: **nenhum WARN/ERROR**. RLS sem política nas nove tabelas privadas é intencional (nega acesso dos clientes; somente backend autorizado). [Explicação do aviso informativo](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Índices sem uso ainda são esperados em banco novo; [orientação oficial](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Não abrir políticas nem remover índices apenas para silenciar INFO.

## Limites e próximos passos

Validação local desta alteração: `npm run typecheck`, `npm run lint`, 11 testes Node, `npm run build`, `npm run build:tauri` (somente frontend) e `git diff --check` aprovados. Os builds mantêm avisos de chunks grandes/imports mistos; não são erros de compilação. A compilação Rust/instaladores do commit novo deve ser acompanhada no CI da PR, não confundida com o build frontend local.

O servidor está publicado, mas isto não torna o app validado para lançamento comercial. Não foram executados o app, instaladores, alterações no Windows, reinícios nem DPAPI no computador pessoal. É necessário recompilar o cliente para consumir o novo host; pacotes antigos continuam apontando ao host anterior.

Falta definir o e-mail do operador definitivo e entregar sua chave administrativa por meio seguro, sem persistência em Git, logs ou conversa. Até lá, nenhuma pessoa possui chave permanente neste projeto. Também permanecem QA em outro Windows autorizado, assinatura comercial (decisão/custo do proprietário), loja/pagamentos e aprovação humana de release. Os preços/durações do banco reproduzem o catálogo existente; não foi configurada cobrança.
