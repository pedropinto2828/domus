/* DOMUS+ — "Falar com a casa" no site (modo de demonstração).
 *
 * Escreve-se ao bot do Telegram, por exemplo "abrir janela 1" ou "liga a luz da sala",
 * e a casa obedece e responde. Em demonstração é este site (aberto no computador) que
 * lê as mensagens do bot de 3 em 3 segundos; com a casa ligada, é a ESP32 que as lê
 * (de 10 em 10 s) e também responde ao Atalho da Siri (rota /api/command).
 *
 * As regras para perceber as frases são as MESMAS do firmware (comandos.h):
 *  1. normalizar: minúsculas, sem acentos, sem pontuação;
 *  2. procurar o verbo (abrir, fechar, ligar, desligar) e o equipamento;
 *  3. juntar os dois numa ordem igual à dos botões (equipamento + ação).
 */

/* ---------- 1. normalizar ---------- */
function commandNormalize(text) {
    const plain = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ").trim();
    return ` ${plain} `;
}

/* ---------- 2. procurar palavras inteiras ---------- */
const commandHas = (s, word) => s.includes(` ${word} `);
const commandHasAny = (s, words) => words.some((word) => commandHas(s, word));

const CMD_OPEN = ["abre", "abrir", "abra", "abram", "sobe", "subir", "suba", "levanta", "levantar", "levante"];
const CMD_CLOSE = ["fecha", "fechar", "feche", "fechem", "desce", "descer", "desca", "baixa", "baixar", "baixe"];
const CMD_ON = ["liga", "ligar", "ligue", "acende", "acender", "acenda", "ativa", "ativar", "ative", "poe a funcionar"];
const CMD_OFF = ["desliga", "desligar", "desligue", "apaga", "apagar", "apague", "desativa", "desativar", "desative", "parar", "pare"];
const CMD_LIGHT_WORDS = ["luz", "luzes", "lampada", "lampadas", "candeeiro", "iluminacao"];
const CMD_ALL_WORDS = ["todas", "todos", "tudo"];
const CMD_ROOMS = [
    ["sala", "light1"], ["cozinha", "light2"],
    ["quarto 1", "light3"], ["quarto um", "light3"], ["primeiro quarto", "light3"],
    ["quarto 2", "light4"], ["quarto dois", "light4"], ["segundo quarto", "light4"],
    ["casa de banho", "light5"], ["wc", "light5"], ["banho", "light5"],
    ["hall", "light6"], ["garagem", "light6"], ["entrada", "light6"],
    ["luz 1", "light1"], ["luz 2", "light2"], ["luz 3", "light3"],
    ["luz 4", "light4"], ["luz 5", "light5"], ["luz 6", "light6"]
];
const CMD_HELP = ["ajuda", "comandos", "start", "help", "o que podes fazer", "o que sabes fazer"];
const CMD_STATUS = ["estado", "como esta", "como esta a casa", "resumo", "temperatura", "status"];
const CMD_ENERGY = ["energia", "consumo", "gastei", "gasto", "gastou", "eletricidade"];

/* ---------- 3. juntar verbo e equipamento ---------- */
// customNames: [[equipamento, nome normalizado]] dos nomes mudados nas Definições
function parseCommand(text, customNames = []) {
    const s = commandNormalize(text);
    if (commandHasAny(s, CMD_ENERGY)) return { kind: "energy" };

    if (["modo", "boa noite", "vou sair", "cheguei", "estou em casa"].some((w) => commandHas(s, w))) {
        if (commandHas(s, "noite")) return { kind: "mode", action: "night" };
        if (["eco", "economico", "poupanca"].some((w) => commandHas(s, w))) return { kind: "mode", action: "eco" };
        if (["ausente", "fora", "vou sair"].some((w) => commandHas(s, w))) return { kind: "mode", action: "away" };
        if (["automatico", "auto", "normal", "cheguei", "estou em casa"].some((w) => commandHas(s, w))) return { kind: "mode", action: "auto" };
    }

    const open = commandHasAny(s, CMD_OPEN), close = commandHasAny(s, CMD_CLOSE);
    const on = commandHasAny(s, CMD_ON), off = commandHasAny(s, CMD_OFF);
    const positive = (open || on) && !(close || off);
    const negative = (close || off) && !(open || on);

    let device = null;
    const custom = customNames.find(([, name]) => name.length >= 3 && commandHas(s, name));
    if (custom) device = custom[0];
    let lightWithoutRoom = false;
    if (!device) {
        if (commandHas(s, "janelas") || (commandHas(s, "janela") && commandHas(s, "estore"))) device = "both_windows";
        else if (["janela 2", "janela dois", "estore", "estores", "persiana", "persianas"].some((w) => commandHas(s, w))) device = "window2";
        else if (commandHas(s, "janela")) device = "window1";
        else if (["ventoinha", "ventilador", "ventilacao", "ar"].some((w) => commandHas(s, w))) device = "fan";
        else if (["torneira", "agua", "bomba", "rega"].some((w) => commandHas(s, w))) device = "faucet";
        else {
            const room = CMD_ROOMS.find(([word]) => commandHas(s, word));
            if (room) device = room[1];
            if (!device && commandHasAny(s, CMD_LIGHT_WORDS)) {
                if (commandHas(s, "luzes") || commandHasAny(s, CMD_ALL_WORDS)) device = "both_lights";
                else lightWithoutRoom = true;
            }
            // "apaga tudo" = todas as luzes; "fecha tudo" = janela e estore
            if (!device && !lightWithoutRoom && commandHasAny(s, CMD_ALL_WORDS)) {
                if (on || off) device = "both_lights";
                else if (open || close) device = "both_windows";
            }
        }
    }

    if (!device && !lightWithoutRoom) {
        if (commandHasAny(s, CMD_HELP)) return { kind: "help" };
        if (commandHasAny(s, CMD_STATUS)) return { kind: "status" };
        if (positive || negative) return { kind: "needDevice" };
        return { kind: "unknown" };
    }
    if (lightWithoutRoom) return { kind: "needRoom" };
    if (!positive && !negative) return { kind: "needAction", device };
    const isWindow = ["window1", "window2", "both_windows"].includes(device);
    return { kind: "device", device, action: isWindow ? (positive ? "open" : "closed") : (positive ? "on" : "off") };
}

