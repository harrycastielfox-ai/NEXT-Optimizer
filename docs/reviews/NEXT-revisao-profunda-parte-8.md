# NEXT — revisão profunda, parte 8: perfis, reparação e agendamento

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo e conclusão

Revisão estática do orquestrador de perfis, centro de reparação e central de tarefas. Há dois problemas novos na composição dos perfis. Não encontrei criação de tarefas agendadas do Windows nem executor de SFC/DISM no centro de reparação: ambos são representações/leituras locais nesta versão.

Não executei perfis, diagnóstico, benchmark, SFC, DISM, PowerShell, tarefas do Windows ou testes com alterações. Nenhuma tarefa foi criada/removida e nenhum arquivo do produto foi modificado. P1 deve ser resolvido antes de perfis reais; P2 corrige fidelidade e recuperação. Problemas dos motores filhos referenciados abaixo permanecem nos relatórios anteriores e não são considerados resolvidos.

## H01 — P1: perfil transforma resultados parcialmente falhos em sucesso e prossegue

Cada wrapper de engine recebe um `Ok(result)` e registra o estado somente com base em ser dry-run ou não: Performance em [profiles.rs:344–353](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/profiles.rs:344), Advanced em 385–393, Startup em 438–446, Clean em 480–488 e Gamer em 526–534. Nenhum inspeciona ações internas falhas, puladas, bloqueadas, recuperação parcial ou verificação ausente.

O motor Startup, por exemplo, retorna `Ok(StartupApplyResult)` mesmo com `failed_items` e rollback tentado; esse contrato foi demonstrado na parte 3. O perfil registra “Applied”, `has_profile_failure` só procura esse estado (567–571) e então continua a próxima engine (219–265). O mesmo padrão se aplica a Advanced, Clean, Performance e Gamer quando devolvem estrutura com falhas sem lançar erro.

Consequência: um perfil pode desativar parte da inicialização, receber retorno com falha/rollback parcial, marcar a etapa aplicada e seguir para limpeza ou fechamento de processos. Isso reapresenta C01 em uma orquestração nativa que pode ser chamada sem a interface. Não é uma nova hipótese de erro de transporte: é perda de semântica dos resultados já estruturados.

Proposta: adaptador único que converte cada retorno em `completed`, `no_change`, `partial`, `failed` ou `rollback_incomplete`; parar imediatamente antes de nova mutação quando a política exigir. Preservar as ações individuais e IDs de snapshots no resultado do perfil.

Teste proposto: fake de cada engine retorna um resultado com uma ação falha e `Ok(...)`. O perfil não pode chamar a engine seguinte; seu resultado deve identificar a etapa parcial e o estado do rollback.

## H02 — P1: rollback de perfil não verifica nem propaga recuperação incompleta

Quando há falha, [profiles.rs:546](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/profiles.rs:546) percorre snapshots ao contrário. Para cada retorno do Restore Engine, apenas formata `result.message` (553–556); não inspeciona `result.applied`, resultados por ação, conflitos, ações não suportadas ou puladas. O evento de log pode falhar e interromper o próprio loop via `?` (557–563).

Assim, uma restauração parcial pode não alterar o resultado retornado pelo perfil, e um erro ao gravar evento pode impedir que snapshots restantes sejam tentados. O texto final diz apenas que rollback “foi tentado” (271–272), sem listar quais estados permaneceram alterados. Esse comportamento compõe os problemas A01, A02, A05 e A07, mas é uma falha adicional de decisão/propagação no orquestrador de perfil.

Proposta: registrar rollback como resultado estruturado por snapshot, continuar tentativas mesmo se a telemetria falhar e retornar `rollbackIncomplete` se qualquer inverso falhar, for conflitante, não suportado ou não confirmado. A interface deve impedir que o perfil seja anunciado como concluído em tal estado.

Teste proposto: três snapshots falsos — sucesso, conflito e falha de escrita de evento. Conferir que todos os restores são tentados, que o perfil conserva a lista de pendências e que nenhuma mensagem diz “restaurado” sem evidência.

## Perfil recomendado: divergência de estado — P2

O arquivo de “perfil recomendado” é gravado antes de executar engines em [profiles.rs:205–206](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/profiles.rs:205), inclusive em dry-run, e falha de persistência é descartada. Se uma aplicação real falhar e seu rollback for incompleto, a recomendação permanece como se representasse o perfil selecionado, sem estado de execução, IDs de snapshot ou pendências. O arquivo não concede acesso a engines, portanto não é bypass de autorização.

Proposta: registrar seleção e execução como estados distintos; atualizar recomendação após resultado final ou incluir explicitamente `failed`/`partial` e referências de recuperação. Escrita atômica e preservação de histórico seguem o pacote A04/A05.

Teste proposto: perfil falha na segunda engine; arquivo local não deve ser apresentado como perfil aplicado/recomendado limpo.

## Agendamento e reparação: comportamento efetivo verificado

- `HermesSchedulerCenter.tsx` usa apenas `localStorage`. Frequências são avaliadas quando esse componente monta e enquanto a página permanece aberta. Não encontrei `schtasks`, Task Scheduler, serviço residente, cron ou comando nativo de agendamento neste bloco.
- As tarefas oferecidas são benchmark, diagnósticos, scans e relatórios. `executeTask` chama leituras/benchmark; não chama aplicação de perfil, Clean apply, Startup apply ou Advanced apply. Uma rotina vencida não continua depois que o app fecha.
- Há uma pequena condição de corrida de interface: `runningTaskId` é estado React; duas chamadas muito próximas podem enxergar o valor anterior e iniciar leituras em paralelo. Como as tarefas atuais são de leitura, não classifiquei como P1. Se no futuro forem adicionadas mutações, uma fila/backend compartilhado será obrigatória antes de reutilizar essa central.
- `HermesRepairCenter` confirma e cria apenas snapshot/histórico para SFC/DISM; os comandos exibidos não são executados no arquivo examinado. Chamar isso de “reparo concluído” seria enganoso, mas os textos atuais dizem “preparado” e “comando não executado”.

## Próxima cobertura

Este bloco não revisou integralmente anti-cheat/Defender, diagnóstico/benchmark/Advisor, argumentos IPC gerais, deep links, companion ou preferências/captura de erros. Próximo bloco recomendado: **anti-cheat, Defender e catálogo de reparos sensíveis**, rastreando escopo de exclusões, privilégios, comandos e retorno de estado.

Único arquivo criado: este relatório fora do repositório. HEAD e a mudança preexistente em `src/routeTree.gen.ts` permanecem intocados. Sem build, testes, commit, push, agendamento ou alterações no Windows.
