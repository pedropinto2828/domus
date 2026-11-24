/* DOMUS+ — Previsão do tempo e avisos no telemóvel
 *
 * Previsão: serviço gratuito Open-Meteo (sem chave), para a cidade escolhida nas
 * Definições (por defeito Vizela). Com a ESP32 ligada, é a placa que pede a
 * previsão e aplica as regras; aqui só se mostra. Em demonstração, o site pede a
 * previsão real e o simulador aplica as mesmas regras do firmware:
 *   - vai chover (>= 70 % na próxima hora): a janela fecha antes;
 *   - verão e vem calor (alvo + 5 °C nas próximas 3 h), de dia: o estore desce antes.
 *
 * Avisos: o telemóvel tem a app gratuita ntfy a seguir um "tópico" (um nome
 * escolhido nas Definições). Com a ESP32 ligada, é a placa que envia os avisos;
 * em demonstração, é este site. Quem souber o nome do tópico também recebe os
 * avisos, por isso deve ser difícil de adivinhar.
 *
 * Carregado depois do interativo.js (usa demoState, houseSettings, renderState…).
 */
const WEATHER_REFRESH_MS = 1800000;   // nova previsão a cada 30 min, como a ESP32
const NTFY_URL = "https://ntfy.sh/";
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

/* ---------- avisos no telemóvel (ntfy) ---------- */

function ntfyTopicValid(topic) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(topic);
}

// Envia um aviso para o telemóvel (só em demonstração; com a ESP32 é a placa que envia).
// Não envia quando está a aplicar uma mensagem do modo ao vivo: o aviso já saiu do outro aparelho.
function sendPhoneNotice(title, message, tag = "house", priority = 3, topicOverride) {
    if (connectionMode !== "demo") return;
    if (typeof liveApplying !== "undefined" && liveApplying) return;
    const topic = (topicOverride || houseSettings.ntfyTopic || "").trim();
    if (!ntfyTopicValid(topic)) return;
    // Pedido simples (texto com JSON): o ntfy aceita-o na raiz sem pedido OPTIONS
    fetch(NTFY_URL, {
        method: "POST",
        body: JSON.stringify({ topic, title: `DOMUS+ · ${title}`, message, tags: [tag], priority })
    }).catch(() => { /* sem Internet: o aviso perde-se, a casa continua */ });
    pushSimLog(`Aviso enviado para o telemóvel: ${title}`);
}

async function sendTestNotice() {
    const topic = $("settingNtfyTopic").value.trim();
    if (!ntfyTopicValid(topic)) {
        showToast("Escreve um tópico só com letras, números, - e _ (ou carrega em Gerar tópico).");
        return;
    }
    if (connectionMode === "esp32") {
        if (topic !== (houseSettings.ntfyTopic || "")) {
            showToast("Guarda primeiro as definições, para a ESP32 ficar com este tópico.");
            return;
        }
        try {
            await apiRequest("/api/notify/test", { method: "POST" });
            showToast("Pedido enviado: a ESP32 vai mandar o aviso de teste.");
        } catch (error) {
            showToast(error.message);
        }
        return;
    }
    sendPhoneNotice("Teste", "Os avisos do DOMUS+ estão a funcionar.", "white_check_mark", 3, topic);
    showToast("Aviso de teste enviado. Deve aparecer no telemóvel dentro de segundos.");
}

function generateNtfyTopic() {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => (n % 36).toString(36)).join("");
    $("settingNtfyTopic").value = `domus-${random}`;
    showToast("Tópico gerado. Escreve-o na app ntfy e guarda as definições.");
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
    $("settingNtfyTopic").value = houseSettings.ntfyTopic || "";
};

$("findWeatherCity").addEventListener("click", findWeatherCity);
$("generateNtfyTopic").addEventListener("click", generateNtfyTopic);
$("testNtfy").addEventListener("click", sendTestNotice);
renderHouseSettings();
fetchRealForecast();
window.setInterval(fetchRealForecast, WEATHER_REFRESH_MS);
// Depois de guardar as definições (pode ter mudado a cidade), pede nova previsão
$("saveSettings").addEventListener("click", () => window.setTimeout(fetchRealForecast, 500));