const COMMAND_HELP_TEXT = [
    "Podes escrever, por exemplo:",
    "• abrir janela 1 / fechar janela 1",
    "• subir o estore / fechar janela 2",
    "• liga a luz da sala / apaga a luz da cozinha",
    "• liga as luzes todas / apaga tudo",
    "• liga a ventoinha / desliga a ventoinha",
    "• abre a torneira / fecha a torneira",
    "• modo noite / modo eco / modo ausente / modo automático",
    "• estado (resumo da casa) / energia (consumo de hoje)"
].join("\n");

/* ---------- respostas ---------- */
// decimalText (número com vírgula) está em energia.js

function deviceDoneText(device, action) {
    const positive = action === "open" || action === "on";
    if (device === "both_windows") return `Janela e estore: ${positive ? "abertos" : "fechados"}`;
    if (device === "both_lights") return `Luzes todas: ${positive ? "ligadas" : "desligadas"}`;
    if (device === "window2") return `${simDeviceName(device)}: ${positive ? "em cima" : "em baixo"}`;
    if (device === "window1" || device === "faucet") return `${simDeviceName(device)}: ${positive ? "aberta" : "fechada"}`;
    if (isLight(device)) return `Luz ${simDeviceName(device)}: ${positive ? "ligada" : "desligada"}`;
    return `${simDeviceName(device)}: ${positive ? "ligada" : "desligada"}`;
}

function houseStatusText(state = demoState) {
    const temp = (value) => (Number.isFinite(value) ? `${decimalText(value, 1)} °C` : "sem leitura");
    const w = state.windows || [];
    const lightsOn = LIGHT_IDS.filter((device, index) => state.lights && state.lights[index]).map(simDeviceName);
    return [
        `🏠 Dentro: ${temp(state.temperatureC)}, fora: ${temp(state.temperatureOutC)}`,
        `🪟 ${simDeviceName("window1")}: ${w[0] === "open" ? "aberta" : "fechada"}, ${simDeviceName("window2")}: ${w[1] === "open" ? "em cima" : "em baixo"}`,
        `💡 ${lightsOn.length ? `Luzes ligadas: ${lightsOn.join(", ")}` : "Luzes todas desligadas"}`,
        `🌀 ${simDeviceName("fan")}: ${state.fanOn ? "ligada" : "desligada"}, ${simDeviceName("faucet")}: ${state.faucetOn ? "aberta" : "fechada"}`,
        `🌧️ ${state.rainDetected ? "Está a chover" : "Sem chuva"}, modo ${MODE_NAMES[state.activeMode] || "Automático"}.`
    ].join("\n");
}

// Nomes que o utilizador mudou nas Definições (os de fábrica já são conhecidos)
function customCommandNames() {
    return Object.entries(houseSettings.devices || {})
        .filter(([device, name]) => name && name !== DEFAULT_SETTINGS.devices[device])
        .map(([device, name]) => [device, commandNormalize(name).trim()]);
}

