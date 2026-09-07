# Auditoria Hermes/NEX Optimizer - 2026-09-07

Auditoria feita sem Rust/cargo instalado na máquina (só Node/npm disponíveis). Isso significa:
- O frontend (Vite dev) foi testado de verdade no navegador.
- O backend Rust foi revisado estaticamente (linha por linha, por 5 agentes em paralelo) e as correções abaixo foram aplicadas no código, **mas nenhuma foi compilada/verificada com `cargo build`** porque o toolchain Rust não está instalado aqui. Antes de confiar nelas, rode:

```bash
npm run build:windows:test
```

e confira que compila limpo.

## 1. Correções já aplicadas no código

### 1.1 CRÍTICO — "Otimizar Agora" ignorava o modo seguro (corrigido)

Achado, de forma independente, em **dois arquivos** pelos agentes de auditoria:

- `src-tauri/src/clean.rs` — `clean_engine_apply_optimize_now`
- `src-tauri/src/advanced.rs` — `advanced_engine_apply_optimize_now`

Os dois chamavam a função interna de aplicação com `enforce_safe_test_mode = false`, ou seja: mesmo num build compilado em modo teste (`HERMES_SAFE_TEST_MODE=true`, o padrão), o botão "Otimizar Agora" conseguia rodar limpeza real e comandos avançados reais se o frontend mandasse `confirmed: true`. Isso furava o interruptor mestre de segurança do app inteiro.

**Corrigido**: os dois agora sempre passam `true` (sempre respeitam o modo seguro global), igual ao caminho normal (`clean_engine_apply` / `advanced_engine_apply`).

### 1.2 Fate Trigger "prioridade alta" não fazia nada (corrigido)

`src-tauri/src/advanced.rs`, função `set_fate_trigger_cpu_priority_high_plan`.

A ação escreve `CpuPriorityClass` no registro (IFEO PerfOptions) para priorizar os executáveis do Fate Trigger/UE5. A escala desse valor é: 1=Baixa, 2=Abaixo do normal, **3=Normal**, 4=Acima do normal, 5=Alta, 6=Tempo real.

O código escrevia `3` (Normal) — ou seja, a ação chamada "Prioridade CPU Alta do Fate Trigger" na prática **não aplicava nenhum boost**, só confirmava o valor padrão do Windows.

**Corrigido**: agora escreve `5` (Alta), que é o que a ação promete.

### 1.3 Startup Engine podia desativar Steam/Discord/anti-cheat/antivírus/drivers (corrigido)

`src-tauri/src/startup.rs`.

A classificação de impacto (`classify_impact`) marcava Steam, Discord e Razer como "Alto impacto", e o fluxo padrão do Botão 1 desativa automaticamente tudo que é "Alto impacto, ativo e controlável" — sem nenhuma lista de proteção. Isso contraria diretamente a regra do próprio projeto ("nunca tocar antivírus, drivers, áudio, GPU, Steam, Discord ou anti-cheat mesmo que pareçam de alto impacto"), e Discord/Steam tipicamente registram autostart em `HKCU\...\Run`, que é exatamente onde o Startup Engine tem permissão de escrever.

**Corrigido, depois refinado a seu pedido**: separei em duas categorias em vez de uma trava única:

- **Trava dura** (`is_hard_protected_startup_vendor`) — anti-cheat (BattlEye/EasyAntiCheat/Vanguard/FACEIT), antivírus de terceiros e "drivers" de GPU/áudio (NVIDIA/AMD/Realtek/Intel Graphics/Windows Defender). Esses o NEX **nunca** desativa, nem se alguém selecionar manualmente o item por ID — mexer nisso é risco real (ban de anti-cheat, segurança), não é uma otimização de verdade.
- **Trava suave** (`is_soft_protected_startup_vendor`) — Steam, Discord, Razer/Logitech/Corsair, Epic, Battle.net, Adobe. Esses **continuam podendo ser desativados** (você pediu, faz sentido — é só o auto-abrir, não desliga o app nem o jogo), mas só quando o usuário seleciona esse item específico e confirma. Nunca mais entram no pacote automático "desativar tudo que é alto impacto" do Botão 1 sem avisar item por item.

Pra isso funcionar, passei um sinalizador `explicit_selection` (verdadeiro só quando o pedido veio com IDs de item específicos, não no modo "desative tudo automaticamente") desde `startup_engine_apply_blocking` até `apply_startup_item`.

### 1.4 Restore não conseguia restaurar a maioria das categorias de limpeza (corrigido)

`src-tauri/src/restore.rs` tinha sua própria cópia de `allowed_clean_roots()`, desatualizada em relação à do `clean.rs`. A allowlist de restauração só cobria: TEMP, Windows Temp/Logs, SoftwareDistribution, cache do Edge/Chrome, D3DSCache e Explorer.

Faltavam: cache da Windows Store, shader cache NVIDIA/AMD, cache do Epic Games Launcher, Battle.net, Discord e OBS, e cache/depotcache do Steam — ou seja, **8 das 13 categorias que o Clean Engine sabe colocar em quarentena não podiam ser restauradas**, mesmo com o arquivo fisicamente intacto na quarentena. A promessa de "rollback disponível" era falsa pra maioria das categorias.

