/* DOMUS+ — Modo ao vivo: o mesmo site aberto em vários aparelhos fica sincronizado.
 *
 * No site publicado (pedropinto2828.github.io) o modo ao vivo liga-se sozinho:
 * o que se faz num aparelho (ligar a ventoinha, abrir a janela, escolher um
 * cenário, mexer numa barra do simulador, mudar de modo ou de página) acontece
 * também em todos os outros que tenham o site aberto.
 * Também se liga no computador (Live Server); como só funciona em modo de
 * demonstração, nunca interfere com a ESP32. Para usar o site sozinho: ?sozinho.
 * Não é preciso recarregar a página: as mudanças chegam sozinhas e, se o
 * telemóvel bloquear o ecrã ou perder a rede, a ligação é refeita ao voltar.
 *
 * Só se enviam as AÇÕES das pessoas, com o estado que resultou delas. As regras da
 * casa (chuva, gestão térmica, automatizações) correm em cada aparelho a partir
 * do mesmo estado, por isso todos chegam às mesmas decisões sem mensagens extra.
 *
 * Como o site está no GitHub Pages (sem servidor próprio), as mensagens passam
 * pelo serviço público e gratuito ntfy.sh: cada aparelho publica um pequeno JSON
 * num "tópico" e todos estão a escutar esse tópico.
 * Só funciona em modo de demonstração (valores simulados) e precisa de Internet.
 * As mensagens são públicas para quem souber o nome do tópico: não levam
 * nenhum dado pessoal nem o token da ESP32.
 */
const LIVE_TOPIC = "domus-pap-pedropinto-2027";
const LIVE_SERVER = "https://ntfy.sh/";
const LIVE_WAIT_MS = 80;           // junta as mudanças de um mesmo clique numa só mensagem

const liveParams = new URLSearchParams(window.location.search);
const liveOn = !liveParams.has("sozinho");
const liveId = Math.random().toString(36).slice(2, 10);   // identifica este aparelho

let liveSendTimer = 0;
let liveApplying = false;       // true enquanto se aplica uma mensagem recebida
let liveManualOrder = false;    // a ação foi uma ordem manual (janela, estore, ventoinha)
let liveBanner = null;
let liveLastMessageAt = 0;
const liveSeenIds = new Set();  // mensagens já aplicadas (ao religar, o serviço reenvia a última)

// Campos do estado que todos os aparelhos partilham
const LIVE_STATE_FIELDS = ["temperatureC", "temperatureOutC", "humidityPercent", "luminosityLux",
    "rainDetected", "motionDetected", "windows", "lights", "season", "targetTemp", "fanOn",
    "faucetOn", "faucetRemainingSeconds", "activeMode", "forecast"];

function currentPageName() {
    const active = document.querySelector("[data-page-view].active");
    return active ? active.dataset.pageView : "home";
}

function showLiveBanner(text, kind) {
    if (!liveBanner) {
        liveBanner = document.createElement("div");
        liveBanner.setAttribute("role", "status");
        document.body.append(liveBanner);
    }
    liveBanner.className = `live-banner ${kind}`;
    liveBanner.textContent = text;
}

/* ---------- enviar: depois de cada ação de uma pessoa ---------- */

function liveAction(manual = false) {
    if (!liveOn || liveApplying || connectionMode !== "demo") return;
    if (manual) liveManualOrder = true;
    window.clearTimeout(liveSendTimer);
    liveSendTimer = window.setTimeout(sendLiveNow, LIVE_WAIT_MS);
}

async function sendLiveNow() {
    const state = {};
    LIVE_STATE_FIELDS.forEach((key) => { state[key] = demoState[key]; });
    if (demoState.faucetOn && faucetDemoStopsAt) {
        state.faucetRemainingSeconds = Math.max(0, Math.ceil((faucetDemoStopsAt - Date.now()) / 1000));
    }
    const message = JSON.stringify({
        v: 3, from: liveId, manual: liveManualOrder, page: currentPageName(), state
    });
    liveManualOrder = false;
    try {
        // Pedido simples (texto), por isso o navegador não precisa de pedido OPTIONS
        await fetch(LIVE_SERVER + LIVE_TOPIC, { method: "POST", body: message });
    } catch (error) {
        showLiveBanner("Sem Internet: os outros aparelhos não estão a receber", "off");
    }
}

/* ---------- receber ---------- */

