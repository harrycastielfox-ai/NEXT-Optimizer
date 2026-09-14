# NEXT — revisão profunda, parte 1: execução e recuperação

Data: 13/09/2026. Base: commit `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Conclusão

Há problemas de correção que justificam adiar a beta com alterações reais. A existência de um snapshot não garante reversibilidade: algumas operações não têm inverso implementado, outras perdem o contexto necessário e há caminhos em que falhas de armazenamento impedem a recuperação.

Esta é uma revisão estática de um primeiro bloco, **não uma auditoria concluída de todo o repositório**. Os achados abaixo são confirmados pelas condições e chamadas do código; seus efeitos em uma instalação real não foram reproduzidos neste computador. Não foram executados app, instaladores, motores, comandos de Registro, powercfg, DISM ou testes Rust com efeitos no sistema. Nenhum código de produção foi alterado, nenhuma função nova foi adicionada e nenhuma alteração foi enviada ao GitHub/Supabase.

P1 = corrigir antes de beta com alterações reais. P2 = corrigir antes de considerar recuperação/funcionalidade validada. A prioridade descreve impacto e condições de ocorrência, não afirma que o problema já aconteceu na máquina do proprietário.

## Achados confirmados

### A01 — P1: comandos persistentes recebem rollback que não faz nada

Em [advanced.rs:3318](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/advanced.rs:3318), toda operação `Cmd` gera `RestoreRollbackActionType::Noop`, inclusive quando `transient=false`. Exemplos marcados `reversible=true` e `persistent=true`: timeout de boot (1416–1440), Winsock/TCP-IP (1495–1541), TCP global (1545–1578), inicialização de serviços (1582–1632), hibernação (1389–1412).

O bloqueio antes da aplicação consulta a flag declarada `reversible`, não a capacidade real do executor (2866–2890). No restore, `Noop` é considerado suportado e aplicado ([restore.rs:682](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:682)). Assim, um snapshot de alteração de serviço pode ser declarado restaurado sem devolver o modo anterior do serviço.

**Correção proposta:** derivar reversibilidade de um inverso tipado com estado anterior completo; bloquear por padrão comandos persistentes sem inverso. Operações de reparação inerentemente não reversíveis devem ter fluxo e consentimento próprios, não um `Noop` apresentado como recuperação.

**Teste necessário:** estado inicial não padrão de serviço/boot/TCP → aplicar → reverter → comparar com o estado inicial; ausência de inverso deve bloquear a aplicação antes do primeiro comando.

### A02 — P1: DNS é anunciado como reversível, mas seu inverso é rejeitado

[advanced.rs:1761](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/advanced.rs:1761) marca DNS como reversível e guarda interfaces anteriores. O manifesto criado em 3265–3284 é `Custom` com `command_preview` começando por `Set-DnsClientServerAddress`. Entretanto, [restore.rs:1229](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1229) só aceita `Custom` quando o preview é exatamente `Start-Process`.

**Cenário:** troca de DNS bem-sucedida seguida de restauração retorna não suportado e mantém o DNS alterado. Também há risco de aplicação parcial quando um adaptador é alterado e outro falha: o loop em advanced.rs:3631 não consegue desfazer o primeiro através desse manifesto.

**Correção proposta:** operação própria para restaurar DNS por identidade estável do adaptador, preservando a diferença entre configuração automática e servidores estáticos; validar o inverso antes da aplicação. Não liberar execução de PowerShell arbitrário a partir de `command_preview`.

**Teste necessário:** adaptadores com DNS automático/estático, adaptador removido e falha após modificar o primeiro de dois adaptadores.

### A03 — P1: restauração de energia pode escrever no plano errado

O estado é coletado antes do lote ([advanced.rs:390](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/advanced.rs:390)). O manifesto de `PowerSetting` grava subgrupo, configuração e valores AC/DC, mas não o GUID do plano (3239–3263). Aplicação e restauração usam `SCHEME_CURRENT` ([restore.rs:925](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:925)).

**Cenário mínimo:** alterar uma configuração no plano A; selecionar manualmente o plano B; restaurar o snapshot. Os valores de A são escritos em B. Existe ainda o lote de `optimize-all.ts:144–148`, que seleciona Alto Desempenho antes de alterar tela/USB/PCIe: os valores anteriores foram capturados antes dessa troca. O rollback percorre o manifesto na ordem direta, incluindo a troca de plano antes das configurações.

**Correção proposta:** capturar o estado do plano efetivamente visado, registrar seu GUID em cada operação e respeitar dependências no desfazer. Apenas inverter a ordem do vetor não resolve a captura do plano errado.

**Teste necessário:** dois planos com AC/DC diferentes; lote que troca plano; mudança externa de plano antes de restaurar; falha entre escrita AC e DC.

### A04 — P1: histórico corrompido vira histórico vazio e pode ser sobrescrito

[restore.rs:1386](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1386) transforma qualquer falha de leitura ou JSON inválido em histórico padrão vazio. A próxima criação insere um snapshot nesse histórico e grava sobre o arquivo. A gravação usa `fs::write` diretamente, sem arquivo temporário, troca atômica ou cópia anterior (1393–1396). Essa função substitui o conteúdo existente, conforme a [documentação de Rust](https://doc.rust-lang.org/std/fs/fn.write.html).

**Cenário:** interrupção durante gravação deixa JSON parcial; a próxima criação aceita o arquivo como vazio e substitui os registros anteriores. Não há distinção entre primeira execução e corrupção/permissão negada. A proteção da limpeza contra JSON inválido também deixa de ajudar depois que o histórico foi substituído por um novo JSON válido.

**Correção proposta:** tratar ausência, corrupção e erro de I/O separadamente; bloquear novas alterações quando o histórico não puder ser verificado; persistência atômica e versão anterior recuperável. Serializar operações de leitura/modificação/gravação para evitar atualização perdida entre motores concorrentes.

**Teste necessário:** truncamento e JSON inválido; falha de escrita; falha após serializar e antes de trocar arquivo; duas criações simultâneas. Não sobrescrever a evidência original durante a recuperação.

### A05 — P1: falha ao registrar log pode impedir rollback automático

[performance.rs:310](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/performance.rs:310) executa a operação e depois chama `append_performance_event(...)?`, antes de registrar o resultado e decidir pelo rollback. Se a operação falhou após escrever parcialmente e a gravação do log também falha, o `?` retorna imediatamente: o bloco de rollback em 331–370 não roda.

O mesmo padrão aparece em [advanced.rs:3475](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/advanced.rs:3475), chamado com `?` em 456, e em startup.rs:699–710/316–322. Há também escrita de aviso com `?` imediatamente antes de chamar recuperação.

**Correção proposta:** depois da primeira mutação, falhas de telemetria/log não podem desviar o fluxo de finalização e recuperação. Acumular erros secundários separadamente; manter um diário durável mínimo antes de cada mutação e reportar o resultado parcial mesmo com armazenamento degradado.

**Teste necessário:** injetar falha no logger após a primeira mutação e numa operação parcialmente falha; verificar que o inverso ainda é chamado e que o erro original é preservado.

### A06 — P1: falha de leitura do Registro é confundida com valor ausente

[performance.rs:1257](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/performance.rs:1257) captura tanto valor inexistente quanto erro como `null`; os conversores em 981–994 viram esse `None` em `__HERMES_MISSING__`. A checagem de rollback em 688–708 valida o plano de energia, mas não exige sucesso da captura do Registro.

O restore interpreta a sentinela como ordem de remoção ([restore.rs:1127](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1127)). Logo, uma leitura que falhou pode produzir um inverso que remove um valor originalmente existente, caso a escrita posterior seja possível. A própria remoção usa `SilentlyContinue` e retorna `ok`, sem releitura de confirmação. A documentação explica que esse parâmetro permite continuar após erros não terminantes: [Microsoft — tratamento de erros](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling?view=powershell-7.6). O app usa Windows PowerShell; o caso deve integrar os testes específicos desse runtime.

**Correção proposta:** representar captura como `Present(tipo, valor)`, `Absent` ou `ReadFailed`; só `Absent` autoriza apagar no rollback. Preservar tipo original e verificar pós-condição da escrita/remoção.

**Teste necessário:** chave inexistente, leitura negada, tipo inesperado, remoção negada e alteração externa entre captura e aplicação. Nenhum desses estados deve ser convertido silenciosamente em sucesso.

### A07 — P2: arquivo pulado por conflito ainda pode resultar em “restaurado”

[restore.rs:1196](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1196) corretamente evita sobrescrever um destino existente e retorna `Skipped`. Porém, o agregado em 593–640 só considera `Failed` e `Unsupported`: mesmo se todos os arquivos forem pulados, pode retornar `applied=true` e status `Applied`. Manifesto vazio também retorna uma ação artificial `Applied` em 663–672.

**Correção proposta:** distinguir sucesso completo, parcial, conflito e nenhuma alteração. Um arquivo atual diferente não comprova que o original foi restaurado. Manter o backup e oferecer resolução explícita de conflito.

**Teste necessário:** destino reaparece com conteúdo diferente; mistura de restaurado/pulado; manifesto vazio; repetição de uma restauração já concluída.

### A08 — P1: prévias podem expulsar snapshots reais da retenção

Os motores criam snapshot antes do desvio de `dry_run` (performance.rs:254–267; advanced.rs:427–442; clean.rs:288–303). Todos entram na mesma coleção, com status inicial `Created`, e [restore.rs:329](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:329) mantém somente dez registros, independentemente de terem reversões reais pendentes.

**Cenário:** um snapshot real seguido de dez prévias deixa de estar disponível no histórico. Na limpeza, a proteção contra expurgo depende justamente das referências desse histórico (clean.rs:1090–1126); após o período de 14 dias, uma quarentena sem referência pode ser removida por uma limpeza confirmada (877–968).

**Correção proposta:** separar prévias de diário de alterações reais; reter snapshots necessários até resolução/expiração explicitamente aprovada. Prévia não deve consumir a capacidade de recuperação nem oferecer rollback real como se tivesse aplicado algo.

**Teste necessário:** criar dez prévias após alteração real; assegurar que a restauração e os backups continuem protegidos. Testar retenção por sessão, não apenas por quantidade global.

### A09 — P2: DISM que altera o Windows é classificado como transiente

[advanced.rs:1688](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/advanced.rs:1688) usa o mesmo construtor para leitura e mutação: sempre `persistent=false`, `reversible=true`, `transient=true`. Esse construtor atende tanto consultas quanto `StartComponentCleanup` (1482–1492) e ativação de DirectPlay (1669–1685). Habilitar recursos e limpar componentes não são apenas leituras nem estados que desaparecem ao encerrar o processo, como mostram as [opções oficiais de DISM](https://learn.microsoft.com/en-au/windows-hardware/manufacture/desktop/dism-operating-system-package-servicing-command-line-options?view=windows-10).

**Impacto:** contorna a política de bloquear mutações persistentes sem rollback e produz mensagem de ação temporária sem estado persistente (3520–3525), com inverso `Noop`.

**Correção proposta:** separar consultas, configuração reversível e manutenção não reversível; remover reparos globais do pacote de “otimização reversível”. Não prometer desfazer limpeza de componentes via snapshot JSON. Não confundir `StartComponentCleanup` com o argumento adicional `ResetBase`, que não consta aqui.

**Teste necessário:** contrato de persistência/risco por comando e testes negativos que impeçam declarar consultas e mutações equivalentes.

### A10 — P2: restauração de sessão Gamer não compõe seus snapshots filhos

[gamer.rs:371](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer.rs:371) cria o snapshot Gamer e depois chama Performance, que cria outro snapshot (384–398). O manifesto Gamer só inclui reabrir processos (1138–1140). O comando `gamer_restore_session` aplica somente o ID informado (1064–1087), podendo anunciar sessão restaurada sem desfazer o plano de energia aplicado pelo filho.

**Limite observado:** há wrapper frontend exportado, mas não encontrei chamada ativa a ele nas telas; portanto este achado é do contrato backend, não uma afirmação de que um botão atual reproduziu o problema. O snapshot de Performance pode existir separadamente; não está perdido necessariamente.

**Correção proposta:** ID único de sessão com operações/snapshots filhos e estado agregado de recuperação. Não chamar a restauração de processos isolada de restauração completa de sessão.

**Teste necessário:** perfil Gamer com ajuste de energia, sem processos a fechar; recuperação da sessão deve restaurar todos os efeitos ou declarar explicitamente o escopo parcial.

## Cobertura e pendências

Rastreamento nesta parte: criação/leitura/gravação/validação/aplicação de snapshots, retenção e quarentena; despacho de Advanced e parte do catálogo (rede, energia, serviços, DISM); execução/captura de Performance; despacho de Startup/Gamer e composição de sessão; chamadas de recuperação na tela Segurança e seleções relevantes de quick-prepare/optimize-all. Foram consultados os testes existentes para entender o que o CI cobre. Não foi relido cada trecho de todos esses arquivos.

Ainda pendentes de revisão integral: todos os itens individuais do catálogo e evidência de benefício, identidade/fechamento/prioridade de processos, persistência de inicialização, instaladores de dependências, segurança/IPC e licenciamento, diagnóstico/benchmark, agendamentos/reparo, UI completa e cancelamento, automações de release e configuração de distribuição. Não atribuir percentual global de conclusão a esse recorte.

Pontos positivos preservados: confirmação explícita e barreira nativa de licença em operações reais; tentativa de snapshot antes das mutações; recusa de manifesto executável enviado pelo renderer; quarentena em vez de exclusão imediata; proteção contra sobrescrita na restauração; encerramento gracioso sem kill forçado. Esses controles não anulam os achados, mas devem ser mantidos.

## Ordem proposta de melhoria — sem implementação autorizada nesta revisão

1. Contrato único de operação: alvo, captura, aplicação, inverso tipado, pós-condição e resultado. Reversibilidade calculada, não um booleano independente do executor.
2. Persistência recuperável e diário de execução: falhas de log não podem abortar recuperação; separar prévias de mudanças reais.
3. Corrigir DNS, plano de energia e comandos persistentes; retirar promessas falsas de restauração e tornar conflitos explícitos.
4. Testes com executores/armazenamento falsos para injetar falhas, sem usar o Windows real; depois, testes integrados em outro Windows autorizado.

Funcionalidades candidatas, somente após corrigir a base e combinar com o proprietário: prévia exata do antes/depois; centro de recuperação por sessão; modo de comparação antes/depois com evidência de benefício. Nenhuma foi adicionada nesta etapa.
