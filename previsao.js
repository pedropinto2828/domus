/* DOMUS+ — Previsão do tempo e avisos no telemóvel
 *
 * Previsão: serviço gratuito Open-Meteo (sem chave), para a cidade escolhida nas
 * Definições (por defeito Vizela). Com a ESP32 ligada, é a placa que pede a
 * previsão e aplica as regras; aqui só se mostra. Em demonstração, o site pede a
 * previsão real e o simulador aplica as mesmas regras do firmware:
 *   - vai chover (>= 70 % na próxima hora): a janela fecha antes;
 *   - verão e vem calor (alvo + 5 °C nas próximas 3 h), de dia: o estore desce antes.
 *
 * Avisos: mensagens de um bot do Telegram (criado pelo utilizador no @BotFather).
 * Com a ESP32 ligada, é a placa que envia os avisos; em demonstração, é este site.
 * O código do bot é secreto: quem o tiver pode enviar mensagens em nome do bot.
 *
 * Carregado depois do interativo.js (usa demoState, houseSettings, renderState…).
 */
const WEATHER_REFRESH_MS = 1800000;   // nova previsão a cada 30 min, como a ESP32
const DEFAULT_WEATHER = { city: "Vizela", lat: 41.38, lon: -8.31 };

let realForecast = null;   // última previsão real: { city, rainProbability, tempMaxC, at }

function weatherSettings() {
    return { ...DEFAULT_WEATHER, ...(houseSettings.weather || {}) };
}

/* ---------- previsão do tempo ---------- */

async function fetchRealForecast() {
    const weather = weatherSettings();
    const url = "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${weather.lat}&longitude=${weather.lon}` +
        "&hourly=temperature_2m,precipitation_probability&forecast_hours=3&timezone=auto";
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const hourly = data.hourly || {};
        const rain = (hourly.precipitation_probability || []).slice(0, 2).filter(Number.isFinite);
        const temps = (hourly.temperature_2m || []).filter(Number.isFinite);
        realForecast = {
            city: weather.city,
            rainProbability: rain.length ? Math.max(...rain) : null,
            tempMaxC: temps.length ? Math.max(...temps) : null,
            at: Date.now()
        };
        // Um cenário de previsão simulada não é apagado pela previsão real
        if (connectionMode === "demo" && !(demoState.forecast && demoState.forecast.simulated)) {
            demoState.forecast = { ...realForecast };
            runSimulation();
        }
    } catch (error) {
        realForecast = null;   // sem Internet: a casa continua com os sensores
    }
    renderForecast(connectionMode === "demo" ? demoState : currentState);
}

function forecastText(forecast) {
    if (!forecast) return "";
    const rain = Number.isFinite(forecast.rainProbability) ? `${forecast.rainProbability} % de chuva` : "chuva --";
    const temp = isFiniteNumber(forecast.tempMaxC) ? `máx. ${numberText(Math.round(forecast.tempMaxC * 10) / 10)} °C` : "máx. --";
    const where = forecast.simulated ? "Previsão simulada" : `Previsão para ${forecast.city || weatherSettings().city}`;
    return `${where} (próximas 3 h): ${rain} · ${temp}`;
}

function renderForecast(state) {
    const element = $("heroForecast");
    if (!element) return;
    const forecast = forecastOf(state);
    element.hidden = !forecast;
    element.textContent = forecastText(forecast);
    element.classList.toggle("rain", rainSoon(state));
}

/* ---------- avisos no telemóvel (bot do Telegram) ---------- */

function telegramTokenValid(token) {
    return /^\d{5,15}:[A-Za-z0-9_-]{20,60}$/.test(token);
}

function telegramChatValid(chat) {
    return /^-?\d{1,19}$/.test(chat);
}

function telegramReady() {
    return telegramTokenValid(houseSettings.telegramToken || "") && telegramChatValid(String(houseSettings.telegramChatId || ""));
}

const NOTICE_ICONS = { cloud_with_rain: "🌧️", umbrella: "☔", sunny: "☀️", droplet: "💧", warning: "⚠️", white_check_mark: "✅", iphone: "📱" };

// Envia um aviso para o telemóvel (só em demonstração; com a ESP32 é a placa que envia).
// Ao aplicar uma mensagem do modo ao vivo, só envia se o outro aparelho não enviar avisos
// (assim não há avisos repetidos nem avisos perdidos).
// O Telegram toca e acende o ecrã como qualquer mensagem; prioridade < 3 vai em silêncio.
function sendPhoneNotice(title, message, tag = "house", priority = 4) {
    if (connectionMode !== "demo") return;
    if (typeof liveApplying !== "undefined" && liveApplying && liveSenderNotifies) return;
    if (!telegramReady()) return;
    // Formulário simples (sem pedido OPTIONS): o Telegram aceita-o diretamente
    const body = new URLSearchParams({
        chat_id: String(houseSettings.telegramChatId),
        text: `${NOTICE_ICONS[tag] || "🏠"} DOMUS+ · ${title}\n${message}`,
        disable_notification: String(priority < 3)
    });
    fetch(`https://api.telegram.org/bot${houseSettings.telegramToken}/sendMessage`, { method: "POST", body })
        .catch(() => { /* sem Internet: o aviso perde-se, a casa continua */ });
    pushSimLog(`Aviso enviado para o telemóvel: ${title}`);
}

