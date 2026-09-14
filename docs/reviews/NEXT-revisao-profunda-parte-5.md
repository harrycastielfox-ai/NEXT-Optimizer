# NEXT — revisão profunda, parte 5: banco de licenciamento

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo e conclusão

Revisão estática das migrações de licenciamento, com leitura integral da migração de sessões e da aposentadoria de RPCs antigas, das definições administrativas relacionadas, das permissões declaradas ao longo da sequência e dos testes SQL existentes. Três achados: ordem inconsistente de locks, auditoria administrativa incompleta e transferência sem idempotência.

Não conectei ao banco, consultei clientes, apliquei SQL ou executei testes de mutação. As conclusões descrevem o código do repositório, não certificam a configuração efetiva de produção. Não houve alteração de código, migração ou infraestrutura. Os cenários concorrentes abaixo precisam ser reproduzidos em banco isolado com dados sintéticos; não foram executados nesta etapa.

As skills Supabase e PostgreSQL orientaram a análise de privilégios e ordem de locks. Consultei o changelog e as referências oficiais; as mudanças recentes consultadas sobre extensões e introspecção GraphQL não justificam alteração neste fluxo de revisão.

## E01 — P1: revogação e ativação podem entrar em deadlock

Em [20260912012737_harden_license_sessions.sql:144](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/supabase/migrations/20260912012737_harden_license_sessions.sql:144), a ativação bloqueia primeiro o código e depois a conta (158). A transferência segue a mesma ordem (248–253). Já a revogação administrativa bloqueia primeiro a conta (206), altera entitlement/sessões e só depois atualiza os códigos relacionados (211).

Intercalação possível para uma conta e seu código já resgatado:

1. Ativação mantém o lock do código.
2. Revogação mantém o lock da conta.
3. Ativação espera a conta.
4. Revogação espera o código.

O PostgreSQL resolve um deadlock abortando uma das transações, não escolhendo necessariamente preservar a revogação. Isso protege atomicidade, mas pode fazer a operação administrativa falhar e deixar a licença ativa se ela for a transação abortada. A regra é documentada em [PostgreSQL 17 — deadlocks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-DEADLOCKS).

Os handlers atualmente convertem erro de RPC em negação genérica (nex-license-admin/index.ts:164–165 e nex-license-session/index.ts:76–82), sem distinguir conflito transitório. Não afirmo corrupção de dados nem licença duplicada: o problema é confiabilidade da revogação sob concorrência.

Proposta: protocolo único de serialização por conta, incluindo primeira ativação, renovação, transferência e revogação; ordem consistente para todos os locks. Considerar retry limitado de transação inteira para erros transitórios, somente após resolver idempotência e preservar a distinção entre falha operacional e autorização negada.

Teste proposto: duas conexões com barreiras determinísticas, uma reativando código já resgatado e outra revogando a mesma conta. Repetir transferência versus revogação. Verificar ausência de ciclo de espera e resultado final coerente, sem esconder falha administrativa.

## E02 — P2: auditoria não vincula operador e conta afetada na mesma operação

A tabela `license_security_audit` possui `action`, `outcome`, `actor_id` e timestamp, mas não alvo nem ID de correlação. Na [revogação, linha 212](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/supabase/migrations/20260912012737_harden_license_sessions.sql:212), `actor_id` recebe o operador e a conta revogada não é registrada. Na transferência (262), o mesmo campo recebe a conta afetada e não o operador.

O handler grava antes da RPC outro evento `admin/allowed` com o operador (nex-license-admin/index.ts:102), mas sem ação administrativa específica, conta ou identificador compartilhado. Como essas gravações ocorrem em requisições/transações separadas, proximidade de horário não é uma associação confiável em chamadas simultâneas. O evento `allowed` também pode existir quando a mutação posterior falha.

Consequência: os registros próprios dessas operações não respondem de forma inequívoca “qual operador transferiu/revogou qual conta”. Não significa que não exista auditoria: ela existe, mas tem semântica ambígua e incompleta. A tabela administrativa antiga tem campos de alvo, porém as novas RPCs de transferência/revogação não a utilizam.

Proposta: evento transacional com operador, conta-alvo, operação específica, resultado e ID de correlação; separar tentativa autorizada de operação efetivamente concluída. Não registrar código de compra, token ou chave em texto puro. Adaptar o limite de transferências para consultar um campo de alvo explícito, sem sobrecarregar `actor_id`.

Teste proposto: dois operadores agem simultaneamente sobre duas contas; cada resultado precisa apontar para seu operador e alvo corretos. Uma RPC rejeitada não deve produzir evento de sucesso.

## E03 — P2: repetir transferência para o mesmo dispositivo consome cota e revoga sessões

