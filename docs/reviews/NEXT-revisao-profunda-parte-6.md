# NEXT — revisão profunda, parte 6: assinatura e distribuição

Data: 13/09/2026. Base: `1fef2a34397c70d54ab063457961b64fb6fb9c6f`.

## Escopo

Revisão estática de configuração Tauri, capability padrão, workflows de Windows, importação de certificado, preflight de assinatura, verificação de candidato e gate/empacotamento público. Nenhum instalador, app, build, workflow ou script de release foi executado. Não consultei segredos, certificados instalados ou credenciais reais. Não houve publicação ou contratação de serviço.

Quatro achados sustentados pelo código. P1: corrigir antes de usar credenciais reais de assinatura ou distribuir versão pública; P2: reforço necessário de identidade do artefato. Não foram reproduzidos ataques nem comprovados vazamentos. A análise não certifica políticas efetivas do GitHub, configuração do certificado ou pacotes já publicados.

## F01 — P1: segredo de assinatura disponível para o job inteiro

[release-windows-signed.yml:37](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/.github/workflows/release-windows-signed.yml:37) injeta PFX em base64 e senha no ambiente do job. Isso inclui checkout, setup de ferramentas, `npm ci`, lint e scripts de build, não apenas a importação. Um script/dependência comprometido executado nessas etapas pode acessar ambos. O mascaramento de logs não isola segredos de processos que os recebem.

O workflow também referencia actions por tags/branch (`@v4`, `@stable`), não por commits imutáveis, e não declara `environment` protegido. Não inspecionei controles externos do repositório, portanto não afirmo que qualquer pessoa possa disparar esse workflow. O achado é o escopo excessivo de exposição quando ele roda com os secrets configurados.

Proposta: separar build/testes sem credenciais de um job mínimo de assinatura com artefatos identificados por hash e origem; disponibilizar secrets apenas na etapa necessária, fixar actions por SHA e usar aprovação de ambiente quando disponível. Apenas mover variáveis para uma etapa no mesmo runner não elimina persistência de código comprometido executado antes. Não exige contratar um serviço de assinatura nesta fase.

Teste proposto: credenciais fictícias e scripts de inspeção seguros confirmam ausência das variáveis em instalação de dependências/testes; nunca imprimir valores reais. Validar procedência e hash dos artefatos transferidos entre jobs.