// "Ligar ao meu Telegram": confirma o código do bot e descobre a conversa
// (é preciso ter carregado em Iniciar no bot, no Telegram).
async function connectTelegram() {
    const token = $("settingTelegramToken").value.trim();
    if (!telegramTokenValid(token)) {
        showToast("Cola o código que o @BotFather te deu (números, dois pontos e letras).");
        return;
    }
    try {
        const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
        if (!me.ok) { showToast("O Telegram não reconhece este código. Confirma que o copiaste todo."); return; }
        const updates = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
        const chats = (updates.result || []).map((u) => (u.message || u.my_chat_member || {}).chat).filter(Boolean);
        if (!chats.length) {
            showToast(`Abre o bot @${me.result.username} no Telegram, carrega em Iniciar e volta a carregar aqui.`);
            return;
        }
        $("settingTelegramChat").value = String(chats[chats.length - 1].id);
        storeNoticeSettings();
        showToast(`Ligado ao bot @${me.result.username}. Envia um aviso de teste.`);
    } catch (error) {
        showToast("Sem Internet: não foi possível falar com o Telegram.");
    }
}

async function sendTestNotice() {
    if (connectionMode === "esp32") {
        try {
            await apiRequest("/api/notify/test", { method: "POST" });
            showToast("Pedido enviado: a ESP32 vai mandar o aviso de teste.");
        } catch (error) {
            showToast(error.message);
        }
        return;
    }
    storeNoticeSettings();   // o teste e os outros avisos usam sempre os mesmos dados
    if (!telegramReady()) {
        showToast("Primeiro cola o código do bot e carrega em Ligar ao meu Telegram.");
        return;
    }
    sendPhoneNotice("Teste", "Os avisos do DOMUS+ estão a funcionar.", "white_check_mark", 4);
    showToast("Aviso de teste enviado. Deve chegar ao Telegram em segundos.");
}

// Em demonstração, o código, a conversa e o nível ficam guardados logo que mudam
function storeNoticeSettings() {
    if (connectionMode !== "demo") { renderNoticeStatus(); return; }
    const token = $("settingTelegramToken").value.trim();
    const chat = $("settingTelegramChat").value.trim();
    if ((token && !telegramTokenValid(token)) || (chat && !telegramChatValid(chat))) { renderNoticeStatus(); return; }
    houseSettings.telegramToken = token;
    houseSettings.telegramChatId = chat;
    houseSettings.noticeLevel = $("settingNoticeLevel").value === "important" ? "important" : "all";
    saveDemoSettings();
    renderNoticeStatus();
}

function renderNoticeStatus() {
    const status = $("noticeStatus");
    if (!status) return;
    const token = $("settingTelegramToken").value.trim();
    const chat = $("settingTelegramChat").value.trim();
    const level = houseSettings.noticeLevel === "important" ? "só o importante" : "tudo";
    let text, ok = false;
    if (token && !telegramTokenValid(token)) {
        text = "O código do bot não está completo: copia-o outra vez do @BotFather.";
    } else if (chat && !telegramChatValid(chat)) {
        text = "A conversa tem de ser um número: carrega em Ligar ao meu Telegram.";
    } else if (connectionMode === "esp32") {
        ok = Boolean(chat);
        text = ok ? `✓ Com a casa ligada, é a ESP32 que envia os avisos (${level}) para o Telegram. Guarda as definições depois de mudar.`
            : "Avisos desligados: cola o código do bot, liga ao Telegram e guarda as definições.";
    } else if (!telegramReady()) {
        text = "Avisos desligados: cola o código do bot e carrega em Ligar ao meu Telegram.";
    } else {
        ok = true;
        text = `✓ Avisos ligados (${level}) para o Telegram. Em demonstração, este site tem de estar aberto neste aparelho.`;
    }
    status.textContent = text;
    status.classList.toggle("ok", ok);
}

// Nível "Tudo": cada entrada do histórico também vai para o telemóvel.
// As situações com aviso próprio (chuva, previsão, torneira, modo Ausente) não se repetem.
const NOTICE_OWN_SOURCES = ["segurança", "previsão do tempo", "temporizador", "modo Ausente"];

function noticeLevelAll() {
    return (houseSettings.noticeLevel || "all") === "all";
}