Em [20260912012737_harden_license_sessions.sql:253](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/supabase/migrations/20260912012737_harden_license_sessions.sql:253), depois de bloquear a conta, a transferência verifica licença e limite, atualiza dispositivo, revoga sessões e grava `admin/reviewed`. Não compara o dispositivo atual com o solicitado nem recebe chave de idempotência.

Cenário: a transferência foi confirmada no banco, mas a resposta se perdeu. O operador repete o pedido com o mesmo código e destino. O código continua resgatado e a conta continua ativa; a operação volta a contar como transferência, mesmo sem mudança de dispositivo. Três chamadas assim atingem o limite de três eventos em 30 dias (256–258). Se o cliente já reativou entre tentativas, sua nova sessão também é revogada pela repetição.

Proposta: chave de idempotência associada ao operador, conta e payload, com retorno do resultado anterior. Definir retorno sem alteração para destino já vinculado e política separada caso o operador realmente queira revogar sessões nesse dispositivo. Não remover o limite como correção.

Teste proposto: repetir exatamente a transferência após sucesso, simular resposta perdida e reativação entre tentativas. A repetição não deve consumir nova cota nem invalidar sessão criada depois, salvo ação explícita distinta.

## Permissões e proteções encontradas

- As tabelas novas de sessão, rate limit e auditoria ativam RLS e revogam acesso de `PUBLIC`, `anon` e `authenticated`; as RPCs novas também revogam execução dessas roles e concedem ao `service_role`.
- As novas RPCs são `SECURITY INVOKER` com `search_path` vazio. Como o serviço privilegiado pode contornar RLS, a autorização dos handlers e os checks das RPCs continuam essenciais. A [documentação Supabase de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) explica essa diferença; RLS não substitui proteger a credencial de serviço.
- As funções administrativas antigas examinadas usam `SECURITY DEFINER`, mas têm grants restritos e verificam o papel de serviço. Sua presença em `public` não é, sozinha, evidência de execução pública indevida.
- A migração final revoga os caminhos antigos de mutação de usuário. A antiga assinatura `redeem_license_code(text)` já havia sido removida pela migração de vinculação de dispositivo; não foi confundida com função ainda exposta.
- Ativação exige correspondência de email atribuído, código, dispositivo e estado; bloqueia linhas e cria a sessão na mesma transação. Reusar código resgatado não acrescenta novamente os dias do plano.
- Revogação altera entitlement, sessões e códigos já resgatados na mesma transação. Transferência exige operador ativo, prova do código resgatado e entitlement vigente; invalida sessões anteriores.
- Verificação confere expiração da sessão e do entitlement, token não revogado e correspondência de dispositivo na sessão e conta.
- O contador de rate limit usa UPSERT atômico em RPC separada da ativação; a falha de resgate não desfaz o contador.

Essas constatações são sobre as definições revisadas. Não foi feita comparação com grants efetivos, políticas extras, owner das funções ou drift em produção.

## Testes existentes e lacunas

`supabase/tests/license-sessions.sql` já verifica exemplos de privilégios, RLS habilitado, limite de tentativas, ativação, repetição sem extensão duplicada, expiração, dispositivo incorreto, transferência e revogação. O arquivo executa uma sequência em uma única transação e termina em rollback. Essa cobertura é útil, mas não reproduz duas conexões concorrentes, resposta HTTP perdida ou associação da auditoria entre chamadas.

Não executei esse arquivo no banco do usuário: ele insere e altera dados, ainda que sintéticos e com rollback. Os próximos testes devem rodar no ambiente isolado de CI já previsto no projeto, sem instalação de VM ou serviço pago.

## Decisão de produto a esclarecer

Ao resgatar um código novo, a ativação calcula prazo sobre o `expires_at` anterior mesmo se o entitlement estava revogado (163–167). Os códigos já resgatados são revogados, mas um código novo ainda disponível pode reativar a conta. Definir se revogação significa apenas cancelar a licença atual ou banir a conta, e se saldo cancelado deve ser reaproveitado. Não classifiquei automaticamente isso como bypass: depende da política comercial e da emissão autorizada do novo código.

## Entrega e continuidade

Único arquivo criado: este relatório, fora do repositório do produto. HEAD mantido; `src/routeTree.gen.ts` já modificado foi preservado. Sem commit, push, migração, consulta a clientes ou custo contratado.

Próximo bloco: atualização e distribuição — configuração Tauri, permissões, assinatura, origem dos downloads, CI e critérios de publicação. Depois consolidar achados, cobertura pendente e ordem de correções. A revisão geral continua aberta; não há certificação de segurança ou liberação de beta real nesta entrega.