**Corrigido**: copiei as entradas que faltavam do `clean.rs` para o `restore.rs`, deixando as duas listas iguais.

### 1.5 Profiles: conflito só avisava, não bloqueava (corrigido)

`src-tauri/src/profiles.rs`, função `profiles_apply_blocking`.

`validate_profile_conflicts` já detectava conflitos reais (ex: perfil com Alto Desempenho + Economia de Energia ao mesmo tempo) e gerava um aviso dizendo textualmente "aplicação deve ser bloqueada em revisão" — mas nada no código de fato bloqueava; o perfil era aplicado do mesmo jeito. Hoje nenhum dos 6 perfis prontos bate esse conflito (por isso não é um bug ativo agora), mas era uma bomba-relógio pra qualquer edição futura de perfil.

**Corrigido**: se `!dry_run` e existe algum conflito, `profiles_apply_blocking` agora retorna erro antes de tocar em qualquer engine, em vez de só logar o aviso.

### 1.6 Verificação de publisher fraca e sem allowlist de pacote (corrigido)

`src-tauri/src/gamer_dependencies.rs`.

Dois problemas relacionados, ambos na verificação antes de instalar VC++ Redistributable/DirectX:

- A checagem de "é assinado pela Microsoft?" fazia um `contains()` (substring) no campo inteiro do certificado, usando como referência um campo (`required_publisher`) que vem do payload do frontend, não fixo no Rust. Um certificado como `O="Not Microsoft Corporation Reseller LLC"` passaria, e se o manifesto do frontend fosse comprometido/mal configurado, o check inteiro perderia força.
- O backend não travava explicitamente que só `vc-redist-*`/`directx-end-user-runtime` podem ser instalados — confiava só em URL+hash+assinatura, que a Microsoft também usa pra assinar coisas como Visual Studio Build Tools (que a regra do projeto proíbe explicitamente como dependência gamer). Conferi o manifesto do frontend (`src/lib/gamer-dependencies.ts`) e ele já separa certinho isso (VS Build Tools/SDK/etc. ficam numa lista `neverAutoInstall` separada, nunca chegam no motor de instalação) — mas o Rust não tinha essa trava por conta própria, dependia só da disciplina do frontend.

**Corrigido**:
- Nova função `subject_confirms_microsoft()` que faz parsing do campo `O=` do certificado e compara exato (case-insensitive) contra `"Microsoft Corporation"` fixo no Rust, ignorando o `required_publisher` do payload. Trocada em todos os 4 lugares que faziam a checagem antiga.
- Nova função `is_allowed_gamer_dependency_id()`, uma allowlist hardcoded (`vc-redist-*` ou `directx-end-user-runtime`) checada tanto em `verify_package` quanto (o ponto que realmente importa) em `install_package_from_cache`, antes de rodar qualquer instalador.

### 1.7 Limpeza: código duplicado morto no Advisor (corrigido)

`src-tauri/src/advisor.rs` tinha duas implementações da mesma lógica de recomendações: uma v1 (`build_report`, marcada `#[allow(dead_code)]`, sem nenhum lugar chamando ela) e a v2 (`build_smart_report`, a que realmente roda). Elas tinham pesos e regras diferentes e iam divergir com o tempo sem ninguém notar. Confirmei via grep que `build_report` do advisor não tinha nenhum call site (os outros `build_report` que aparecem no projeto são funções de mesmo nome só que privadas de outros arquivos, sem relação). Deletei a v1 inteira (~175 linhas).

## 2. Uma correção que os agentes sugeriram e eu NÃO apliquei (verificada como falso positivo)

Dois agentes, de forma independente, apontaram `src-tauri/src/safe_mode.rs` como bug crítico:

```rust
pub fn is_enabled() -> bool {
    parse_safe_mode_flag(option_env!("HERMES_SAFE_TEST_MODE")).unwrap_or(DEFAULT_SAFE_TEST_MODE)
}
```

`option_env!` é uma macro de **compile-time**, não lê a variável de ambiente em runtime. O argumento deles: "definir a env var antes de rodar o .exe não tem efeito nenhum".

Isso é tecnicamente verdade, **mas não é um bug** — eu conferi contra `scripts/build-windows-controlled.ps1`, que é o script oficial de build (`npm run build:windows:real`). Ele exporta `$env:HERMES_SAFE_TEST_MODE` **antes** de chamar `npx tauri build`, ou seja, o valor é lido exatamente no momento da compilação, que é a intenção documentada em `PROJETO_OBJETIVO.md`: o modo real só é liberado "explicitamente com `HERMES_SAFE_TEST_MODE=false` no backend Rust" via o build controlado — nunca em runtime. Isso é, na verdade, mais seguro que uma env var de runtime (ninguém consegue destravar o modo real só setando uma variável depois de instalado).

