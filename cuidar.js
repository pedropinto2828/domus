/* DOMUS+ — Modo Cuidar e avisos de saúde (site).
 *
 * Pensado para pessoas idosas que vivem sozinhas. A casa avisa a família no Telegram:
 *  - se durante o dia não houver movimento durante algumas horas;
 *  - se dentro de casa estiver frio ou calor a mais durante 30 minutos;
 *  - se a humidade estiver alta durante 2 horas;
 *  - à hora dos lembretes (por exemplo, "Tomar os medicamentos");
 *  - quando alguém pede ajuda (botão 🆘 no Início, ou "preciso de ajuda" ao Telegram ou à Siri).
 *
 * As regras são as MESMAS do firmware (cuidar.h). Com a casa ligada, é a ESP32 que vigia;
 * em demonstração, é este site, com os valores do simulador e a hora do computador.
 * Dois cenários do simulador ("Ninguém se mexe há horas" e "Casa fria") mostram os avisos
 * na apresentação sem esperar horas.
 */
const CARE_COMFORT_HOLD_MS = 30 * 60 * 1000;      // frio ou calor durante 30 min
const CARE_HUMIDITY_HOLD_MS = 2 * 60 * 60 * 1000; // humidade alta durante 2 h
const CARE_MARGIN = 1;                            // para voltar ao normal: 1 °C (5 % na humidade)

let careLastMotionAt = Date.now();
let careNoMotionWarned = false;
const careAlarms = { cold: { since: 0, warned: false }, hot: { since: 0, warned: false }, humid: { since: 0, warned: false } };
const careReminderDone = {};   // "índice" -> "dia-hora-minuto" em que já tocou

const careSettings = () => ({ ...DEFAULT_SETTINGS.care, ...(houseSettings.care || {}) });

/* ---------- as mesmas decisões do cuidar.h ---------- */
function careInWindow(hour, start, end) {
    if (start === end) return true;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;   // por exemplo, das 22 às 6
}

function careNoMotionDue(care, awayMode, hour, msSinceMotion, alreadyWarned) {
    if (!care.enabled || awayMode || alreadyWarned) return false;
    if (!careInWindow(hour, care.start, care.end)) return false;
    return msSinceMotion >= care.hours * 3600000;
}

function careAlarmStep(alarm, bad, normal, now, holdMs) {
    if (normal) { alarm.since = 0; alarm.warned = false; return false; }
    if (!bad) return false;
    if (!alarm.since) alarm.since = now;
    if (alarm.warned || now - alarm.since < holdMs) return false;
    alarm.warned = true;
    return true;
}

/* ---------- avisos ---------- */
function careNotice(title, message, tag, source, action) {
    if (typeof sendPhoneNotice === "function") sendPhoneNotice(title, message, tag, 5);
    appendHistory({ device: source === "lembrete" ? "Lembrete" : source === "saúde" ? "Saúde" : "Modo Cuidar", action, source, result: "aviso enviado à família" });
    showToast(`${title}: ${message}`);
}

// Pedido de ajuda (botão do Início, Telegram ou Siri)
async function sosRequest(source = "aplicação") {
    if (connectionMode === "esp32") {
        try {
            await apiRequest("/api/sos", { method: "POST" });
            showToast("Pedido de ajuda enviado à família.");
        } catch (error) {
            showToast(error.message);
        }
        return;
    }
    if (typeof sendPhoneNotice === "function") {
        sendPhoneNotice("Pedido de ajuda", `Foi pedida ajuda em casa (${source}). Liga já para confirmar se está tudo bem.`, "sos", 5);
    }
    appendHistory({ device: "Pedido de ajuda", action: "Pedir ajuda", source: "Modo Cuidar", result: `pedido por ${source}; aviso enviado à família` });
    showToast(telegramReady()
        ? "🆘 Pedido de ajuda enviado à família no Telegram."
        : "🆘 Pedido registado, mas os avisos do Telegram estão desligados (Definições).");
}

