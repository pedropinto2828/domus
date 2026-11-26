/* DOMUS+ — Energia estimada (página Energia).
 *
 * A maquete não tem sensor de corrente: a energia é ESTIMADA com potência × tempo.
 * Ex.: a ventoinha (45 W) ligada 2 horas gasta 45 × 2 = 90 Wh = 0,09 kWh.
 * Em demonstração, o site conta o tempo enquanto está aberto (de 5 em 5 s) e guarda
 * 7 dias neste navegador. Com a casa ligada, os valores vêm da ESP32 (GET /api/energy),
 * que conta sempre, com as mesmas potências (firmware/energia.h).
 */
const ENERGY_W = { light: 8, fan: 45, pump: 30, system: 1 };       // watts
const ENERGY_WH_PER_MOVE = 60 * 15 / 3600;                          // motor 60 W durante 15 s
const ENERGY_WATER_L_PER_S = 0.1;                                    // 6 litros por minuto
const ENERGY_KEYS = [...LIGHT_IDS, "fan", "windows", "faucet", "system"];
const ENERGY_STORAGE_KEY = "domus-energy";
const ENERGY_TICK_MS = 5000;
const ENERGY_REMOTE_MS = 60000;

// Número com vírgula, à portuguesa: 23.5 -> "23,5"
const decimalText = (value, decimals) => Number(value).toLocaleString("pt-PT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

let energyLocalDays = loadEnergyDays();   // [{ date, devices: {...Wh}, waterL }], o último é hoje
let energyRemote = null;                  // dados recebidos da ESP32
let energyLastTick = Date.now();
let energyLastWindows = JSON.stringify(demoState.windows);

function localDateKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptyEnergyDay(date) {
    return { date, devices: Object.fromEntries(ENERGY_KEYS.map((key) => [key, 0])), waterL: 0 };
}

function loadEnergyDays() {
    try {
        const saved = JSON.parse(localStorage.getItem(ENERGY_STORAGE_KEY) || "[]");
        if (Array.isArray(saved)) {
            return saved.filter((day) => day && typeof day.date === "string" && day.devices)
                .map((day) => ({ ...emptyEnergyDay(day.date), ...day, devices: { ...emptyEnergyDay(day.date).devices, ...day.devices } }))
                .slice(-7);
        }
    } catch (error) { /* armazenamento indisponível: começa do zero */ }
    return [];
}

function saveEnergyDays() {
    try { localStorage.setItem(ENERGY_STORAGE_KEY, JSON.stringify(energyLocalDays)); } catch (error) { /* sem armazenamento */ }
}

// O dia de hoje (se mudou o dia, começa um novo e guardam-se só 7)
function energyToday() {
    const today = localDateKey();
    const last = energyLocalDays[energyLocalDays.length - 1];
    if (!last || last.date !== today) {
        energyLocalDays.push(emptyEnergyDay(today));
        energyLocalDays = energyLocalDays.slice(-7);
    }
    return energyLocalDays[energyLocalDays.length - 1];
}

// De 5 em 5 segundos, em demonstração: soma a energia dos equipamentos ligados
function energyTick() {
    const now = Date.now();
    const seconds = Math.min(60, Math.max(0, (now - energyLastTick) / 1000));   // separador em segundo plano: no máximo 1 min
    energyLastTick = now;
    if (connectionMode !== "demo") return;
    const day = energyToday();
    const hours = seconds / 3600;
    LIGHT_IDS.forEach((device, index) => { if (demoState.lights[index]) day.devices[device] += ENERGY_W.light * hours; });
    if (demoState.fanOn) day.devices.fan += ENERGY_W.fan * hours;
    if (demoState.faucetOn) {
        day.devices.faucet += ENERGY_W.pump * hours;
        day.waterL += ENERGY_WATER_L_PER_S * seconds;
    }
    day.devices.system += ENERGY_W.system * hours;
    // Cada vez que a janela ou o estore mudam de posição, conta um movimento do motor
    const windowsNow = demoState.windows || [];
    const windowsBefore = JSON.parse(energyLastWindows);
    windowsNow.forEach((state, index) => { if (state !== windowsBefore[index]) day.devices.windows += ENERGY_WH_PER_MOVE; });
    energyLastWindows = JSON.stringify(windowsNow);
    saveEnergyDays();
    renderEnergy();
}

async function refreshRemoteEnergy() {
    if (connectionMode !== "esp32") return;
    try {
        const data = await apiRequest("/api/energy");
        if (data && Array.isArray(data.days)) energyRemote = data;
    } catch (error) {
        energyRemote = null;
    }
    renderEnergy();
}

function energyData() {
    if (connectionMode === "esp32") {
        return energyRemote
            ? { days: energyRemote.days, price: Number(energyRemote.price) || 0.16, source: "Estimativa da ESP32" }
            : { days: [], price: houseSettings.energyPrice || 0.16, source: "A pedir à ESP32…" };
    }
    energyToday();
    return { days: energyLocalDays, price: Number(houseSettings.energyPrice) || 0.16, source: "Estimativa (demonstração)" };
}

const dayTotalWh = (day) => ENERGY_KEYS.reduce((sum, key) => sum + (Number(day.devices[key]) || 0), 0);
const formatWh = (wh) => (wh >= 1000 ? `${decimalText(wh / 1000, 2)} kWh` : `${decimalText(wh, wh < 10 ? 2 : 1)} Wh`);
const formatEuro = (eur) => (eur > 0 && eur < 0.01 ? "menos de 0,01 €" : `${decimalText(eur, 2)} €`);

function energyDeviceName(key) {
    if (key === "windows") return "Motores (janela e estore)";
    if (key === "system") return "Sistema DOMUS+";
    return isLight(key) ? `Luz ${simDeviceName(key)}` : simDeviceName(key);
}

// O equipamento que mais gastou hoje (sem contar o sistema)
function energyTop(day) {
    const entries = ENERGY_KEYS.filter((key) => key !== "system").map((key) => [key, Number(day.devices[key]) || 0]);
    const [key, wh] = entries.reduce((best, item) => (item[1] > best[1] ? item : best), [null, 0]);
    return wh > 0 ? { key, wh } : null;
}

// Resposta ao "energia" no Telegram
function energyTodayText() {
    const { days, price } = energyData();
    const day = days[days.length - 1] || emptyEnergyDay(localDateKey());
    const wh = dayTotalWh(day);
    const top = energyTop(day);
    return `⚡ Hoje (estimativa): ${decimalText(wh / 1000, 3)} kWh, ${formatEuro(wh / 1000 * price)}, água ${decimalText(day.waterL || 0, 0)} litros.` +
        (top ? ` O que mais gastou: ${energyDeviceName(top.key)}.` : "");
}

function renderEnergy() {
    if (!$("energySection")) return;
    const { days, price, source } = energyData();
    const today = days[days.length - 1] || emptyEnergyDay(localDateKey());
    const todayWh = dayTotalWh(today);
    $("energySource").textContent = source;
    $("energyTodayKwh").textContent = `${decimalText(todayWh / 1000, 3)} kWh`;
    $("energyTodayWh").textContent = `${decimalText(todayWh, 1)} Wh`;
    $("energyTodayCost").textContent = formatEuro(todayWh / 1000 * price);
    $("energyPriceText").textContent = `a ${decimalText(price, 2)} €/kWh`;
    $("energyTodayWater").textContent = `${decimalText(today.waterL || 0, 0)} L`;

    // Últimos 7 dias (dias sem registo contam 0)
    const week = [];
    for (let back = 6; back >= 0; back -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - back);
        const key = localDateKey(date);
        const found = days.find((day) => day.date === key);
        week.push({ date, key, wh: found ? dayTotalWh(found) : 0, today: back === 0 });
    }
    const weekWh = week.reduce((sum, day) => sum + day.wh, 0);
    $("energyWeekKwh").textContent = `${decimalText(weekWh / 1000, 3)} kWh`;
    $("energyWeekCost").textContent = formatEuro(weekWh / 1000 * price);

    // O que gastou hoje, do maior para o menor
    const list = $("energyDeviceList");
    list.replaceChildren();
    const rows = ENERGY_KEYS.map((key) => [key, Number(today.devices[key]) || 0]).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...rows.map(([, wh]) => wh), 0.0001);
    rows.forEach(([key, wh]) => {
        const li = document.createElement("li");
        li.className = "energy-row";
        const name = document.createElement("span");
        name.textContent = energyDeviceName(key);
        const bar = document.createElement("span");
        bar.className = "energy-bar";
        const fill = document.createElement("span");
        fill.style.width = `${Math.round(wh / max * 100)}%`;
        bar.append(fill);
        const value = document.createElement("span");
        value.className = "energy-value";
        value.textContent = formatWh(wh);
        li.append(name, bar, value);
        list.append(li);
    });

    const chart = $("energyWeek");
    chart.replaceChildren();
    const weekMax = Math.max(...week.map((day) => day.wh), 0.0001);
    week.forEach((day) => {
        const column = document.createElement("div");
        column.className = "energy-day" + (day.today ? " today" : "");
        column.title = `${day.key}: ${formatWh(day.wh)}`;
        const amount = document.createElement("span");
        amount.className = "energy-amount";
        amount.textContent = day.wh > 0 ? formatWh(day.wh).replace(" ", " ") : "–";
        const bar = document.createElement("span");
        bar.className = "energy-column";
        bar.style.height = `${Math.round(day.wh / weekMax * 100)}%`;
        const label = document.createElement("span");
        label.textContent = day.today ? "hoje" : day.date.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
        column.append(amount, bar, label);
        chart.append(column);
    });

    const top = energyTop(today);
    const devicesWh = todayWh - (Number(today.devices.system) || 0);
    let tip;
    if (!top) tip = "Hoje ainda nenhum equipamento gastou energia (só o sistema DOMUS+, sempre ligado).";
    else {
        const share = Math.round(top.wh / Math.max(devicesWh, 0.0001) * 100);
        tip = `Hoje, o que mais gastou foi ${energyDeviceName(top.key)} (${share} % dos equipamentos).`;
        if (top.key === "fan") tip += " Dica: no Modo ECO a casa arrefece com a janela e o estore, sem a ventoinha.";
        else if (isLight(top.key)) tip += " Dica: a luz da sala pode apagar-se sozinha quando não há movimento (controlo automático).";
    }
    $("energyTip").textContent = tip;
}

// Ao abrir a página Energia, mostra logo os valores atualizados
const baseNavigateToPageEnergy = navigateToPage;
navigateToPage = function navigateToPageWithEnergy(pageName, options) {
    baseNavigateToPageEnergy(pageName, options);
    if (pageName === "energy") {
        renderEnergy();
        refreshRemoteEnergy();
    }
};

window.setInterval(energyTick, ENERGY_TICK_MS);
window.setInterval(refreshRemoteEnergy, ENERGY_REMOTE_MS);
renderEnergy();
