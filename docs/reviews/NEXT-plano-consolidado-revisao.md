# NEXT — consolidação da revisão e plano de conclusão

Data: 13/09/2026. Base comum: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Decisão atual

Ainda não recomendo beta com alterações reais nem distribuição pública. O motivo principal não é falta de funções: há lacunas em recuperação, seleção de alvos, tratamento de falhas e identidade dos instaladores. Acrescentar funções agora aumentaria a superfície a validar.

Os seis relatórios registram **31 achados: 17 P1 e 14 P2**. São registros de revisão estática, não 31 incidentes observados nem necessariamente 31 causas independentes. Alguns compartilham a mesma correção estrutural. Nenhum deles foi corrigido ou encerrado nesta rodada de revisão. As decisões de produto e hipóteses de concorrência não classificadas nos relatórios não entram nessa contagem.

Este documento organiza o trabalho; não autoriza automaticamente implementação, execução no Windows, publicação ou mudanças no Supabase. Não há estimativa de prazo nem percentual de auditoria concluída sem conhecer o restante do código e o esforço de validação.

## Fontes

- [Parte 1 — execução e recuperação](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-1.md): A01–A10.
- [Parte 2 — Gamer, Startup e dependências](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-2.md): B01–B08.
- [Parte 3 — orquestração e resultados](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-3.md): C01–C04.
- [Parte 4 — sessão e autorização](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-4.md): D01–D02.
- [Parte 5 — banco de licenciamento](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-5.md): E01–E03.
- [Parte 6 — assinatura e distribuição](C:/Users/Henrique/Documents/Codex/2026-09-11/prior-conversation-with-codex-conversation-role/outputs/NEXT-revisao-profunda-parte-6.md): F01–F04.

Os relatórios contêm linhas de código, condições de ocorrência, limites e testes propostos. A consolidação não transforma cenários condicionais em falhas reproduzidas.

## Pacotes de correção, em ordem de dependência

| Ordem | Pacote e achados | Entrega verificável |
|---|---|---|
| 1 | Histórico e recuperação: A04, A05, A08 | Separar prévias de alterações reais; gravação recuperável e serializada; erro de log não impede finalização/rollback. |
| 2 | Inversos e estado original: A01, A02, A03, A06, A07, A09, A10, B04, B05, B06 | Bloquear mutações sem inverso suportado; preservar plano/adaptador/tipo de Registro; restaurar estados relacionados; declarar conflitos e recuperação parcial. |
| 3 | Resultados, fila e cancelamento: C01, C02, C03, C04 | Falha estruturada interrompe novas mutações; cancelamento entre operações; diário por tentativa; resumo não confunde tentativa com sucesso. |
| 4 | Alvos e instaladores: B01, B02, B03, B07, B08 | Manifesto confiável no backend; executar os mesmos bytes verificados; revalidar identidade do processo; detecção por versão/arquitetura e reparação segura do cache. |
| 5 | Sessão e administração: D01, D02, E01, E02, E03 | Reconexão sem reativação desnecessária; logout com pendências explícitas; ordem única de locks; auditoria com operador/alvo; transferência idempotente. |
| 6 | Assinatura e pacote final: F01, F02, F03, F04 | Segredos restritos; limpeza de temporários em falhas; digest do pacote corresponde ao candidato testado; signatário permitido confirmado. |

Cada ID aparece em um único pacote principal para evitar contar a mesma tarefa duas vezes. Isso não elimina dependências cruzadas: por exemplo, a fila usa o diário de recuperação e a tela depende dos resultados reais dos motores.

Primeira implementação recomendada, quando autorizada: pacote 1, com testes de armazenamento temporário e executores falsos. Depois fechar o contrato de inversos do pacote 2 antes de reativar ações perigosas. Como contenção, preferir bloquear claramente uma ação sem recuperação validada a manter uma promessa de reversibilidade incorreta.

## Portões de liberação

### G1 — desenvolvimento e testes sem mutações do sistema

Permitido continuar a revisão e, após autorização, criar testes puros com relógio, transporte, filesystem temporário e executor simulados. Inspecionar os scripts antes de executá-los. Não rodar indiscriminadamente a suíte Rust inteira, scripts de QA que instalem o app ou comandos de otimização.

O modo seguro nativo tem padrão de teste, mas isso não garante ausência de toda escrita: A08 mostra prévias criando snapshots e consumindo retenção. Portanto, não usar “dry-run” como autorização para testar livremente no PC pessoal. Compilar também não equivale a validar rollback real.

### G2 — beta controlada com alterações reais

Antes de habilitar qualquer módulo mutante na beta:

- Corrigir ou desabilitar explicitamente os caminhos afetados pelos P1 aplicáveis ao módulo.
- Tratar os P2 que comprometem sua recuperação ou induzem a interpretação errada do resultado; prioridade média não significa que possam ser ignorados.
- Revisar os caminhos ainda não cobertos desse módulo, incluindo chamadas IPC diretas e concorrência aplicação/restauração.
- Demonstrar testes negativos: leitura negada, escrita parcial, armazenamento cheio/corrompido, alvo alterado, cancelamento e licença indisponível.
- Validar aplicação e restauração em outro Windows expressamente autorizado, com dados controlados e comparação do estado inicial/final. Não executar no PC pessoal e não instalar VM nesta tarefa.

Uma beta reduzida pode excluir módulos não prontos, mas a exclusão deve valer no backend, não apenas esconder botões. Essa é uma opção de escopo a decidir, não uma mudança já feita.

### G3 — assinatura e distribuição pública

