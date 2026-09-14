# NEXT — revisão profunda, parte 3: orquestração e resultados

Data: 13/09/2026. Commit: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Conclusão e limites

A revisão encontrou quatro problemas nos contratos entre execução, cancelamento e relatório. O aplicativo possui verificações finais úteis, mas elas não substituem tratar corretamente cada retorno antes de continuar o fluxo. Ainda recomendo resolver os problemas prioritários antes de beta com alterações reais.

Revisão estática de `optimize-all.ts`, trechos do executor `quick-prepare.ts`, modais de otimização, catálogo de auditoria, verificação de execução, wrappers de motores e retornos nativos relacionados. Não é uma auditoria concluída de todo o repositório. Não executei app, instaladores, otimizações ou testes que alterem o Windows. Nenhum código de produção foi modificado. Os testes abaixo são propostas, não validações já executadas.

P1: corrigir antes de beta com alterações reais. P2: corrigir a fidelidade do comportamento/relatório. As consequências são cenários sustentados pelo fluxo do código; não incidentes observados no PC do proprietário.

## C01 — P1: falha retornada como resultado não interrompe a sequência

[startup.rs:325](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/startup.rs:325) contabiliza falhas e tenta rollback, mas retorna `Ok(StartupApplyResult)` em 384–398, incluindo `failed_items` e mensagem de possível rollback parcial. Isso é um contrato válido desde que o consumidor examine o resultado.

O wrapper [startup.ts:130](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/lib/startup.ts:130) devolve esse resultado diretamente. Em `optimize-all.ts`, `runStartupPhase` não bloqueia ao encontrar `failedItems`; no modal, [SmartOptimizeModal.tsx:367](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/components/optimization/SmartOptimizeModal.tsx:367) marca qualquer tarefa resolvida como concluída. O laço 276–293 segue para a próxima fase. O executor atual de preparação também devolve `status: "completed"` para Startup (quick-prepare.ts:579–587), Performance (599–606) e Advanced (626–633), sem uma decisão baseada nos estados individuais nesses pontos.

Consequência: uma falha de Startup, inclusive com recuperação incompleta, pode ser seguida por novas alterações. Lançar erro de transporte interrompe o fluxo real; retornar um objeto contendo falha não recebe o mesmo tratamento. Uma eventual advertência no relatório final chega depois dessa decisão.

Proposta: resultado discriminado compartilhado — sucesso, sem alteração, parcial, falha e recuperação incompleta — e política explícita de parada antes da próxima mutação. Preservar os dados estruturados e IDs de recuperação ao interromper; não apenas converter tudo em uma mensagem de erro.

Teste proposto: backend falso retorna `failedItems=1`, com rollback completo e depois parcial. Nenhuma fase mutante seguinte deve começar sem uma política explícita que permita continuar.

## C02 — P2: contadores de seleção/tentativa viram contadores de sucesso

[optimize-all.ts:455](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/lib/optimize-all.ts:455) usa `closedProcesses.length` para dizer quantos processos foram fechados. O vetor nativo inclui também resultados `skipped` e `failed` (gamer.rs:1249–1271). A interface repete esse cálculo em [SmartOptimizeModal.tsx:757](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/components/optimization/SmartOptimizeModal.tsx:757). Startup usa `selectedItems` como quantidade aplicada (730), em vez de distinguir `changedItems`, `skippedItems` e `failedItems`. Limpeza usa `plannedEntries` como aplicada (714).

Além disso, [optimize-audit-catalog.ts:513](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/lib/optimize-audit-catalog.ts:513) monta ações a partir do catálogo da fase; `auditStatus` atribui `applied` a ações implementadas de uma fase concluída no modo real (540–557), sem receber os resultados individuais. Isso é mais forte do que a evidência disponível.

Exemplo determinístico: três processos selecionados, dois sem janela e um fechado produzem vetor de comprimento três; a mensagem afirma três fechados, embora só um tenha esse status. Não é necessário executar processos para testar essa diferença.

A verificação final existente sinaliza ações sem confirmação específica e `hasExecutionIssues` considera essas pendências. Portanto, não afirmo que o relatório inteiro sempre termina verde. O defeito é a contagem e atribuição de execução indevidas, mesmo quando acompanhadas por alertas em outra parte.

Proposta: derivar números e estados dos resultados individuais; separar planejado, tentado, aplicado, revertido, pulado e falho. Um estado observado já correto deve ser distinguido de uma alteração feita nesta execução.

Teste proposto: vetores mistos, seleção vazia, todas as ações puladas e falha seguida de rollback. Conferir mensagens, contadores e exportação, não apenas o aviso final.

## C03 — P2: consolidação substitui resultados anteriores e perde a identidade da execução

