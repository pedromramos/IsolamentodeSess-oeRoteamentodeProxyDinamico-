# Gerenciador de Sessões com Proxy Exclusivo por Sessão

Este projeto implementa um aplicativo para iniciar múltiplas sessões de navegação isoladas, onde cada sessão utiliza um proxy de saída distinto (HTTP/SOCKS5, com suporte a autenticação). O backend realiza todo o roteamento e a orquestração das sessões; o frontend oferece um painel simples para controle mestre (reload, navegar, play/pause/mute) e visualização do IP e screenshot por sessão.

## Sumário Executivo

- **Problema**: Necessidade de abrir N sessões para uma mesma URL, garantindo isolamento completo (cookies/armazenamento/estado) e IP exclusivo por sessão, com controles sincronizados para gestão de mídia e navegação.
- **Solução**: Backend Node.js + Playwright que cria um processo Chromium por sessão, aplicando o proxy exclusivo e diretório de dados próprio. UI em HTML/CSS (Tailwind) + JavaScript para iniciar sessões, exibir IPs e screenshots, e emitir comandos mestre.
- **Benefícios**:
  - Isolamento rígido por design: `user-data-dir` por sessão e proxy dedicado.
  - Controle em tempo real via WebSocket.
  - Extensível para cenários de alto tráfego/streaming (YouTube, Twitch, etc.).

## Arquitetura

- **Backend (Node.js + Express + Playwright + WS)**
  - `ProxyManager`: carrega lista de proxies, controla alocação exclusiva e liberação.
  - `SessionManager`: cria sessões (Chromium persistente), aplica `proxy`, inicia navegação, resolve IP público (via proxy) e tira screenshots periódicos.
  - API REST: upload/lista de proxies, criação/lista/remoção de sessões, controles mestre.
  - WebSocket: broadcast de estado das sessões para o frontend.
- **Frontend (HTML + Tailwind + JS)**
  - Formulário para inserir proxies, URL e quantidade de sessões.
  - Grid com cartões por sessão exibindo status, proxy, IP e screenshot.
  - Botões de controle mestre: Reload, Play, Pause, Mute, Unmute.

### Fluxo de Dados
1. Usuário fornece lista de proxies, URL e quantidade.
2. Backend valida e aloca proxies exclusivos; cria sessões com Chromium (cada uma com `user-data-dir` e `proxy`).
3. Cada sessão navega até a URL e resolve o IP público através do proxy configurado.
4. Frontend recebe estado via WS e renderiza IP, status e screenshot de cada sessão.
5. Comandos mestre são enviados ao backend, que executa em todas as sessões.

## Endpoints (MVP)

- `POST /proxies` — body: `{ proxies: string[] }` → carrega/substitui a lista de proxies.
- `GET /proxies` — lista proxies carregados.
- `POST /sessions` — body: `{ url: string, count: number }` → cria N sessões.
- `GET /sessions` — lista sessões.
- `GET /sessions/:id` — detalhes de uma sessão.
- `DELETE /sessions/:id` — encerra e remove sessão.
- `POST /control/:action` — aplica ação em todas as sessões. Ações suportadas: `reload`, `navigate` (body `{ url }`), `play`, `pause`, `mute`, `unmute`.
- `GET /health` — healthcheck simples.
- `WS /ws` — eventos de estado em tempo real `{ type: 'state', sessions: [...] }`.

## Execução Local

Pré-requisitos: Node.js 18+.

```bash
npm install
npm start
# Acesse http://localhost:3000
```

Durante a instalação, o Playwright baixará o Chromium. Em ambientes limitados, considere usar o Docker.

## Docker

```bash
docker build -t session-proxy-app .
docker run --rm -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/public/screenshots:/app/public/screenshots \
  session-proxy-app
# Acesse http://localhost:3000
```

Os volumes montados preservam dados de sessão e screenshots entre execuções.

## Uso do Frontend

1. Cole a lista de proxies (um por linha), por exemplo:
   - `socks5://user:pass@host:1080`
   - `http://host:3128`
2. Informe a URL alvo (ex.: `https://www.youtube.com/`).
3. Informe a quantidade de sessões.
4. Clique em "Iniciar". As sessões aparecerão no grid com status, IP e screenshot.
5. Use os botões de controle para agir sobre todas as sessões simultaneamente.

## Considerações Técnicas Importantes

- **Isolamento**: cada sessão usa `chromium.launchPersistentContext` com diretório exclusivo. Cookies/localStorage/cache não são compartilhados.
- **Proxy por sessão**: aplicado no contexto Playwright via `{ proxy: { server, username, password } }`.
- **Resolução de IP**: feita preferencialmente no backend com `proxy-agent` (requisição a `api.ipify.org` via proxy). Como fallback, tenta via `fetch` na própria página.
- **Captura de tela**: screenshots periódicos (config padrão ~4s) para observabilidade. Pode ser evoluído para WebRTC.
- **Estabilidade**: timeouts e captura de erros nas ações; proxies podem falhar. É possível estender com health-checks e rotatividade.
- **Escalabilidade**: para muitas sessões com vídeo, considere: headless com throttling, flags de economia de recursos, escalonamento horizontal e GPU em hosts adequados.

## Estrutura de Pastas

```
server/
  index.js                  # servidor Express + WS
  managers/
    ProxyManager.js         # gestão de proxies
    SessionManager.js       # criação/controle de sessões
  utils/
    ipCheck.js              # resolução de IP via proxy
public/
  index.html                # UI (Tailwind via CDN)
  app.js                    # lógica de UI e WebSocket
  screenshots/              # imagens por sessão (runtime)
 data/
  sessions/                 # perfis persistentes por sessão (runtime)
```

## Roadmap (além do MVP)

- Health-check ativo de proxies e marcação de falhas.
- Troca automática de proxy em erro de sessão.
- Streaming ao vivo dos frames (WebRTC) ao invés de screenshots.
- Controles específicos YouTube/Twitch via APIs oficiais quando detectado.
- Persistência e RBAC para ambientes multiusuário.
- Observabilidade (Prometheus/Grafana) e tracing de ações.

## Avisos e Compliance

- O uso deve obedecer às políticas e termos de serviço das plataformas alvo (YouTube, Twitch, etc.).
- Certifique-se de ter autorização para executar testes de carga/monitoramento em escala.
- Respeite legislações locais sobre privacidade, interceptação e automação de tráfego.