// De 5 em 5 segundos, em demonstração. force = true nos cenários (ignora o horário).
function careCheck({ force = false } = {}) {
    if (connectionMode !== "demo") return;
    const care = careSettings();
    const now = Date.now();
    if (demoState.motionDetected) {
        if (careNoMotionWarned) careNotice("Movimento em casa", "Voltou a haver movimento em casa.", "white_check_mark", "Modo Cuidar", "Movimento de novo");
        careNoMotionWarned = false;
        careLastMotionAt = now;
    }
    if (care.enabled) {
        const hour = new Date().getHours();
        const awayMode = demoState.activeMode === "away";
        if (careNoMotionDue({ ...care, start: force ? 0 : care.start, end: force ? 0 : care.end }, awayMode, hour, now - careLastMotionAt, careNoMotionWarned)) {
            careNoMotionWarned = true;
            careNotice("Sem movimento em casa", `Não há movimento em casa há mais de ${care.hours} h. Pode ser bom ligar para confirmar se está tudo bem.`, "warning", "Modo Cuidar", `Sem movimento há ${care.hours} h`);
        }
        const t = Number(demoState.temperatureC);
        if (Number.isFinite(t)) {
            if (careAlarmStep(careAlarms.cold, t < care.minTemp, t >= care.minTemp + CARE_MARGIN, now, CARE_COMFORT_HOLD_MS)) {
                careNotice("Casa fria", `Estão ${decimalText(t, 1)} °C dentro de casa há mais de 30 minutos. O frio faz mal sobretudo a idosos e bebés: é bom aquecer a casa.`, "warning", "saúde", "Casa fria");
            }
            if (careAlarmStep(careAlarms.hot, t > care.maxTemp, t <= care.maxTemp - CARE_MARGIN, now, CARE_COMFORT_HOLD_MS)) {
                careNotice("Casa quente", `Estão ${decimalText(t, 1)} °C dentro de casa há mais de 30 minutos. É importante beber água e fechar o estore nas horas de sol.`, "sunny", "saúde", "Casa quente");
            }
        }
        const h = Number(demoState.humidityPercent);
        if (Number.isFinite(h) && careAlarmStep(careAlarms.humid, h > care.maxHumidity, h <= care.maxHumidity - 5, now, CARE_HUMIDITY_HOLD_MS)) {
            careNotice("Humidade alta", `A humidade está em ${decimalText(h, 0)} % há mais de 2 horas. Abrir a janela 10 minutos (sem chuva) ajuda a evitar bolor e problemas respiratórios.`, "droplet", "saúde", "Humidade alta");
        }
    }
    // Lembretes, todos os dias à hora marcada
    const clock = new Date();
    const hhmm = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
    const minuteKey = `${clock.toDateString()} ${hhmm}`;
    (care.reminders || []).slice(0, 4).forEach((reminder, index) => {
        if (reminder.time === hhmm && reminder.text && careReminderDone[index] !== minuteKey) {
            careReminderDone[index] = minuteKey;
            careNotice("Lembrete", reminder.text, "alarm_clock", "lembrete", reminder.text);
        }
    });
    renderCare();
}