[SmartOptimizeModal.tsx:284](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/components/optimization/SmartOptimizeModal.tsx:284) agrega relatórios por spread superficial. As fases de componentes e Advanced escrevem a mesma propriedade `advancedResult` em `optimize-all.ts`. A posterior substitui a anterior. Ao detalhar o relatório, [SmartOptimizeModal.tsx:1095](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/components/optimization/SmartOptimizeModal.tsx:1095) consulta somente `reports.advancedResult` e indexa por ID de ação, não por fase/tentativa. Os resultados próprios de foco Gamer e GPU não são consumidos por essa função.

Consequência: uma ação repetida entre fases pode receber o resultado da última tentativa em registros de outra fase; falha anterior seguida de sucesso deixa de ser representada fielmente nesse detalhamento. Resultados não presentes no último lote permanecem com o estado genérico derivado do catálogo. Isso não significa que todos os logs nativos foram apagados: a perda ocorre na consolidação da execução exibida.

Proposta: diário append-only por execução, fase, tentativa e ação; preservar snapshots e resultado de rollback. Gerar o resumo a partir desse diário, sem reaproveitar apenas o último objeto de cada engine.

Teste proposto: mesma ação falha na fase de componentes e funciona na fase Advanced; ambas as tentativas devem aparecer com seus próprios resultados. Incluir falha no foco Gamer que não aparece no último lote Advanced.

## C04 — P1: cancelar durante uma fase não impede novas mutações dentro dela

[SmartOptimizeModal.tsx:416](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/components/optimization/SmartOptimizeModal.tsx:416) registra o cancelamento e informa que aguardará a ação atual terminar. A checagem acontece antes/depois da fase (279, 290), mas `runOptimizeAllPhase` não recebe token ou callback de cancelamento.

Uma fase contém várias operações independentes. Exemplo: [gamer-dependencies.ts:503](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/lib/gamer-dependencies.ts:503) aguarda download e depois inicia instalação, sem checar cancelamento. Em `optimize-all.ts`, a fase Gamer também executa o motor Gamer e depois o pacote de foco. O backend de dependências percorre todos os pacotes selecionados sem token por operação.

Se o usuário cancelar durante o download, a instalação ainda pode começar após o download terminar. Isso não é apenas aguardar uma instalação já iniciada acabar: permite iniciar uma nova ação mutante depois do pedido. O comportamento real é “parar entre fases”, mais amplo que a mensagem de “ação atual”.

Proposta: cancelamento cooperativo entre cada unidade mutante, propagado ao backend para lotes; nunca matar à força um instalador em andamento só para fechar o modal. Exibir qual operação precisa terminar e impedir novos comandos após o pedido.

Teste proposto: downloads e comandos controlados por promises/executores falsos; solicitar cancelamento enquanto o download está pendente, resolvê-lo e confirmar que a instalação não é invocada. Repetir entre Gamer e pacote de foco e entre dois instaladores.

## Concorrência: lacuna a validar, sem alegar reprodução

A busca nos motores nativos não encontrou uma trava compartilhada de execução/recuperação; os Mutex encontrados estão ligados a sessão de licença e estado do companion. Advanced despacha aplicações por `spawn_blocking` (advanced.rs:334–363). Os controles dos modais são locais ao componente, não evidência de exclusão mútua no backend. Duas chamadas concorrentes precisam de teste controlado para verificar interferência e preservação de snapshots.

Encontrei também um `Promise.all` de mutações em `runWindowsPhase` (quick-prepare.ts:916), mas a busca em `src` não encontrou consumidor da função exportada legada `runQuickPreparePhase`. Por isso, não trato esse trecho como prova de concorrência no fluxo atual. A perda potencial de histórico por escrita concorrente já está registrada na parte 1; não a contabilizo novamente.

Teste futuro: dois pedidos de aplicação, e aplicação simultânea a restauração, usando backend falso ou armazenamento temporário isolado. Esperado: rejeição explícita por operação em andamento ou fila serializada, não comandos concorrentes sobre os mesmos recursos.

## Proteções que devem ser preservadas

- Cancelamento mantém o modal ocupado enquanto aguarda o retorno, em vez de prometer interrupção imediata do processo nativo.
- Erros lançados interrompem a otimização real e geram relatório parcial com aviso de possíveis alterações anteriores.
- Verificação final distingue confirmado, não confirmado e indisponível.
- `hasExecutionIssues` inclui falhas, cancelamento, ações não implementadas e verificações pendentes.
- O cache local trata falha de gravação como não fatal. Sua existência não foi usada como prova de estado atual do Windows nesta revisão.

## Próxima etapa

Revisar autenticação/licenciamento e fronteiras de confiança: persistência de sessão, expiração, logout, modo offline, autorização dos comandos e configurações de segurança. Depois revisar atualização/distribuição e consolidar a cobertura ainda pendente. Qualquer trabalho envolvendo Supabase deverá seguir a skill correspondente e começar em modo somente leitura; esta etapa não acessou nem alterou o serviço.

Único arquivo criado: este relatório fora do repositório. HEAD preservado; alteração preexistente em `src/routeTree.gen.ts` intocada. Sem commit, push, publicação ou custo contratado.