F01/F02 bloqueiam uso do processo atual com credenciais reais até a proteção adequada; F03/F04 bloqueiam confiar no pacote público como o artefato aprovado. Não é necessário comprar certificado agora para corrigir ou testar a lógica com fixtures.

Exigir vínculo entre commit, versão, hash dos instaladores e QA do mesmo candidato; assinatura por identidade permitida; confirmação de requisitos de upgrade/desinstalação e recuperação; aprovação explícita de publicação. Aprovação de um workflow antigo não valida o próximo binário. Não disparar CI pago ou com consumo potencial relevante sem combinar o uso.

## Cobertura ainda pendente

O inventário do repositório foi conferido, mas estes módulos não receberam revisão integral comprovada pelos seis relatórios:

| Área | Arquivos/fluxos a rastrear | Pergunta principal |
|---|---|---|
| Limpeza e caminhos | `clean.rs`, `restore.rs`, tela de limpeza | Toda seleção, travessia, exclusão e quarentena permanece dentro do alvo permitido, inclusive com links/reparse points e concorrência? |
| Catálogo completo | `advanced.rs`, `performance.rs`, rotas personalizadas | Cada comando tem necessidade, benefício demonstrável, risco, pré-condição e inverso honestos? |
| Perfis, reparação e agendamento | `profiles.rs`, `optimizer.rs`, `system.rs`, `HermesRepairCenter.tsx`, `HermesSchedulerCenter.tsx` | Perfil ou tarefa pode disparar algo fora do consentimento, repetir indevidamente ou sobreviver ao cancelamento? |
| Segurança e Defender | `anti_cheat.rs`, rotas anti-cheat/defender/reparar-windows | Há exclusões ou alterações sensíveis com alvos amplos, autorizações insuficientes ou diagnósticos enganosos? |
| Métricas e recomendações | `diagnostic.rs`, `benchmark.rs`, `advisor.rs`, `advisor_ai_engine.rs` e wrappers | Resultados são reais, atuais e rotulados corretamente? Há evidência de benefício e limites claros? |
| IPC e ciclo de vida | `lib.rs`, `main.rs`, companion, deep-link, janelas e permissões | Comandos e argumentos são validados independentemente da interface? Fechar ou trocar de tela deixa trabalho ativo sem supervisão? |
| Interface e persistência | Rotas restantes, preferências, caches, relatórios, captura de erros | Estados vazios/falhos e dados persistidos são seguros? Há exposição indevida de informações em logs/exportações? |
| Distribuição integral | Scripts restantes de QA/build/release, upgrade, desinstalação | Toda evidência pertence ao artefato correto? Operações auxiliares respeitam limites de filesystem e não executam alterações inesperadas? |
| Ambiente implantado | Metadados de funções, grants, políticas e configuração | O estado efetivo corresponde às migrações e ao código? Fazer somente leitura de metadados, sem dados de clientes. |

“Parcialmente revisado” não significa “sem problemas”: vários desses arquivos apareceram nos relatórios, mas apenas em fluxos específicos. Não há porcentagem confiável de cobertura por quantidade de arquivos.

## Próximo bloco de revisão recomendado

**Limpeza e segurança de caminhos**, antes de funções cosméticas ou novas otimizações. Rastrear seleção de diretórios, canonicalização, links/junctions, quarentena, expurgo e restauração sob alteração concorrente do filesystem. Essa é uma extensão da revisão de retenção já feita, não repetição do A08.

Entrega esperada: achados adicionais somente quando houver evidência; casos de teste com arquivos sintéticos em diretório temporário; nenhuma exclusão ou limpeza real. Após esse bloco, seguir para perfis/reparação/agendamentos e catálogo restante.

## Decisões que precisam ficar explícitas antes da implementação correspondente

- Revogação cancela somente a licença atual ou bloqueia a conta? Um código novo deve reaproveitar saldo de uma licença revogada?
- A autorização vale para um lote inteiro ou deve ser renovada antes de cada operação? Como tratar revogação enquanto um instalador já está rodando?
- A próxima beta terá todos os módulos ou um subconjunto realmente validado?
- Quais comandos inerentemente não reversíveis devem sair da otimização global e exigir fluxo próprio?

Essas escolhas não impedem continuar a análise. Não assumir suas respostas ao implementar.

## Melhorias posteriores, fora do caminho crítico

Depois da base segura e com aprovação: prévia exata de antes/depois; recuperação agrupada por sessão; diagnóstico de dependências por versão; comparação de desempenho com metodologia e ressalvas; reconexão e explicações mais claras. Atualização automática e novas otimizações não são pré-requisitos por si sós para uma boa primeira versão e não serão acrescentadas silenciosamente.

## Como encerrar um achado

Cada correção deve registrar IDs tratados, diff/commit, teste de regressão, resultado e risco residual. Critérios: reproduzir o cenário com fixture quando possível; mostrar falha antes e sucesso depois; verificar que o teste não altera o host; executar validações seguras aplicáveis; só marcar validação real de Windows quando ela de fato ocorrer em ambiente autorizado.

Separar estados: identificado → corrigido no código → validado por testes isolados → validado no Windows autorizado, quando necessário. Nesta consolidação todos os 31 registros permanecem no primeiro estado. Decisões de política não são bugs automaticamente encerrados por documentação.

## Preservação e entrega

Único arquivo criado nesta etapa: este plano, fora do repositório do produto. Os seis relatórios anteriores foram preservados. HEAD permaneceu `1fef2a3`; a modificação preexistente em `src/routeTree.gen.ts` não foi alterada. Nenhum app, instalador, otimização, migração, publicação ou novo teste foi executado.
