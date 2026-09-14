# NEXT — revisão profunda, parte 4: sessão e autorização

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo e conclusão

Revisão estática de `licensing.rs`, `license_policy.rs`, `license_transport.rs`, estado de autenticação React, gate de licença, chamadas de autorização dos motores e handlers HTTP de licenciamento/administração. Há duas falhas de recuperação confirmadas pelo código e uma fronteira de autorização de lotes que precisa de política explícita.

Esta etapa não certifica RLS, privilégios SQL, transações de ativação, conteúdo efetivo do banco nem configuração atualmente implantada. A auditoria dessas camadas permanece pendente. Não foram acessados tokens locais, chaves administrativas, arquivos de credenciais ou registros de clientes; não foram feitas requisições aos endpoints de produção do NEXT. Não executei testes de ativação/revogação, app ou otimizações.

A skill Supabase orientou a checagem das fronteiras de confiança e a consulta à documentação. Consultei o índice de changelog e documentação de autenticação de Edge Functions; não implementei mudanças. Os dois achados abaixo são P2: falhas funcionais de recuperação, não demonstrações de acesso sem licença.

## D01 — P2: falha de rede desliga a reconexão automática

[nex-auth.tsx:349](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src/lib/nex-auth.tsx:349) verifica a sessão; qualquer erro em 363–370 define a sessão da interface como `null`. O efeito em 391–402 só instala o timer de 30 segundos e os listeners de `focus` e `online` quando `hasSession` é verdadeiro. Ao perder a sessão da interface, seu cleanup remove exatamente os mecanismos que poderiam recuperá-la.

Cenário: licença válida e token nativo persistido; uma verificação periódica encontra indisponibilidade de rede. A interface bloqueia corretamente novas entradas, mas voltar a ficar online ou focar a janela não dispara a verificação automática. Há recuperação manual: `NexLicenseGate.tsx:73–76` permite verificar o acesso sem código, e a página de conta também oferece refresh. Portanto, o acesso não fica irrecuperável; o problema é perder a reconexão automática e confundir indisponibilidade transitória com ausência de sessão na camada de apresentação.

Proposta: manter um estado separado para credencial existente, autorização atual e disponibilidade de rede. Em erro transitório, continuar bloqueando novas alterações, mas manter tentativa de reconexão com backoff e listeners apropriados. Não persistir `access=allowed` no navegador como solução.

Teste proposto, sem rede real: verificação permitida → erro de transporte → evento online → resposta permitida. Confirmar bloqueio durante a indisponibilidade e recuperação automática posterior, sem reativação do código.

## D02 — P2: erro ao apagar a credencial interrompe a revogação remota do logout

[licensing.rs:176](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/licensing.rs:176) inicia o logout, limpa autorização e token em memória e tenta apagar o arquivo DPAPI. Se `remove_file` falhar por motivo diferente de inexistência, retorna erro antes de chegar à chamada remota `revoke`.

Nesse cenário, o arquivo protegido continua no disco e o servidor não recebe sequer a tentativa de revogação. Ao reiniciar o app, `load_token` (49–64) pode carregar novamente a credencial; se a sessão remota ainda estiver válida, uma verificação online pode autorizar novamente. A interface limpa o estado no `finally` de `signOut` (nex-auth.tsx:455–466), embora o comando tenha retornado erro. Não afirmo que o erro seja sempre ocultado pelo chamador, nem que DPAPI tenha sido quebrado: a falha é a sequência incompleta de logout.

Proposta: tentar limpeza local e revogação remota independentemente; devolver resultado estruturado que diferencie logout local, revogação confirmada e pendências. Se não puder apagar o token, manter um marcador durável de sessão encerrada quando possível e impedir recarga automática. Não prometer garantia de revogação remota enquanto offline.

Teste proposto: armazenamento falso retorna acesso negado na exclusão, transporte remoto está disponível; ainda deve ocorrer tentativa de revogar. Repetir com falha de rede e reinicialização simulada, verificando que o app não anuncia encerramento definitivo quando existe pendência.