Não toquei nesse arquivo. Só um risco residual real aqui: se algum dia alguém rodar `cargo build`/`npx tauri build` diretamente, pulando o script controlado, e tiver `HERMES_SAFE_TEST_MODE=false` esquecido no shell, o binário sai em modo real sem passar pelos gates de release. Isso já é coberto pela regra "build real depende de instalador/build controlado" no `BOTAO1_PREPARAR_PC_REAL.md`, então é mais um lembrete de processo do que um bug de código.

## 3. Achados que NÃO corrigi (peço pra você decidir/revisar)

1. **`gamer_dependencies.rs` — download/verificação roda mesmo em modo teste**: baixar e cachear o instalador em disco acontece independente do `safe_test_mode` (só a instalação final é que respeita o modo). Pode ser intencional (separar "preparar cache" de "instalar"), mas quebra a promessa de "nada acontece de verdade em modo teste" se alguém interpretar literalmente. Não mexi porque não tenho certeza se é intencional, e mudar isso pode atrapalhar o fluxo de "deixar tudo em cache pronto pra quando liberar o modo real".
2. **`licensing.rs` — sem verificação de licença no Rust**: o arquivo só gera um fingerprint do dispositivo (hash do MachineGuid). Não encontrei nenhuma checagem de licença/entitlement no backend Rust inteiro — se o desbloqueio de recursos Pro depende só do que o Supabase/JS decide no cliente, é trivialmente contornável (patch no bundle JS). Não é vazamento de segredo, é ausência de reforço no lado nativo. Isso é decisão de produto/arquitetura, não fiz nada.
3. **`nex-ai` / `advisor_ai_engine.rs`**: não é IA nenhuma — é um motor de regras `if/else` local, 100% offline, sem chamada de rede (bom pra privacidade, mas o nome "NEX AI" pode ser enganoso se usado em marketing). Cosmético/nome, não mexi.

## 4. Achado ao rodar o app de verdade no navegador (sem Tauri)

Rodei `npm run dev` e testei o fluxo "Preparar PC" clicando de verdade na UI (em `http://localhost:8080`, sem backend Rust compilado). Dois problemas visuais/lógicos:

- **118 erros de console React** ("Encontrados dois filhos com a mesma key") — bug de renderização em alguma lista com `key` duplicada. Vale investigar com o DevTools do React (Components tab) pra achar qual componente.
- **A tela declarou "Preparação concluída" mesmo com todo o backend indisponível.** Isso acontece porque, sem Tauri, cada chamada de "aplicar" (`applyAdvancedActions`, etc.) lança erro, o executor (`runQuickPrepareTask` em `src/lib/quick-prepare.ts`) captura esse erro e marca o passo como `unavailable` — mas o loop só trata isso como falha fatal se `requiresRealAdmin(context)` for verdadeiro, e isso exige `executionMode === "real" && !HERMES_SAFE_TEST_MODE`. Em modo teste (o padrão), passos que erroram silenciosamente não impedem a barra de progresso de fechar como "concluído". Não é perigoso (nada real foi alterado), mas é uma falha de honestidade de UI: o usuário vê "sucesso" mesmo quando 10+ passos falharam por falta de backend. Vale distinguir "completou de verdade" de "completou (mas alguns passos ficaram indisponíveis)" na barra de status.

## 5. O que ficou fora do escopo desta auditoria

- Não instalei Rust/cargo (não tentei sem confirmar com você antes — é um toolchain grande). Sem isso não dá pra compilar nem rodar o app Tauri de verdade (janela nativa, comandos reais). Se quiser que eu instale e rode a build real pra testar os botões de ponta a ponta, é só pedir.
- `supabase/` (schema, RLS, edge functions) não foi auditado.
- Frontend React (componentes, exceto o que apareceu ao vivo) não foi revisado linha a linha, só o suficiente pra entender o fluxo dos dois botões.

## 6. Arquivos alterados nesta sessão

```
M src-tauri/src/advanced.rs            (bypass optimize_now + fix Fate Trigger)
M src-tauri/src/clean.rs               (bypass optimize_now)
M src-tauri/src/restore.rs             (allowlist de restauração sincronizada)
M src-tauri/src/startup.rs             (proteção Steam/Discord/anti-cheat/AV/drivers)
M src-tauri/src/profiles.rs            (conflito de perfil agora bloqueia de verdade)
M src-tauri/src/gamer_dependencies.rs  (publisher check exato + allowlist de pacote)
M src-tauri/src/advisor.rs             (removido build_report v1, código morto)
A docs/auditoria-2026-09-07.md         (este relatório)
M src/routeTree.gen.ts                 (regenerado automaticamente pelo `npm run dev` do TanStack Router - não editei isso, é rotina)
```

Sanity check que rodei (contagem de chaves `{`/`}` por arquivo, já que não tenho compilador aqui): todos batendo certinho em advanced.rs, clean.rs, restore.rs, startup.rs, profiles.rs, gamer_dependencies.rs e advisor.rs. Não prova que compila, só descarta o erro mais comum de edição manual (chave sobrando/faltando).

Nada foi commitado. Roda `git diff` pra revisar, e `npm run build:windows:test` pra confirmar que compila antes de confiar nas mudanças.