/* ---------- Início e Definições ---------- */
function renderCare(state = demoState) {
    const line = $("heroCare");
    const care = careSettings();
    const minutes = connectionMode === "esp32"
        ? Number(state && state.careLastMotionMinutes)
        : Math.floor((Date.now() - careLastMotionAt) / 60000);
    const enabled = connectionMode === "esp32" ? Boolean(state && state.careEnabled) : care.enabled;
    if (line) {
        line.hidden = !enabled;
        if (enabled) {
            line.textContent = `Modo Cuidar ligado · último movimento ${!Number.isFinite(minutes) ? "--" : minutes < 1 ? "agora mesmo" : minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h ${minutes % 60} min`}`;
            line.classList.toggle("alert", careNoMotionWarned);
        }
    }
    const status = $("careStatus");
    if (status) {
        const reminders = (care.reminders || []).length;
        status.textContent = care.enabled
            ? `✓ Modo Cuidar ligado: avisa ao fim de ${care.hours} h sem movimento, entre as ${String(care.start).padStart(2, "0")}:00 e as ${String(care.end).padStart(2, "0")}:00. ${reminders ? `${reminders} lembrete(s) por dia.` : "Sem lembretes."}${telegramReady() || connectionMode === "esp32" ? "" : " Atenção: liga o Telegram para os avisos chegarem."}`
            : `Modo Cuidar desligado.${reminders ? ` ${reminders} lembrete(s) por dia ativos.` : ""}`;
        status.classList.toggle("ok", care.enabled);
    }
}

function renderCareForm() {
    const care = careSettings();
    $("careEnabled").checked = care.enabled === true;
    $("careHours").value = String(care.hours);
    $("careStart").value = String(care.start);
    $("careEnd").value = String(care.end);
    $("careMinTemp").value = care.minTemp;
    $("careMaxTemp").value = care.maxTemp;
    $("careMaxHumidity").value = care.maxHumidity;
    for (let i = 1; i <= 4; i += 1) {
        const reminder = (care.reminders || [])[i - 1] || {};
        $(`careReminderTime${i}`).value = reminder.time || "";
        $(`careReminderText${i}`).value = reminder.text || "";
    }
    renderCare();
}

// Chamada por saveHouseSettings() (app.js)
function readCareForm() {
    const reminders = [];
    for (let i = 1; i <= 4; i += 1) {
        const time = $(`careReminderTime${i}`).value.trim();
        const text = $(`careReminderText${i}`).value.trim();
        if (time || text) reminders.push({ time, text });
    }
    return {
        enabled: $("careEnabled").checked,
        hours: Number($("careHours").value),
        start: Number($("careStart").value),
        end: Number($("careEnd").value),
        minTemp: Number($("careMinTemp").value),
        maxTemp: Number($("careMaxTemp").value),
        maxHumidity: Number($("careMaxHumidity").value),
        reminders
    };
}

// Devolve a mensagem de erro, ou "" se estiver tudo bem (os mesmos limites do firmware)
function careFormProblem(care) {
    if (!Number.isInteger(care.hours) || care.hours < 1 || care.hours > 12) return "Modo Cuidar: as horas sem movimento têm de ser de 1 a 12.";
    if (!Number.isFinite(care.minTemp) || care.minTemp < 10 || care.minTemp > 25) return "Modo Cuidar: a temperatura de casa fria tem de estar entre 10 e 25 °C.";
    if (!Number.isFinite(care.maxTemp) || care.maxTemp < 24 || care.maxTemp > 40 || care.minTemp >= care.maxTemp) return "Modo Cuidar: a temperatura de casa quente tem de estar entre 24 e 40 °C (e acima da de casa fria).";
    if (!Number.isFinite(care.maxHumidity) || care.maxHumidity < 40 || care.maxHumidity > 95) return "Modo Cuidar: a humidade alta tem de estar entre 40 e 95 %.";
    for (const reminder of care.reminders) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) || !reminder.text || reminder.text.length > 60) {
            return "Lembretes: cada lembrete precisa de uma hora e de um texto (até 60 letras).";
        }
    }
    return "";
}

/* ---------- cenários para a apresentação ---------- */
SCENARIOS.careNoMotion = {
    label: "Ninguém se mexe há horas",
    season: "winter", target: 21, tempIn: 20, tempOut: 12, lux: 400, rain: false, motion: false,
    before: () => {
        careLastMotionAt = Date.now() - careSettings().hours * 3600000 - 60000;
        careNoMotionWarned = false;
    }
};
SCENARIOS.coldHouse = {
    label: "Casa fria",
    season: "winter", target: 21, tempIn: 15, tempOut: 5, lux: 200, rain: false, motion: true,
    before: () => {
        careAlarms.cold.since = Date.now() - CARE_COMFORT_HOLD_MS - 60000;
        careAlarms.cold.warned = false;
    }
};

const baseApplyScenarioCare = applyScenario;
applyScenario = async function applyScenarioWithCare(key) {
    const careScenario = key === "careNoMotion" || key === "coldHouse";
    if (careScenario && connectionMode === "demo" && !careSettings().enabled) {
        houseSettings.care = { ...careSettings(), enabled: true };   // para a demonstração, liga o Modo Cuidar
        saveDemoSettings();
        renderCareForm();
        showToast("Modo Cuidar ligado para a demonstração.");
    }
    const result = await baseApplyScenarioCare(key);
    if (careScenario) careCheck({ force: true });
    return result;
};

const baseRenderStateCare = renderState;
renderState = function renderStateWithCare(state) {
    baseRenderStateCare(state);
    renderCare(state);
};

const baseRenderHouseSettingsCare = renderHouseSettings;
renderHouseSettings = function renderHouseSettingsWithCare() {
    baseRenderHouseSettingsCare();
    renderCareForm();
};

$("sosButton").addEventListener("click", () => sosRequest("aplicação"));
renderCareForm();
window.setInterval(careCheck, 5000);