// Percebe e executa uma frase. Devolve { ok, reply }.
let commandSourceOverride = null;   // a origem que fica no histórico ("Telegram")
async function runCommandText(text, source = "Telegram") {
    const command = parseCommand(text, customCommandNames());
    switch (command.kind) {
        case "device": {
            if (command.device === "window1" || command.device === "both_windows") {
                if (command.action === "open" && demoState.rainDetected) {
                    return { ok: false, reply: "⛔ Não abri a janela: está a chover (o sensor de chuva bloqueia a abertura)." };
                }
            }
            commandSourceOverride = source;
            let ok;
            try {
                ok = await executeConfiguredAction(command.device, command.action);
            } finally {
                commandSourceOverride = null;
            }
            if (!ok) return { ok: false, reply: "⛔ Não foi possível. Vê o Histórico do site." };
            let reply = `✅ ${deviceDoneText(command.device, command.action)}.`;
            if (command.device === "faucet" && command.action === "on") reply += ` Fecha sozinha ao fim de ${houseSettings.faucetSeconds || 60} s.`;
            return { ok: true, reply };
        }
        case "mode": {
            commandSourceOverride = source;
            try {
                await activateMode(command.action);
            } finally {
                commandSourceOverride = null;
            }
            return { ok: true, reply: `✅ Modo ${MODE_NAMES[command.action]} ativado.` };
        }
        case "status": return { ok: true, reply: houseStatusText() };
        case "energy": return { ok: true, reply: typeof energyTodayText === "function" ? energyTodayText() : "⚡ Sem dados de energia." };
        case "help": return { ok: true, reply: COMMAND_HELP_TEXT };
        case "needDevice": return { ok: false, reply: "🤔 Em que equipamento? Por exemplo: \"abrir janela 1\" ou \"liga a luz da sala\"." };
        case "needAction": return { ok: false, reply: `🤔 O que faço com ${command.device === "both_lights" ? "as luzes" : simDeviceName(command.device)}? Por exemplo: abrir, fechar, ligar ou desligar.` };
        case "needRoom": return { ok: false, reply: "🤔 De que divisão? Por exemplo: \"liga a luz da sala\" ou \"apaga as luzes todas\"." };
        default: return { ok: false, reply: "🤔 Não percebi. Escreve \"ajuda\" para ver as frases que conheço." };
    }
}

// As ordens dadas pelo Telegram ficam no histórico com a origem "Telegram"
const baseAppendHistoryCommands = appendHistory;
appendHistory = function appendHistoryWithCommandSource(entry) {
    if (commandSourceOverride && entry.source === "aplicação") entry = { ...entry, source: commandSourceOverride };
    baseAppendHistoryCommands(entry);
};

/* ---------- ler as mensagens do bot (só em demonstração) ---------- */
const TELEGRAM_COMMAND_POLL_MS = 3000;
let telegramCommandOffset = 0;
let telegramBacklogSkipped = false;   // as mensagens antigas (de antes de abrir o site) não são executadas
let telegramPolling = false;

function telegramCommandsOn() {
    return connectionMode === "demo" && telegramReady() && houseSettings.telegramCommands !== false;
}

function sendTelegramReply(text) {
    const body = new URLSearchParams({ chat_id: String(houseSettings.telegramChatId), text });
    fetch(`https://api.telegram.org/bot${houseSettings.telegramToken}/sendMessage`, { method: "POST", body })
        .catch(() => { /* sem Internet: a resposta perde-se */ });
}

async function pollTelegramCommands() {
    if (telegramPolling || !telegramCommandsOn()) return;
    telegramPolling = true;
    try {
        const params = new URLSearchParams({ timeout: "0", limit: "10", allowed_updates: '["message"]' });
        if (telegramCommandOffset) params.set("offset", String(telegramCommandOffset));
        const response = await fetch(`https://api.telegram.org/bot${houseSettings.telegramToken}/getUpdates?${params}`);
        const data = await response.json();
        if (!data.ok || !Array.isArray(data.result)) return;
        const skipOld = !telegramBacklogSkipped;
        telegramBacklogSkipped = true;
        for (const update of data.result) {
            if (update.update_id < telegramCommandOffset) continue;   // já lida (nunca repetir uma ordem)
            telegramCommandOffset = update.update_id + 1;
            if (skipOld) continue;
            const message = update.message;
            if (!message || !message.text || String(message.chat && message.chat.id) !== String(houseSettings.telegramChatId)) continue;   // só a conversa ligada
            const { reply } = await runCommandText(message.text, "Telegram");
            sendTelegramReply(reply);
            pushSimLog(`Telegram: "${message.text}" → ${reply.split("\n")[0]}`);
        }
    } catch (error) {
        /* sem Internet ou rede que bloqueia o Telegram: tenta outra vez daqui a 3 s */
    } finally {
        telegramPolling = false;
    }
}

