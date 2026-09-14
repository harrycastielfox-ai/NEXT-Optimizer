# NEXT — revisão profunda, parte 7: limpeza e segurança de caminhos

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo e conclusão

Revisão estática da Clean Engine, quarentena e rollback de arquivos. Três achados: junctions/reparse points não são tratados como links, há uma corrida entre planejamento e movimento, e a allowlist do restore aceita prefixos sem fronteira de diretório.

Não foram criados links, junctions, arquivos de teste nem diretórios temporários; não houve limpeza, quarentena, purge ou restore neste computador. Os cenários dependem do filesystem ser alterado por outro processo com acesso aos caminhos em questão; não são incidentes observados. Testes propostos precisam usar diretório sintético isolado e nunca pastas reais do usuário.

## G01 — P1: junctions/reparse points não são bloqueados como prometido

[clean.rs:1363](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/clean.rs:1363) considera inseguro somente `file_type().is_symlink()`. No Windows, junctions e outros reparse points não são necessariamente links simbólicos nessa API. Porém, o código apresenta esse teste como “link simbolico/reparse” (582–586), entra em diretórios com `read_dir` (657–694), mede conteúdo recursivamente (1379–1396) e depois move o candidato com `rename` (742–797).

Um junction dentro de um cache permitido pode fazer a leitura/medição atravessar para outra árvore, e um junction usado como candidato pode ser tratado como diretório comum. A [Microsoft documenta que junctions são implementados por reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions) e que a presença deve ser verificada pelo atributo `FILE_ATTRIBUTE_REPARSE_POINT` ([operações com reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-operations)). Não inferi que todo `rename` vai apagar o alvo externo; o risco confirmado é a defesa declarada não cobrir a classe de objetos que diz cobrir.

Proposta: detector específico de reparse point no Windows, aplicado a raiz, cada componente percorrido e destino de quarentena; abrir/manipular por handles sem seguir reparse points quando a plataforma permitir. Recusar por padrão tipos desconhecidos. A correção deve alcançar scan, planejamento, tamanho, purge e restore, não apenas `is_symlink`.

Teste proposto: árvore sintética permitida com junction para uma árvore sintética externa; scan, dry-run, aplicação e purge devem ignorar o junction e jamais contabilizar ou mover seu alvo. Repetir com symlink, link quebrado e troca do tipo entre etapas.

## G02 — P1: arquivo validado pode ser trocado entre planejamento e quarentena

O plano verifica allowlist, tipo e idade em [clean.rs:557–600](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/clean.rs:557), cria snapshot em 288–291 e só então executa `fs::rename` pelo caminho em 770. Não há nova validação, identidade de arquivo ou handle mantido entre essas etapas. Criar snapshot e registrar eventos amplia a janela.

Um processo concorrente que consiga renomear/substituir a entrada após a validação pode fazer a quarentena atuar sobre objeto diferente daquele que recebeu a decisão de segurança. O mesmo padrão existe no restore: valida caminhos em [restore.rs:1266](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1266), testa existência em 1189–1203 e renomeia depois em 1215. Não alego uma exploração sem o acesso concorrente necessário; é uma lacuna clássica de tempo entre checagem e uso em ações de filesystem.

Proposta: planejar a partir de identidade de arquivo, revalidar no ponto de operação e preferir handles/diretorias abertas com política anti-reparse. Se qualquer identidade ou pai tiver mudado, pular com estado “alvo alterado”, sem contar bytes antigos como movidos.

Teste proposto: executor de filesystem falso bloqueia após planejamento, substitui arquivo A por B no mesmo caminho e libera a operação. O resultado deve bloquear/pular B; repetir para destino de restore que passa a existir entre a checagem e o move.

## G03 — P2: a allowlist de destino do restore aceita pastas com prefixo parecido

[restore.rs:1613](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/restore.rs:1613) aceita `normalized.starts_with(&root)`, enquanto a mesma validação na Clean Engine exige igualdade ou `root + "\\"` (clean.rs:1229–1239). Exemplo lógico: se a raiz permitida é `C:\\Users\\x\\AppData\\Local\\Temp`, o destino `...\\TempOutside\\arquivo.tmp` passa no restore embora não esteja dentro de `Temp`.

No fluxo normal, o manifesto de arquivo é produzido pela própria Clean Engine; não encontrei um caminho de renderer que possa inventar essa ação. Assim, o efeito prático depende de manifesto prévio/corrompido ou de outro produtor nativo futuro. Ainda é uma divergência de defesa em profundidade e contradiz o comentário de que as listas devem permanecer idênticas (1655–1657).

Proposta: extrair uma função única de “está dentro da raiz” com igualdade ou separador de caminho, usar nas duas engines e testar raízes irmãs como `Temp`/`TempOutside`, `Cache`/`CacheBackup` e diferença de maiúsculas/minúsculas. Canonicalização por si só não substitui proteção contra reparse points (G01).

## Proteções existentes e limites

- A Clean Engine move para quarentena, em vez de excluir diretamente; só registra rollback para planos efetivamente movidos.
- Purge exige confirmação e licença no modo real, bloqueia se não puder ler snapshots ativos, evita links simbólicos conhecidos e preserva backups referenciados por snapshots disponíveis.
- O restore não sobrescreve destino existente; retorna pulado. O agregado de “restaurado” para pulos já foi registrado como A07.
- Prévia cria snapshot antes de mover; a retenção de prévias que pode expulsar recuperação real já foi registrada como A08. Este relatório não a contabiliza novamente.
- Eventos de limpeza ainda são gravados por escrita direta e assumem histórico vazio em erro de leitura (1208–1219); os problemas equivalentes de persistência/log e rollback já foram registrados em A04/A05.

## Cobertura seguinte

Este bloco não revisou integralmente os comandos de reparação, agendamento, perfis, anti-cheat/Defender, benchmark/diagnóstico ou todos os argumentos IPC. O próximo bloco recomendado é **perfis, reparação e tarefas agendadas**, concentrado em consentimento, persistência, cancelamento e execução fora da interface.

Único arquivo criado nesta etapa: este relatório fora do repositório. HEAD e a modificação preexistente em `src/routeTree.gen.ts` foram preservados. Sem build, teste, alteração de código, commit, push ou operação no Windows.