function applyLiveMessage(text) {
    let data;
    try { data = JSON.parse(text); } catch (error) { return; }
    if (!data || data.v !== 3 || !data.state || data.from === liveId) return;   // ignora as suas
    if (connectionMode !== "demo") return;
    liveLastMessageAt = Date.now();
    liveApplying = true;
    try {
        Object.assign(demoState, data.state);
        // Temporizador da torneira continua daqui
        faucetDemoStopsAt = demoState.faucetOn
            ? Date.now() + Number(demoState.faucetRemainingSeconds || 0) * 1000 : 0;
        // Estação e temperatura-alvo também nas Definições deste aparelho
        if (houseSettings.season !== demoState.season || houseSettings.targetTemp !== demoState.targetTemp) {
            houseSettings.season = demoState.season;
            houseSettings.targetTemp = demoState.targetTemp;
            saveDemoSettings();
            renderHouseSettings();
        }
        // Uma ordem manual dada noutro aparelho também pausa a gestão térmica, como na ESP32
        if (data.manual) simPauseUntil = Date.now() + THERMAL_PAUSE_DEMO_MS;
        if (data.page && data.page !== currentPageName()) navigateToPage(data.page, { updateHistory: false });
        runSimulation();          // aplica as regras ao novo estado e desenha
        renderState(demoState);
    } finally {
        liveApplying = false;
    }
    showLiveBanner("● Ao vivo: ligado aos outros aparelhos", "on");
}

let liveSource = null;

function startLiveListening() {
    if (liveSource) liveSource.close();
    // since=latest: quem abre o site a meio (ou volta a ele) recebe logo o último estado
    const source = new EventSource(`${LIVE_SERVER}${LIVE_TOPIC}/sse?since=latest`);
    liveSource = source;
    source.onopen = () => showLiveBanner("● Ao vivo: ligado aos outros aparelhos", "on");
    source.onmessage = (event) => {
        try {
            const envelope = JSON.parse(event.data);
            if (envelope.event !== "message" || liveSeenIds.has(envelope.id)) return;
            liveSeenIds.add(envelope.id);
            applyLiveMessage(envelope.message);
        } catch (error) { /* mensagem que não é do DOMUS+ */ }
    };
    // O navegador volta a ligar sozinho; só se avisa se não chega nada há algum tempo
    source.onerror = () => {
        if (Date.now() - liveLastMessageAt > 20000) showLiveBanner("Ao vivo: sem ligação, a tentar de novo…", "off");
    };
}

/* ---------- ligação às ações existentes ---------- */

if (liveOn) {
    const liveBaseControl = controlDevice;
    controlDevice = async function controlDeviceLive(device, value) {
        const ok = await liveBaseControl(device, value);
        liveAction(device.startsWith("window") || device === "fan");
        return ok;
    };
    const liveBaseMode = activateMode;
    activateMode = async function activateModeLive(mode) {
        const ok = await liveBaseMode(mode);
        liveAction();
        return ok;
    };
    const liveBaseScenario = applyScenario;
    applyScenario = async function applyScenarioLive(key) {
        await liveBaseScenario(key);
        liveAction();
    };
    const liveBaseNavigate = navigateToPage;
    navigateToPage = function navigateToPageLive(pageName, options) {
        liveBaseNavigate(pageName, options);
        liveAction();
    };
    // Barras, chuva, movimento e estação do simulador: enviar quando se larga
    document.querySelectorAll("#simulatorSection input").forEach((input) =>
        input.addEventListener("change", () => liveAction()));
    // O botão "Retomar agora" também conta como ação
    const resume = document.getElementById("simResume");
    if (resume) resume.addEventListener("click", () => liveAction());
    startLiveListening();
    // O telemóvel corta a ligação quando o ecrã bloqueia ou o site fica em segundo
    // plano; ao voltar, liga de novo e recebe o último estado, sem recarregar a página
    const liveReconnect = () => {
        if (document.visibilityState === "visible" &&
            (!liveSource || liveSource.readyState === EventSource.CLOSED || Date.now() - liveLastMessageAt > 30000)) {
            startLiveListening();
        }
    };
    document.addEventListener("visibilitychange", liveReconnect);
    window.addEventListener("online", startLiveListening);
    window.addEventListener("pageshow", (event) => { if (event.persisted) startLiveListening(); });
    window.setInterval(() => {
        if (liveSource && liveSource.readyState === EventSource.CLOSED) startLiveListening();
    }, 5000);
}