## Fronteira de política: autorização de lote não equivale a autorização por operação

`license_policy.rs` limita a autorização em cache a 30 segundos, e `licensing.rs:120` valida licença antes de novos pedidos reais ao motor. Entretanto, [gamer_dependencies.rs:436](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/src-tauri/src/gamer_dependencies.rs:436) faz essa validação antes da verificação dos arquivos e do laço de pacotes (451–458); o próximo instalador não consulta novamente a licença. Um lote pode durar mais que os 30 segundos.

Consequentemente, não se pode prometer que uma revogação interromperá novas instalações dentro de um lote em até 30 segundos. Isso pode ser uma política deliberada de permitir que um trabalho já autorizado termine; não classifico automaticamente como bypass. Precisa ser definido e documentado: autorização vale para o lote inteiro ou para cada unidade mutante?

Se a política for por operação, revalidar entre instaladores/ações, jamais matar uma instalação já em andamento por expiração. Testar com relógio e transporte falsos: primeiro instalador termina após a autorização expirar, licença é revogada, segundo instalador só inicia conforme a política acordada. Esse ponto complementa o cancelamento cooperativo da parte 3.

## Proteções verificadas no código

- O token nativo exige formato hexadecimal de 64 caracteres e fica em arquivo protegido por DPAPI no escopo do usuário; não inspecionei seu conteúdo.
- `public_response` seleciona campos explicitamente e não entrega o token nem as evidências de autorização ao JavaScript.
- O destino HTTPS é fixo no transporte nativo; há bloqueio de redirects, limites de resposta e validação padrão de certificado/hostname preservada.
- A evidência de autorização confere status, dispositivo, prazo e resposta permitida; o prazo local usa `Instant`. Uma verificação online malsucedida invalida o grant anterior.
- Há chamadas de licença nos caminhos mutantes examinados de Advanced, Performance, Startup, Gamer, dependências, Clean, Profiles, Anti-cheat e reinício. Isso é inventário de chamadas, não prova formal de cobertura de todo caminho possível.
- Recuperação é intencionalmente isenta de licença no backend. O gate fornece link de Segurança e Recuperação; não encontrei fundamento para afirmar que toda recuperação exige licença.
- O handler de sessão limita tamanho e formato de entrada, gera token aleatório e envia seu hash para RPC. O handler administrativo verifica chave ativa no servidor antes de despachar operações.

## Checagem Supabase e o que não deve ser confundido

O projeto usa sessão própria de licença, não um JWT de Supabase Auth para esse protocolo. `verify_jwt=false` torna a verificação da credencial responsabilidade do handler e de suas RPCs; isoladamente, não demonstra endpoint sem autenticação. A [documentação oficial de autenticação de Edge Functions](https://supabase.com/docs/guides/functions/auth) distingue o controle da plataforma da autenticação implementada no handler. Não proponho ativar essa flag cegamente e quebrar o cliente nativo.

O segredo de serviço usado pelos handlers vem do ambiente do servidor nos arquivos examinados. Isso não equivale a uma varredura completa do histórico Git em busca de segredos. Não há decisões de autorização baseadas em `user_metadata` nos handlers examinados. Sessões, ownership, RLS, privilégios de funções e revogação transacional dependem das migrações SQL e precisam de auditoria específica, sem consultas a dados pessoais.

## Entrega e próximo bloco

Único arquivo criado: este relatório fora do repositório. Nenhum código alterado, commit, push, migração ou mutação em Supabase. A modificação preexistente em `src/routeTree.gen.ts` foi preservada.

Próximo bloco: migrações de licenciamento, RLS e permissões das RPCs — especialmente ativação simultânea, expiração, revogação, transferência e isolamento administrativo. Após isso, atualização/distribuição e consolidação do plano de correções. Não considero concluída a revisão de segurança nem pronta a beta com alterações reais.
