/* DOMUS+ — Simulação ao vivo para a apresentação.
 *
 * Quem apresenta abre o site com ?apresentar e quem assiste abre com ?aovivo
 * (é para aí que leva o código QR da apresentação). Cada mudança feita pelo
 * apresentador no simulador, nos equipamentos, nos modos ou na página aberta
 * é enviada para os telemóveis de quem assiste, que mostram o mesmo.
 *
 * Como não há servidor próprio (o site está no GitHub Pages), as mensagens
 * passam pelo serviço público e gratuito ntfy.sh: o apresentador publica um
 * pequeno JSON num "tópico" e quem assiste está a escutar esse tópico.
 * Só funciona em modo de demonstração (valores simulados) e precisa de Internet.
 * As mensagens são públicas para quem souber o nome do tópico: não levam
 * nenhum dado pessoal nem o token da ESP32.
 */
const LIVE_TOPIC = "domus-pap-pedropinto-2027";
const LIVE_SERVER = "https://ntfy.sh/";
const LIVE_MIN_INTERVAL_MS = 1500;     // no máximo uma mensagem a cada 1,5 s (limite do serviço)

const liveParams = new URLSearchParams(window.location.search);
const liveRole = liveParams.has("apresentar") ? "presenter"
    : liveParams.has("aovivo") ? "viewer" : null;

let liveLastSent = "";          // último conteúdo enviado (não reenvia o que não mudou)
let liveLastSentAt = 0;
let liveSendTimer = 0;
let liveApplying = false;       // true enquanto o espectador aplica uma mensagem recebida
let liveLastPage = "";
let liveBanner = null;
let liveLastMessageAt = 0;     // quando chegou a última mensagem (espectador)

// Campos do estado que o espectador precisa para desenhar a casa igual
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
        liveBanner.className = "live-banner";
        liveBanner.setAttribute("role", "status");
        document.body.append(liveBanner);
    }
    liveBanner.className = `live-banner ${kind}`;
    liveBanner.textContent = text;
}

/* ---------- quem apresenta: envia ---------- */

function buildLiveMessage() {
    const state = {};
    LIVE_STATE_FIELDS.forEach((key) => { state[key] = demoState[key]; });
    return JSON.stringify({ v: 1, page: currentPageName(), state, log: simLog.slice(0, 5) });
}

function scheduleLiveSend() {
    if (liveRole !== "presenter" || connectionMode !== "demo") return;
    window.clearTimeout(liveSendTimer);
    const wait = Math.max(300, LIVE_MIN_INTERVAL_MS - (Date.now() - liveLastSentAt));
    liveSendTimer = window.setTimeout(sendLiveNow, wait);
}

async function sendLiveNow() {
    const message = buildLiveMessage();
    if (message === liveLastSent) return;            // nada mudou
    liveLastSent = message;
    liveLastSentAt = Date.now();
    try {
        // Pedido simples (texto), por isso o navegador não precisa de pedido OPTIONS
        await fetch(LIVE_SERVER + LIVE_TOPIC, { method: "POST", body: message });
        showLiveBanner("● Ao vivo: quem abriu o código QR vê o que fazes", "on");
    } catch (error) {
        showLiveBanner("Ao vivo sem Internet: os outros telemóveis não estão a receber", "off");
    }
}

/* ---------- quem assiste: recebe ---------- */

function applyLiveMessage(text) {
    let data;
    try { data = JSON.parse(text); } catch (error) { return; }
    if (!data || data.v !== 1 || !data.state) return;
    liveLastMessageAt = Date.now();
    liveApplying = true;
    Object.assign(demoState, data.state);
    if (Array.isArray(data.log)) simLog = data.log;
    if (data.page && data.page !== liveLastPage) {
        liveLastPage = data.page;
        navigateToPage(data.page, { updateHistory: false });
    }
    renderState(demoState);
    liveApplying = false;
    showLiveBanner("● A seguir a apresentação do Pedro, ao vivo", "on");
}

function startLiveViewer() {
    showLiveBanner("A ligar à apresentação…", "wait");
    // since=latest: recebe logo o último estado enviado, mesmo que se entre a meio
    const source = new EventSource(`${LIVE_SERVER}${LIVE_TOPIC}/sse?since=latest`);
    source.onmessage = (event) => {
        try {
            const envelope = JSON.parse(event.data);
            if (envelope.event === "message") applyLiveMessage(envelope.message);
        } catch (error) { /* mensagem que não é do DOMUS+ */ }
    };
    source.onopen = () => {
        if (!liveLastMessageAt) showLiveBanner("Ligado; à espera do apresentador…", "wait");
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
        if (!liveApplying) scheduleLiveSend();
    };
    const liveBaseNavigate = navigateToPage;
    navigateToPage = function navigateToPageLive(pageName, options) {
        liveBaseNavigate(pageName, options);
        if (!liveApplying) scheduleLiveSend();
    };
}

if (liveRole === "viewer") {
    // Quem assiste só vê: a casa segue o apresentador e não decide sozinha
    runSimulation = function runSimulationViewer() {};
    const blocked = async () => {
        showToast("Em modo ao vivo, só quem apresenta controla a casa.");
        return false;
    };
    controlDevice = blocked;
    activateMode = blocked;
    applyScenario = blocked;
    document.querySelectorAll("#simulatorSection input").forEach((input) => {
        input.addEventListener("input", (event) => {
            event.stopImmediatePropagation();
            renderState(demoState);              // volta a pôr os valores do apresentador
        }, true);
        input.addEventListener("change", (event) => event.stopImmediatePropagation(), true);
    });
    startLiveViewer();
} else if (liveRole === "presenter") {
    showLiveBanner("● Ao vivo: a preparar…", "wait");
    scheduleLiveSend();
}
