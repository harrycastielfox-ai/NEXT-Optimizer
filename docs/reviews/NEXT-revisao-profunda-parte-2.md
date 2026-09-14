# NEXT — revisão profunda, parte 2

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo e conclusão

Revisão estática dos fluxos de processos Gamer, inicialização e instalação de dependências, incluindo os respectivos contratos de recuperação. O código ainda apresenta problemas que devem ser resolvidos antes de uma beta com alterações reais. Esta etapa não conclui a auditoria de todo o aplicativo.

Não executei o aplicativo, instaladores, downloads de executáveis, otimizações, comandos de Registro nem testes com efeitos no Windows. Nenhum código de produção foi modificado. As consequências descritas são cenários derivados do código, não incidentes reproduzidos nesta máquina. P1 significa prioridade antes de beta com alterações reais; P2, correção funcional necessária. Os problemas transversais de logging e snapshots já constam na parte 1 e não são contados novamente aqui.

## Achados

### B01 — P1: a allowlist nativa de instaladores valida um rótulo, não a identidade do pacote

[gamer_dependencies.rs:1508](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer_dependencies.rs:1508) aceita qualquer ID iniciado por `vc-redist-`. O pedido recebido do frontend fornece nome do arquivo, URL e SHA256 esperado. A verificação usa esse hash (1035, 1116–1123); não o procura em um manifesto confiável nativo. A assinatura Microsoft é exigida independentemente do campo de publisher enviado — proteção válida, mas insuficiente para distinguir produtos Microsoft.

Um pedido IPC adulterado pode identificar outro executável Microsoft como VC++ e fornecer seu hash real, desde que o arquivo esteja disponível no cache e a detecção local não dispense a ação. A instalação verifica o ID, encontra o resultado por ID e executa o arquivo (530–600). Assim, o comentário que promete excluir Build Tools/SDK não é garantido pelo código. Isso não demonstra execução de qualquer binário não assinado nem dispensa licença, confirmação, modo real e elevação; é um rompimento da restrição de produtos no backend, condicionado a entrada adulterada.

Proposta: manifesto canônico compilado/validado no backend, IDs exatos e únicos; pedido de instalação contendo apenas IDs, sem permitir redefinir arquivo/hash. Rejeitar IDs duplicados e divergências entre identidade e artefato.

Teste proposto: enviar ID desconhecido com prefixo permitido, hash substituído, outro produto Microsoft e IDs duplicados; todos devem ser rejeitados antes de executar processos. Usar verificadores e executor falsos.

### B02 — P1: o arquivo verificado pode mudar antes de ser executado

[gamer_dependencies.rs:447](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer_dependencies.rs:447) verifica o conjunto inteiro antes do laço de instalações. Em 579–600, a checagem final é apenas `is_file()`, seguida da execução pelo caminho. Não há vínculo com a identidade/conteúdo do arquivo anteriormente verificado. A espera por outros instaladores amplia esse intervalo.

Se outro processo com acesso de escrita ao cache substituir o arquivo nesse intervalo, a execução não usa necessariamente os bytes aprovados. A revisão não inspecionou ACLs efetivas nem reproduziu uma exploração; o risco depende de acesso de escrita ao cache. A exigência de app elevado torna importante fechar essa janela, não apenas confiar no hash calculado anteriormente.

Proposta: staging protegido, controle de concorrência e mecanismo que mantenha a identidade do arquivo entre validação e execução. Recalcular o hash imediatamente antes é uma defesa adicional, não uma solução completa para a corrida.

Teste proposto: substituir um arquivo de teste entre verificação e execução simulada; a ação deve bloquear. Nenhum executável real é necessário.

### B03 — P1: fechar processos e elevar prioridade usa PID sem revalidar a identidade

[gamer.rs:1355](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer.rs:1355) consulta flags/nome coletados anteriormente, mas o PowerShell em 1375 busca apenas o PID. A prioridade faz o mesmo em 1348–1352. Se o processo original sair e o Windows reutilizar o PID, o alvo atual pode não ser o processo aprovado.

