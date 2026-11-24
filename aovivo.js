/* DOMUS+ — Simulação ao vivo e partilhada, para a apresentação.
 *
 * Quem apresenta abre o site com ?apresentar e quem assiste abre com ?aovivo
 * (é para aí que leva o código QR da apresentação). Todos ficam na mesma "sala":
 * o que qualquer pessoa muda (cenários, barras do simulador, equipamentos, modos,
 * página aberta) aparece logo em todos os ecrãs.
 *
 * Só o computador de quem apresenta (?apresentar) aplica as regras da casa
 * (chuva, automatizações, gestão térmica), para todos verem as mesmas decisões;
 * os outros enviam as suas ordens e recebem o resultado.
 *
 * Como não há servidor próprio (o site está no GitHub Pages), as mensagens
 * passam pelo serviço público e gratuito ntfy.sh: cada ecrã publica um pequeno
 * JSON num "tópico" e todos estão a escutar esse tópico.
 * Só funciona em modo de demonstração (valores simulados) e precisa de Internet.
 * As mensagens são públicas para quem souber o nome do tópico: não levam
 * nenhum dado pessoal nem o token da ESP32.
 */
const LIVE_TOPIC = "domus-pap-pedropinto-2027";
const LIVE_SERVER = "https://ntfy.sh/";
const LIVE_SLIDER_WAIT_MS = 350;   // enquanto se arrasta uma barra, espera parar um pouco
const LIVE_CLICK_WAIT_MS = 60;     // botões, cenários e páginas: envia quase de imediato

const liveParams = new URLSearchParams(window.location.search);
const liveRole = liveParams.has("apresentar") ? "presenter"
    : liveParams.has("aovivo") ? "viewer" : null;
const liveId = Math.random().toString(36).slice(2, 10);   // identifica este ecrã

let liveLastSent = "";          // último estado enviado (não reenvia o que não mudou)
let liveSendTimer = 0;
let livePending = false;        // há uma mudança feita neste ecrã que ainda não foi enviada
let liveApplying = false;       // true enquanto se aplica uma mensagem recebida
let liveDragging = false;       // true enquanto se mexe numa barra do simulador
let liveManualOrder = false;    // a última mudança foi uma ordem manual (janela, estore, ventoinha)
let liveCurrentPage = "";
let liveBanner = null;
let liveLastMessageAt = 0;
const liveSeenIds = new Set();  // mensagens já aplicadas (ao religar, o serviço volta a enviar a última)

// Campos do estado que todos os ecrãs partilham
const LIVE_STATE_FIELDS = ["temperatureC", "temperatureOutC", "humidityPercent", "luminosityLux",
    "rainDetected", "motionDetected", "windows", "lights", "season", "targetTemp", "fanOn",
    "faucetOn", "faucetRemainingSeconds", "activeMode", "thermalPaused"];

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

/* ---------- enviar ---------- */

function liveStateText() {
    const state = {};
    LIVE_STATE_FIELDS.forEach((key) => { state[key] = demoState[key]; });
    return JSON.stringify({ state, page: currentPageName() });
}

function scheduleLiveSend() {
    if (!liveRole || connectionMode !== "demo" || liveApplying) return;
    if (liveStateText() === liveLastSent) return;    // nada de novo para enviar
    livePending = true;
    window.clearTimeout(liveSendTimer);
    liveSendTimer = window.setTimeout(sendLiveNow, liveDragging ? LIVE_SLIDER_WAIT_MS : LIVE_CLICK_WAIT_MS);
}

async function sendLiveNow() {
    livePending = false;
    const stateText = liveStateText();
    if (stateText === liveLastSent) return;          // nada mudou
    liveLastSent = stateText;
    const message = JSON.stringify({
        v: 2, from: liveId, leader: liveRole === "presenter",
        manual: liveManualOrder, log: simLog.slice(0, 5), ...JSON.parse(stateText)
    });
    liveManualOrder = false;
    try {
        // Pedido simples (texto), por isso o navegador não precisa de pedido OPTIONS
        await fetch(LIVE_SERVER + LIVE_TOPIC, { method: "POST", body: message });
    } catch (error) {
        showLiveBanner("Sem Internet: os outros ecrãs não estão a receber", "off");
    }
}

/* ---------- receber ---------- */

function applyLiveMessage(text) {
    let data;
    try { data = JSON.parse(text); } catch (error) { return; }
    if (!data || data.v !== 2 || !data.state || data.from === liveId) return;   // ignora as suas
    // Se este ecrã acabou de mudar algo que ainda não enviou, a mudança local é a mais
    // recente: vai ser enviada já a seguir e passa a valer em todos os ecrãs
    if (livePending) return;
    liveLastMessageAt = Date.now();
    liveApplying = true;
    Object.assign(demoState, data.state);
    if (Array.isArray(data.log) && data.leader) simLog = data.log;
    // Uma ordem manual dada noutro ecrã também pausa a gestão térmica, como na ESP32
    if (data.manual && liveRole === "presenter") simPauseUntil = Date.now() + THERMAL_PAUSE_DEMO_MS;
    if (data.page && data.page !== liveCurrentPage) {
        liveCurrentPage = data.page;
        navigateToPage(data.page, { updateHistory: false });
    }
    renderState(demoState);
    liveLastSent = liveStateText();     // já está igual: não reenviar
    liveApplying = false;
    showLiveBanner("● Ao vivo: todos os ecrãs estão ligados", "on");
    // Quem apresenta aplica logo as regras ao novo estado e envia o resultado
    if (liveRole === "presenter") runSimulation();
}

function startLiveListening() {
    // since=latest: quem entra a meio recebe logo o último estado
    const source = new EventSource(`${LIVE_SERVER}${LIVE_TOPIC}/sse?since=latest`);
    source.onopen = () => showLiveBanner("● Ao vivo: ligado", "on");
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
        if (Date.now() - liveLastMessageAt > 20000) showLiveBanner("Ligação perdida; a tentar de novo…", "off");
    };
}

/* ---------- ligação às funções existentes ---------- */

if (liveRole) {
    const liveBaseRender = renderState;
    renderState = function renderStateLive(state) {
        liveBaseRender(state);
        scheduleLiveSend();
    };
    const liveBaseNavigate = navigateToPage;
    navigateToPage = function navigateToPageLive(pageName, options) {
        liveBaseNavigate(pageName, options);
        if (!liveApplying) liveCurrentPage = pageName;
        scheduleLiveSend();
    };
    const liveBaseControl = controlDevice;
    controlDevice = async function controlDeviceLive(device, value) {
        if (device.startsWith("window") || device === "fan") liveManualOrder = true;
        return liveBaseControl(device, value);
    };
    // Barras do simulador: enviar quando se larga ou se para de mexer
    document.querySelectorAll("#simulatorSection input[type=range]").forEach((input) => {
        input.addEventListener("input", () => { liveDragging = true; });
        input.addEventListener("change", () => { liveDragging = false; scheduleLiveSend(); });
    });
    liveCurrentPage = currentPageName();
    startLiveListening();
}

if (liveRole === "viewer") {
    // Só o ecrã de quem apresenta decide pela casa; os outros mostram o resultado
    // (aqui a "simulação" só desenha e envia o novo estado; as regras correm no ecrã de quem apresenta)
    runSimulation = function runSimulationViewer() {
        if (connectionMode === "demo") renderState(demoState);
    };
}