// Caixa "Aceitar ordens escritas ao bot": em demonstração fica guardada logo
$("settingTelegramCommands").addEventListener("change", () => {
    if (connectionMode !== "demo") return;
    houseSettings.telegramCommands = $("settingTelegramCommands").checked;
    saveDemoSettings();
});
window.setInterval(pollTelegramCommands, TELEGRAM_COMMAND_POLL_MS);

/* ---------- Siri na demonstração ----------
 * Sem a maquete, a Siri não tem a quem falar. Então o Atalho do iPhone envia a frase
 * para um "tópico" secreto do ntfy.sh (o mesmo serviço do modo ao vivo), este site está
 * à escuta, executa a ordem na casa simulada e publica a resposta noutro tópico
 * (…-resposta), que o Atalho lê e a Siri diz em voz alta.
 * Só funciona em demonstração: com a casa ligada, a Siri fala com a ESP32 (/api/command).
 */
const SIRI_SERVER = "https://ntfy.sh/";
let siriSource = null;
const siriSeenIds = new Set();

function newSiriCode() {
    const letters = "abcdefghijkmnpqrstuvwxyz23456789";
    const random = new Uint8Array(10);
    crypto.getRandomValues(random);
    return Array.from(random, (n) => letters[n % letters.length]).join("");
}

function siriCode() {
    if (!/^[a-z0-9]{10}$/.test(houseSettings.siriCode || "")) {
        houseSettings.siriCode = newSiriCode();
        saveDemoSettings();
    }
    return houseSettings.siriCode;
}

const siriAddress = () => `${SIRI_SERVER}domus-ordens-${siriCode()}`;

function renderSiriStatus(text, ok = false) {
    $("settingSiriAddress").value = siriAddress();
    $("siriStatus").textContent = text;
    $("siriStatus").classList.toggle("ok", ok);
}

// Tira os emojis da resposta, para a Siri não os ler em voz alta
const plainReply = (text) => text.replace(/\p{Extended_Pictographic}|️/gu, "").replace(/\s+/g, " ").trim();

async function runSiriOrder(text) {
    if (connectionMode !== "demo") return;   // nunca mexe na casa verdadeira por este caminho
    const { reply } = await runCommandText(text, "Siri");
    const spoken = plainReply(reply);
    fetch(`${siriAddress()}-resposta`, { method: "POST", body: spoken }).catch(() => { /* sem Internet */ });
    showToast(`Siri: "${text}" → ${spoken}`);
    pushSimLog(`Siri: "${text}" → ${spoken}`);
}

function startSiriListening() {
    if (siriSource) { siriSource.close(); siriSource = null; }
    if (connectionMode !== "demo") {
        $("settingSiriAddress").value = "(só em demonstração)";
        $("siriStatus").textContent = "Com a casa ligada, a Siri fala diretamente com a ESP32 (Atalho da secção 4.18 do manual).";
        $("siriStatus").classList.remove("ok");
        return;
    }
    renderSiriStatus("A ligar…");
    const source = new EventSource(`${siriAddress()}/sse`);   // só as ordens novas
    siriSource = source;
    source.onopen = () => renderSiriStatus("✓ À escuta da Siri. Este site tem de ficar aberto neste aparelho.", true);
    source.onmessage = (event) => {
        try {
            const envelope = JSON.parse(event.data);
            if (envelope.event !== "message" || siriSeenIds.has(envelope.id)) return;
            siriSeenIds.add(envelope.id);
            const text = String(envelope.message || "").slice(0, 200).trim();
            if (text) runSiriOrder(text);
        } catch (error) { /* mensagem estranha: ignora */ }
    };
    source.onerror = () => renderSiriStatus("Sem ligação ao serviço (Internet ou rede da escola?). A tentar de novo…");
}

$("sendSiriAddress").addEventListener("click", () => {
    if (!telegramReady()) {
        showToast("Liga primeiro o Telegram (Avisos no telemóvel), ou copia o endereço à mão.");
        return;
    }
    sendTelegramReply(`🎙️ Endereço para o Atalho da Siri (não o partilhes):\n${siriAddress()}\n\nResposta (para o 2.º "Obter conteúdo do URL"):\n${siriAddress()}-resposta/raw?poll=1&since=15s`);
    showToast("Endereço enviado para o teu Telegram.");
});
$("copySiriAddress").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(siriAddress());
        showToast("Endereço copiado.");
    } catch (error) {
        $("settingSiriAddress").select();
        showToast("Seleciona o endereço e copia-o.");
    }
});
$("newSiriCode").addEventListener("click", () => {
    houseSettings.siriCode = newSiriCode();
    saveDemoSettings();
    startSiriListening();
    showToast("Endereço novo: atualiza o Atalho do iPhone.");
});
startSiriListening();