A reutilização de IDs após o término é documentada pela [Microsoft — Process.Id](https://learn.microsoft.com/pl-pl/dotnet/api/system.diagnostics.process.id?view=net-10.0). A ocorrência concreta é uma condição de corrida, não um resultado observado. O fechamento é gracioso e não usa kill forçado, o que limita, mas não elimina, a ação sobre uma janela indevida.

Proposta: identificar o processo por PID e instante de criação, validar caminho/identidade no momento da ação e operar sobre o mesmo handle validado. Se houver mudança, pular com motivo explícito.

Teste proposto: coletor falso retorna processo A, executor encontra processo B com mesmo PID; nenhuma mensagem de fechamento ou mudança de prioridade deve ser enviada.

### B04 — P2: Gamer anuncia recuperação para caminhos recusados pelo restore

[gamer.rs:617](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer.rs:617) define `rollback_available` pela elegibilidade e presença do caminho. A seleção exige essa flag (928–931), mas não valida a capacidade real do restore. Já [restore.rs:1598](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1598) só aceita executáveis em determinados caminhos sob `C:`.

Um aplicativo elegível instalado em `D:` pode ser fechado e ter sua reabertura rejeitada. Além disso, o manifesto Gamer (1159–1173) registra somente o executável, sem argumentos: reabrir o programa não equivale a restaurar sua sessão/documentos. Não recomendo liberar caminhos indiscriminadamente para corrigir essa diferença.

Proposta: compartilhar a validação de recuperabilidade entre planejamento e restore, excluir alvos incompatíveis antes de fechar e chamar a função de “reabrir aplicativo”, sem promessa de recuperação integral de sessão. Definir política segura para argumentos quando necessário.

Teste proposto: caminhos em C:, D:, aplicativos portáteis e aplicativo que exige argumentos; a elegibilidade precisa corresponder à capacidade real de recuperação.

### B05 — P1: rollback de Startup não restaura seu inventário de desativados

[startup.rs:650](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/startup.rs:650) gera rollback apenas de Registro. Desativar grava também o inventário local (779); ativar remove desse inventário (808, 1001–1004). O executor de `RestoreStartupEntry` não recompõe esse segundo estado. O relatório, por sua vez, concatena entradas atuais e inventário desativado sem reconciliar (414–432).

Cenário 1: desativar e restaurar devolve a entrada ao Registro, mas mantém um item “desativado” no inventário. Cenário 2: reativar e restaurar remove a entrada do Registro, mas não devolve o item ao inventário; ele deixa de ser oferecido como desativado para reativação. Vale também para recuperações automáticas após falha parcial.

Proposta: rollback transacional dos dois estados e reconciliação com identidade estável por chave/nome. O estado do Registro deve ser consultado antes de oferecer uma ação sobre registros antigos.

Teste proposto: desativar → restaurar → listar e ativar → restaurar → listar; ambos devem reproduzir integralmente o estado inicial, sem duplicatas ou itens desaparecidos.

### B06 — P2: Startup não preserva o tipo original do valor de Registro

[startup.rs:665](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/startup.rs:665) fixa o inverso como `String`, e a reativação em 952–958 usa `-PropertyType String`. Não há captura do tipo original. O coletor de startup e uma string de comando não substituem a leitura do valor bruto e de seu tipo.

Valores `REG_EXPAND_SZ` e `REG_SZ` têm semânticas distintas; o primeiro comporta referências não expandidas a variáveis de ambiente, conforme [Microsoft — tipos de valores do Registro](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-value-types). Mesmo quando um comando ainda funciona após a conversão, a restauração já não reproduz o estado original; o impacto no lançamento depende do consumidor e conteúdo.

Proposta: capturar valor bruto, tipo e existência; preservar esses dados tanto no inventário quanto no manifesto. Falha de leitura deve bloquear, não ser confundida com ausência — padrão relacionado ao A06 da parte 1.

Teste proposto: REG_SZ, REG_EXPAND_SZ com variáveis, valor vazio e leitura negada; ida e volta devem manter conteúdo e tipo exatos.

### B07 — P2: detecção de dependências confunde presença com versão/suficiência

[gamer_dependencies.rs:1348](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer_dependencies.rs:1348) identifica VC++ pelo nome exibido, arquitetura e ano; para o grupo 2015–2022 aceita qualquer correspondência 2015/2017/2019/2022. Não compara versão instalada com a requerida. Esse resultado dispensa download (730), retorna `Verified` sem hash/assinatura (1072–1089) e pula instalação (568–577).

Uma instalação antiga pode, portanto, impedir uma atualização necessária. A [documentação Microsoft do VC++](https://learn.microsoft.com/nb-no/cpp/windows/latest-supported-vc-redist?view=msvc-170) exige runtime pelo menos tão recente quanto as ferramentas usadas para compilar o aplicativo. Para DirectX, a prova é ainda mais estreita: basta `d3dx9_43.dll` em uma das duas pastas (1358–1362); isso não verifica o restante das dependências ou ambas as arquiteturas.

Proposta: separar “detectado”, “compatível”, “instalador validado” e “instalação confirmada”; definir versões mínimas por arquitetura e verificar componentes pertinentes ao escopo declarado. Não inferir integridade completa a partir de um nome de produto ou DLL isolada.

Teste proposto: VC++ antigo vs mínimo requerido, arquitetura ausente, DLL DirectX isolada e leitura de inventário indisponível. Nenhum desses casos deve virar confirmação genérica de pacote pronto.

### B08 — P2: cache inválido não é recuperado pelo fluxo de download

[gamer_dependencies.rs:750](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer_dependencies.rs:750) dispensa download se o arquivo existe, sem validar seu conteúdo nessa decisão. A verificação posterior bloqueia corretamente arquivo inválido, mas pedir novo download volta a dispensá-lo. Um cache truncado ou de hash antigo exige intervenção manual mesmo quando há uma fonte válida disponível.

Proposta: validar cache antes de reutilizar; oferecer reparação explícita com quarentena do arquivo inválido e download temporário validado antes da troca. Manter bloqueio de execução para qualquer divergência.

Teste proposto: cache íntegro deve ser reutilizado; cache truncado/hash divergente deve permitir reparação segura e nunca execução do arquivo inválido.

## Proteções presentes

- Instalação real exige confirmação, licença válida, modo real e app elevado.
- O fluxo exige hash correspondente, Authenticode válido e organização Microsoft para arquivo não dispensado como instalado.
- Downloads novos usam temporário e só são promovidos após verificação.
- Gamer solicita fechamento gracioso, sem kill forçado; há classificação e denylist.
- Startup limita escrita a chaves de inicialização do usuário e protege categorias específicas.

Essas proteções são úteis; os achados mostram onde o contrato ainda não é completo.

## Sequência proposta

Antes de ampliar funções: corrigir B01/B02/B03/B05 junto dos P1 da parte 1, adicionar testes com executores falsos e só então planejar validação real em máquina dedicada. Os testes acima são propostas, não foram executados neste bloco.

Próximo bloco de revisão: contratos frontend/backend, concorrência e cancelamento de operações, tratamento de resultados parciais e feedback ao usuário. Depois, consolidar cobertura restante de autenticação/licenciamento, atualização/distribuição e segurança de configuração. Nenhuma nova função foi implementada nem aprovada automaticamente por este relatório.

## Entrega e preservação

Único arquivo criado nesta etapa: este relatório, fora do repositório do produto. `src/routeTree.gen.ts` já estava modificado antes da revisão e foi preservado. HEAD permaneceu `1fef2a3`. Não houve commit, push, publicação, alteração remota ou custo contratado.