Base: [GitHub — uso seguro de Actions](https://docs.github.com/en/actions/reference/security/secure-use?ref=devaisemanal.com) e [uso de secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## F02 — P1: falha na importação pode deixar PFX temporário no disco

[import-signing-pfx.ps1:42](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/scripts/import-signing-pfx.ps1:42) grava o PFX recebido em base64 em `.release/hermes-signing-input.pfx`. Sua remoção só acontece ao final, em 121–122. Há operações que podem lançar erro antes: leitura com senha, checagem de uso/validade do certificado, importação e gravação dos relatórios. O `finally` existente fecha apenas o store, não remove o PFX.

Consequência: senha incorreta, certificado rejeitado ou outro erro intermediário pode deixar o arquivo contendo a chave privada protegida por senha no workspace. Isso não é chave privada em texto puro nem prova de upload do arquivo; o workflow não lista esse PFX entre seus artefatos. Em execução local, porém, o resíduo pode persistir.

Proposta: arquivo temporário de nome único e acesso restrito, com remoção em `finally` cobrindo toda a importação; limpar somente o temporário criado pelo script, jamais apagar o PFX original fornecido pelo usuário. Definir também o ciclo de vida do certificado importado no runner de assinatura.

Teste proposto: fixture sem credencial real, falhas injetadas em cada etapa após a criação do temporário; verificar limpeza em todos os caminhos e preservação do arquivo original.

## F03 — P1: pacote final não está vinculado ao hash do candidato aprovado

[verify-release-candidate.ps1:60](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/scripts/verify-release-candidate.ps1:60) calcula e compara SHA256 e tamanho com o manifesto. Essa proteção existe. Entretanto, `release-status.ps1` lê o JSON de verificação já produzido (103–104, 136–139), sem executar novamente essa verificação.

[verify-public-release-ready.ps1:116](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/scripts/verify-public-release-ready.ps1:116) confere assinatura atual, mas aceita o relatório de integridade anterior em 128–137. O empacotador chama esse gate, copia arquivos e calcula novos hashes em [create-public-release-package.ps1:81](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/scripts/create-public-release-package.ps1:81), sem compará-los com os hashes aprovados.

Cenário: depois de validar/testar o candidato A, o arquivo é substituído por B, também com assinatura válida — inclusive outra versão legitimamente assinada pelo mesmo editor. Sem nova verificação do candidato, os relatórios continuam GO e o pacote ganha um hash novo, sem provar que B passou pelo QA de A. Isso não demonstra adulteração ocorrida; demonstra que o gate não assegura a identidade entre arquivo testado e entregue.

Proposta: comparar hash/tamanho do arquivo final com manifesto aprovado no momento do empacotamento, verificar assinatura também na cópia final e vincular commit, versão e evidência de QA ao mesmo digest. Impedir edição silenciosa do candidato após aprovação. Não basta gerar um checksum novo.

Teste proposto: candidato validado → troca por fixture diferente com assinatura simulada válida → empacotamento deve falhar. Testar também arquivo inalterado e modificação durante a cópia, usando verificador falso em vez de certificados reais.

## F04 — P2: assinatura válida não é comparada ao editor esperado

[signing-preflight.ps1:137](C:/Users/Henrique/Documents/Codex/2026-08-31/Hermes-Optimizer/scripts/signing-preflight.ps1:137) localiza o certificado configurado, mas o teste dos instaladores em 165–174 se baseia em `signatureStatus == Valid`. O gate público e o empacotador fazem a mesma checagem. Subject/thumbprint são registrados, sem comparação obrigatória com a identidade de assinatura aprovada.

Logo, o certificado configurado pode pertencer ao editor A enquanto um arquivo assinado validamente por B passa nessa condição. F03 trata identidade dos bytes; este achado trata identidade do signatário. A configuração do build solicita o certificado escolhido, mas não substitui a validação de quem efetivamente assinou o artefato recebido pelo gate.

Proposta: política explícita de signatários permitidos, incluindo rotação planejada, e validação do certificado do arquivo final contra essa política. Não usar apenas nome textual do editor como identidade. Conferir timestamp conforme a política de distribuição.

Teste proposto: assinatura válida de editor não permitido deve bloquear; assinatura válida do editor autorizado deve passar apenas se hash e demais evidências também corresponderem. [Microsoft — Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-7.5) documenta a inspeção da assinatura; a comparação com o editor esperado é uma política adicional do produto.

## Pontos positivos e limites

- A configuração Tauri define MSI/NSIS e upgradeCode do MSI. Não há plugin de updater configurado no arquivo examinado. A tela de configurações declara atualização manual e aponta para Releases do repositório NEXT; não considero ausência de atualização automática um defeito por si só.
- CSP está definido, com bloqueio de objetos e origens restritas por diretiva. Permanecem origens locais de desenvolvimento e wildcard Supabase: são candidatos a redução no build público, não uma exploração comprovada nesta revisão.
- A capability examinada enumera permissões de janela, deep-link e opener; não concede ali shell arbitrário. Isso não certifica todos os comandos customizados Rust, que exigem análise própria de entradas e autorização.
- O workflow de assinatura é manual e usa `contents: read`; cria artefatos de Actions, não uma GitHub Release automaticamente. Upload com `if: always()` inclui diagnósticos/instaladores mesmo em falha; esses arquivos não devem ser confundidos com aprovação pública.
- O gate exige decisões de QA e assinatura, e há uma verificação de candidato que compara hashes. Os achados tratam a ligação entre essas etapas, não ausência total de controle.
- O workflow de QA separado inclui testes puros e SQL isolado. Não confirmei que sua aprovação é obrigatória para o mesmo SHA antes de qualquer distribuição assinada; isso depende também das regras do repositório e precisa de validação posterior.

## Continuidade

Todos os testes descritos são propostas; nenhum foi executado nesta etapa. Único arquivo criado: este relatório fora do repositório. HEAD e modificação preexistente em `src/routeTree.gen.ts` preservados; nenhum commit, push, importação de certificado ou publicação.

Próximo passo: consolidar os seis relatórios em uma lista priorizada, separar bloqueadores de beta das melhorias posteriores e mapear os módulos ainda não revisados. Antes de implementar, fechar a prioridade e o escopo das correções. A revisão não está completa e não há autorização técnica para declarar o produto pronto apenas por estes seis blocos.