const baseAppendHistory = appendHistory;
appendHistory = function appendHistoryWithNotice(entry) {
    baseAppendHistory(entry);
    if (!noticeLevelAll() || NOTICE_OWN_SOURCES.includes(entry.source)) return;
    const origins = {
        "aplicação": "Pedido na aplicação", "gestão térmica": "Decisão da gestão térmica",
        "automatização": "Automatização", "horário": "Horário", "controlo automático": "Controlo automático"
    };
    const origin = origins[entry.source] || entry.source || "Casa";
    const reason = String(entry.result || "").replace(/^simulação( · )?/, "");
    sendPhoneNotice(`${entry.device}: ${entry.action}`, reason ? `${origin}: ${reason}` : `${origin}.`, "house", 4);
};

// Modo ao vivo: alguém mexeu noutro aparelho que não envia avisos (por exemplo, o telemóvel
// de quem assiste). Este aparelho avisa do que mudou, numa só mensagem.
function noticeRemoteChanges(before, after) {
    if (!noticeLevelAll()) return;
    const changes = [];
    const onOff = (value) => (value ? "ligada" : "desligada");
    if (before.windows && after.windows) {
        if (before.windows[0] !== after.windows[0]) changes.push(`${simDeviceName("window1")} ${after.windows[0] === "open" ? "aberta" : "fechada"}`);
        if (before.windows[1] !== after.windows[1]) changes.push(`${simDeviceName("window2")} ${after.windows[1] === "open" ? "em cima" : "em baixo"}`);
    }
    (after.lights || []).forEach((on, index) => {
        if (before.lights && before.lights[index] !== on) changes.push(`luz ${simDeviceName(LIGHT_IDS[index])} ${on ? "acesa" : "apagada"}`);
    });
    if (before.fanOn !== after.fanOn) changes.push(`${simDeviceName("fan")} ${onOff(after.fanOn)}`);
    if (before.faucetOn !== after.faucetOn) changes.push(`${simDeviceName("faucet")} ${after.faucetOn ? "aberta" : "fechada"}`);
    if (before.activeMode !== after.activeMode) changes.push(`modo ${MODE_NAMES[after.activeMode] || after.activeMode}`);
    if (!changes.length) return;
    sendPhoneNotice("Mudança noutro aparelho", changes.join(", "), "iphone", 4);
}

/* ---------- procurar a cidade (Open-Meteo Geocoding) ---------- */

function renderWeatherCoords(weather) {
    const coords = $("settingWeatherCoords");
    coords.dataset.lat = weather.lat;
    coords.dataset.lon = weather.lon;
    coords.textContent = `${Number(weather.lat).toFixed(2)}, ${Number(weather.lon).toFixed(2)}`;
}

async function findWeatherCity() {
    const name = $("settingWeatherCity").value.trim();
    if (!name) {
        showToast("Escreve o nome da cidade.");
        return;
    }
    try {
        const response = await fetch("https://geocoding-api.open-meteo.com/v1/search" +
            `?name=${encodeURIComponent(name)}&count=1&language=pt&format=json`);
        const data = await response.json();
        const place = data.results && data.results[0];
        if (!place) {
            showToast(`Não encontrei "${name}". Experimenta outro nome.`);
            return;
        }
        $("settingWeatherCity").value = place.name;
        renderWeatherCoords({ lat: Math.round(place.latitude * 1000) / 1000, lon: Math.round(place.longitude * 1000) / 1000 });
        showToast(`Encontrei ${place.name}${place.admin1 ? `, ${place.admin1}` : ""}. Guarda as definições.`);
    } catch (error) {
        showToast("Sem Internet: não foi possível procurar a cidade.");
    }
}

/* ---------- ligação ao resto do site ---------- */

const baseRenderStateWeather = renderState;
renderState = function renderStateWithForecast(state) {
    baseRenderStateWeather(state);
    renderForecast(state);
};

const baseRenderHouseSettings = renderHouseSettings;
renderHouseSettings = function renderHouseSettingsWithWeather() {
    baseRenderHouseSettings();
    const weather = weatherSettings();
    $("settingWeatherCity").value = weather.city;
    renderWeatherCoords(weather);
    $("settingTelegramToken").value = houseSettings.telegramToken || "";
    $("settingTelegramChat").value = houseSettings.telegramChatId || "";
    $("settingNoticeLevel").value = houseSettings.noticeLevel === "important" ? "important" : "all";
    renderNoticeStatus();
};

$("findWeatherCity").addEventListener("click", findWeatherCity);
$("connectTelegram").addEventListener("click", connectTelegram);
["settingTelegramToken", "settingTelegramChat"].forEach((id) => {
    $(id).addEventListener("change", storeNoticeSettings);
    $(id).addEventListener("input", renderNoticeStatus);
});
$("settingNoticeLevel").addEventListener("change", storeNoticeSettings);
$("testNotice").addEventListener("click", sendTestNotice);
renderHouseSettings();
fetchRealForecast();
window.setInterval(fetchRealForecast, WEATHER_REFRESH_MS);
// Depois de guardar as definições (pode ter mudado a cidade), pede nova previsão
$("saveSettings").addEventListener("click", () => window.setTimeout(fetchRealForecast, 500));
