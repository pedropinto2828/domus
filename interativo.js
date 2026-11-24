/*
 * DOMUS+ — funcionalidades interativas do site
 * - Simulador de ambiente (modo demonstração) com as mesmas regras do firmware
 * - Explicação da decisão da casa ("o que a casa decidiu e porquê")
 * - Página Início com resumo do clima e medidor de conforto
 * - Céu, chuva, estore e temperaturas na Vista 3D
 * - Pesquisa rápida (Ctrl+K), tema claro/escuro e instalação como aplicação (PWA)
 *
 * Este ficheiro é carregado depois do app.js e reutiliza as suas funções
 * (renderState, controlDevice, activateMode, appendHistory, ...).
 */

const THERMAL_HYSTERESIS = 0.5;        // °C, igual ao firmware
const THERMAL_PAUSE_DEMO_MS = 600000;  // ordem manual pausa a gestão térmica 10 min
const SIM_TICK_MS = 2500;              // a ESP32 avalia a gestão térmica a cada 2,5 s

let simPauseUntil = 0;
let simRainLatched = false;
let simLastMotionAt = Date.now();
let simFaucetOnSince = 0;
let simAutomationLatch = {};
let simLog = [];
let simApplying = false;

const SEASON_NAMES = { summer: "Verão", winter: "Inverno", off: "Desligada" };

const SCENARIOS = {
    summerCool: {
        label: "Tarde quente, fora fresco",
        season: "summer", target: 25, tempIn: 29, tempOut: 21, lux: 700, rain: false, motion: false
    },
    summerHot: {
        label: "Calor lá fora",
        season: "summer", target: 25, tempIn: 28.5, tempOut: 34, lux: 950, rain: false, motion: false
    },
    winterSun: {
        label: "Manhã de inverno com sol",
        season: "winter", target: 21, tempIn: 18, tempOut: 9, lux: 650, rain: false, motion: false
    },
    winterNight: {
        label: "Noite de inverno",
        season: "winter", target: 21, tempIn: 19, tempOut: 5, lux: 15, rain: false, motion: false
    },
    rain: {
        label: "Começou a chover",
        lux: 120, rain: true, motion: false, before: (state) => { state.windows[0] = "open"; }
    },
    arrival: {
        label: "Chegada à noite",
        lux: 20, rain: false, motion: true,
        before: (state) => { state.lights = state.lights.map(() => false); }
    }
};

/* ---------- utilitários ---------- */

function temperatureText(value) {
    return Number.isFinite(value) ? `${numberText(value)} °C` : "--";
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function simDeviceName(device) {
    return (houseSettings.devices && houseSettings.devices[device]) || LIVE3D_DEVICE_NAMES[device] || device;
}

function saveDemoSettings() {
    try {
        localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
    } catch (error) {
        console.warn("Não foi possível guardar as definições do simulador.", error);
    }
}

function pushSimLog(text) {
    simLog.unshift({ time: new Date().toLocaleTimeString("pt-PT"), text });
    simLog = simLog.slice(0, 8);
}

/* ---------- lógica de decisão (igual ao firmware) ---------- */

// Devolve o que a gestão térmica faria com o estado indicado e a explicação de cada passo.
function thermalDecision(state) {
    const reasons = [];
    const actions = {};
    if (!state) return { active: false, reasons, actions, verdict: "Sem leituras: não é possível decidir." };

    const mode = state.activeMode || "auto";
    const season = state.season || houseSettings.season || "off";
    const target = isFiniteNumber(state.targetTemp) ? state.targetTemp : Number(houseSettings.targetTemp) || 25;
    const tIn = state.temperatureC;
    const tOut = state.temperatureOutC;
    const lux = state.luminosityLux;
    const rain = state.rainDetected === true;
    const paused = connectionMode === "demo" ? simPauseUntil > Date.now() : state.thermalPaused === true;

    if (mode !== "auto" && mode !== "eco") {
        reasons.push({ ok: false, text: `Modo ${MODE_NAMES[mode] || mode}: a gestão térmica só funciona nos modos Automático e ECO.` });
        return { active: false, reasons, actions, verdict: `Modo ${MODE_NAMES[mode] || mode}: a casa mantém o perfil do modo.` };
    }
    reasons.push({ ok: true, text: `Modo ${MODE_NAMES[mode]}: gestão térmica ativa${mode === "eco" ? " (sem ventoinha)" : ""}.` });
    if (paused) {
        reasons.push({ ok: false, text: "Houve uma ordem manual há menos de 10 minutos: a casa respeita a tua decisão." });
        return { active: false, reasons, actions, verdict: "Gestão térmica em pausa depois de uma ordem manual." };
    }
    if (season === "off") {
        reasons.push({ ok: false, text: "Estação desligada nas definições." });
        return { active: false, reasons, actions, verdict: "Gestão térmica desligada." };
    }
    if (!isFiniteNumber(tIn)) {
        reasons.push({ ok: false, text: "Sem leitura da temperatura interior." });
        return { active: false, reasons, actions, verdict: "À espera da temperatura interior." };
    }

    const hot = tIn > target + THERMAL_HYSTERESIS;
    const cool = tIn < target - THERMAL_HYSTERESIS;
    const useFan = mode === "auto";
    reasons.push({
        ok: true,
        text: `Estação ${SEASON_NAMES[season]}, alvo ${numberText(target)} °C · interior ${temperatureText(tIn)}` +
            (hot ? " → está calor" : cool ? " → está fresco" : " → dentro do conforto")
    });

    // Como no firmware: diferença de 0,5 °C entre dentro e fora; no simulador
    // a confirmação de 10 min da luz é ignorada para o efeito se ver logo.
    const outsideCooler = isFiniteNumber(tOut) && tOut < tIn - THERMAL_HYSTERESIS;
    const outsideWarmer = isFiniteNumber(tOut) && tOut > tIn + THERMAL_HYSTERESIS;
    const luxOk = isFiniteNumber(lux);
    const luxText = luxOk ? `${Math.round(lux)} lx` : "-- lx";

    if (season === "summer") {
        reasons.push({ ok: outsideCooler, text: `Exterior ${temperatureText(tOut)}: ${outsideCooler ? "mais fresco do que dentro" : outsideWarmer ? "mais quente do que dentro" : "quase igual a dentro"}.` });
        const parts = [];
        if (hot && outsideCooler && !rain) {
            actions.window1 = "open";
            parts.push("abrir a janela (ventilação natural)");
        } else if (outsideWarmer || cool) {
            actions.window1 = "closed";
            parts.push(outsideWarmer ? "fechar a janela (fora está mais quente)" : "fechar a janela (casa já fresca)");
        }
        if (hot && outsideCooler && rain) reasons.push({ ok: false, text: "Está a chover: a janela não pode abrir." });
        if (hot && luxOk && lux > 600) {
            actions.window2 = "closed";
            parts.push("descer o estore");
            reasons.push({ ok: true, text: `Sol forte (${luxText} > 600 lx): descer o estore para fazer sombra.` });
        } else if (!hot && luxOk && lux < 400) {
            actions.window2 = "open";
            parts.push("subir o estore");
            reasons.push({ ok: true, text: `Sol fraco (${luxText} < 400 lx): o estore pode subir.` });
        }
        if (hot && useFan) { actions.fan = true; parts.push("ligar a ventoinha"); }
        if (cool) { actions.fan = false; parts.push("desligar a ventoinha"); }
        const verdict = parts.length ? parts[0].charAt(0).toUpperCase() + parts.join(", ").slice(1) + "." : "Temperatura dentro do conforto: nada a mudar.";
        return { active: true, reasons, actions, verdict };
    }

    // Inverno: o alvo é o limite dos ganhos solares
    if (luxOk && lux < 50) {
        actions.window2 = "closed";
        reasons.push({ ok: true, text: `Noite (${luxText} < 50 lx): descer o estore para isolar.` });
    } else if (hot) {
        actions.window2 = "closed";
        reasons.push({ ok: true, text: `Acima do alvo: descer o estore para não sobreaquecer.` });
    } else if (luxOk && lux > 400) {
        actions.window2 = "open";
        reasons.push({ ok: true, text: `Sol (${luxText} > 400 lx) e abaixo do alvo: subir o estore para aproveitar o calor.` });
    } else {
        reasons.push({ ok: true, text: `Luz moderada (${luxText}): o estore fica como está.` });
    }
    if (hot && outsideCooler && !rain) {
        actions.window1 = "open";
        reasons.push({ ok: true, text: "Sobreaquecimento e fora mais fresco: abrir a janela para arejar." });
    } else if (!hot) {
        actions.window1 = "closed";
    }
    actions.fan = false;
    return {
        active: true, reasons, actions,
        verdict: actions.window1 === "open" ? "Arejar: estore em baixo e janela aberta."
            : actions.window2 === "open" ? "Ganhos solares: estore em cima, janela fechada."
            : actions.window2 === "closed" ? "Isolar a casa: estore em baixo, janela fechada."
                : "Guardar o calor: janela fechada e ventoinha desligada."
    };
}

// Aplica uma ordem ao estado de demonstração e regista-a, como a ESP32 faria.
function simApply(device, value, source, reason) {
    const s = demoState;
    let changed = false;
    if (device === "window1" || device === "window2") {
        const index = device === "window1" ? 0 : 1;
        const target = value ? "open" : "closed";
        if (index === 0 && value && s.rainDetected) return false;   // a chuva manda
        if (s.windows[index] !== target) { s.windows[index] = target; changed = true; }
    } else if (isLight(device)) {
        const index = lightIndex(device);
        if (s.lights[index] !== value) { s.lights[index] = value; changed = true; }
    } else if (device === "fan") {
        if (s.fanOn !== value) { s.fanOn = value; changed = true; }
    } else if (device === "faucet") {
        if (s.faucetOn !== value) {
            s.faucetOn = value;
            faucetDemoStopsAt = value ? Date.now() + Math.min(60, Number(houseSettings.faucetSeconds) || 60) * 1000 : 0;
            changed = true;
        }
    }
    if (!changed) return false;
    const isWindow = device.startsWith("window");
    const action = isWindow
        ? (device === "window2" ? (value ? "Subir" : "Descer") : (value ? "Abrir" : "Fechar"))
        : (value ? "Ligar" : "Desligar");
    appendHistory({ device: simDeviceName(device), action, source, result: `simulação · ${reason}` });
    pushSimLog(`${action} ${simDeviceName(device).toLowerCase()} — ${source}: ${reason}`);
    return true;
}

function simAutomationCondition(rule, s) {
    switch (rule.condition) {
        case "rain": return s.rainDetected === true;
        case "dark_motion": return isFiniteNumber(s.luminosityLux) && s.luminosityLux <= Number(rule.threshold) && s.motionDetected === true;
        case "temperature_above": return isFiniteNumber(s.temperatureC) && s.temperatureC > Number(rule.threshold);
        case "temperature_below": return isFiniteNumber(s.temperatureC) && s.temperatureC < Number(rule.threshold);
        case "no_motion": return !s.motionDetected && Date.now() - simLastMotionAt >= (Number(rule.durationSeconds) || 60) * 1000;
        case "faucet_open_for": return s.faucetOn && simFaucetOnSince && Date.now() - simFaucetOnSince >= (Number(rule.durationSeconds) || 30) * 1000;
        default: return false;
    }
}

// Um "ciclo" da casa em demonstração: segurança, automatizações, controlo automático e gestão térmica.
function runSimulation() {
    if (connectionMode !== "demo" || simApplying) return;
    simApplying = true;
    const s = demoState;
    const mode = s.activeMode || "auto";

    if (s.motionDetected) simLastMotionAt = Date.now();
    if (s.faucetOn && !simFaucetOnSince) simFaucetOnSince = Date.now();
    if (!s.faucetOn) simFaucetOnSince = 0;

    // 1. Segurança: a chuva fecha a janela uma vez por evento
    if (s.rainDetected) {
        if (!simRainLatched) {
            simRainLatched = true;
            simApply("window1", false, "segurança", "chuva detetada");
            addNotification({ title: "Chuva detetada", message: "A janela foi fechada automaticamente (simulação).", severity: "warning" });
        }
    } else {
        simRainLatched = false;
    }

    // 2. Automatizações criadas pelo utilizador (sobem uma vez quando a condição passa a verdadeira)
    automations.forEach((rule) => {
        if (!rule.enabled) return;
        if (Array.isArray(rule.modes) && rule.modes.length && !rule.modes.includes(mode)) return;
        const met = simAutomationCondition(rule, s);
        if (met && !simAutomationLatch[rule.id]) {
            simAutomationLatch[rule.id] = true;
            const value = ["open", "on"].includes(rule.action);
            const targets = rule.device === "both_windows" ? ["window1", "window2"]
                : rule.device === "both_lights" ? [...LIGHT_IDS] : [rule.device];
            targets.forEach((device) => simApply(device, value, "automatização", rule.name));
            rule.lastRun = Date.now();
            rule.lastResult = "executada na simulação";
        } else if (!met) {
            simAutomationLatch[rule.id] = false;
        }
    });

    // 3. Controlo automático da luz da sala e da ventilação (definições)
    const auto = houseSettings.autoDevices || {};
    if (auto.light1) {
        const dark = isFiniteNumber(s.luminosityLux) && s.luminosityLux <= Number(houseSettings.darkThreshold || 50);
        if (dark && s.motionDetected) simApply("light1", true, "controlo automático", "escuro e movimento");
        else if (!s.motionDetected && Date.now() - simLastMotionAt >= Number(houseSettings.noMotionSeconds || 120) * 1000) {
            simApply("light1", false, "controlo automático", "sem movimento");
        }
    }
    if (auto.fan && (s.season || houseSettings.season) === "off" && isFiniteNumber(s.temperatureC)) {
        if (s.temperatureC >= Number(houseSettings.fanOnTemp)) simApply("fan", true, "controlo automático", "acima do limite");
        else if (s.temperatureC <= Number(houseSettings.fanOffTemp)) simApply("fan", false, "controlo automático", "abaixo do limite");
    }

    // 4. Gestão térmica sazonal
    const decision = thermalDecision(s);
    if (decision.active) {
        const why = decision.verdict.replace(/:.*$/, "").toLowerCase();
        if (decision.actions.window1) simApply("window1", decision.actions.window1 === "open", "gestão térmica", why);
        if (decision.actions.window2) simApply("window2", decision.actions.window2 === "open", "gestão térmica", why);
        if (typeof decision.actions.fan === "boolean") simApply("fan", decision.actions.fan, "gestão térmica", why);
    }

    s.thermalPaused = simPauseUntil > Date.now();
    simApplying = false;
    renderState(s);
}

/* ---------- simulador: interface ---------- */

function setSimulatorFromState(state) {
    const pairs = [
        ["simTempIn", state.temperatureC], ["simTempOut", state.temperatureOutC],
        ["simLux", state.luminosityLux],
        ["simTarget", isFiniteNumber(state.targetTemp) ? state.targetTemp : Number(houseSettings.targetTemp)]
    ];
    pairs.forEach(([id, value]) => {
        const input = $(id);
        if (input && document.activeElement !== input && isFiniteNumber(value)) input.value = value;
    });
    $("simTempInValue").textContent = temperatureText(Number($("simTempIn").value));
    $("simTempOutValue").textContent = temperatureText(Number($("simTempOut").value));
    $("simLuxValue").textContent = `${Math.round(Number($("simLux").value))} lx`;
    $("simTargetValue").textContent = temperatureText(Number($("simTarget").value));
    $("simRain").checked = state.rainDetected === true;
    $("simMotion").checked = state.motionDetected === true;
    const season = state.season || houseSettings.season || "off";
    document.querySelectorAll('input[name="simSeason"]').forEach((radio) => { radio.checked = radio.value === season; });
}

function renderSimulator(state) {
    const isDemo = connectionMode === "demo";
    $("simulatorSection").classList.toggle("disabled", !isDemo);
    $("simulatorBadge").textContent = isDemo ? "Ativo" : "Com a ESP32 ligada, os valores vêm dos sensores reais";
    document.querySelectorAll("#simulatorSection input, .scenario-chip").forEach((element) => { element.disabled = !isDemo; });
    if (state) setSimulatorFromState(state);

    const decision = thermalDecision(state);
    $("simVerdict").textContent = decision.verdict;
    const list = $("simReasons");
    list.replaceChildren();
    if (state && state.rainDetected) {
        const li = document.createElement("li");
        li.className = "warn";
        li.textContent = "Segurança: está a chover, por isso a janela fica fechada em qualquer modo.";
        list.append(li);
    }
    decision.reasons.forEach((reason) => {
        const li = document.createElement("li");
        li.className = reason.ok ? "ok" : "no";
        li.textContent = reason.text;
        list.append(li);
    });

    const pausedFor = isDemo ? simPauseUntil - Date.now() : 0;
    $("simPause").hidden = !(pausedFor > 0);
    if (pausedFor > 0) {
        $("simPauseText").textContent = `Gestão térmica em pausa durante mais ${Math.ceil(pausedFor / 60000)} min (ordem manual).`;
    }

    const log = $("simLog");
    log.replaceChildren();
    if (!simLog.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Escolhe um cenário ou mexe nos controlos.";
        log.append(li);
    }
    simLog.forEach((entry) => {
        const li = document.createElement("li");
        const time = document.createElement("time");
        time.textContent = entry.time;
        li.append(time, document.createTextNode(entry.text));
        log.append(li);
    });
}

function readSimulatorInputs() {
    if (connectionMode !== "demo") return;
    demoState.temperatureC = Number($("simTempIn").value);
    demoState.temperatureOutC = Number($("simTempOut").value);
    demoState.luminosityLux = Number($("simLux").value);
    demoState.rainDetected = $("simRain").checked;
    demoState.motionDetected = $("simMotion").checked;
    const target = Number($("simTarget").value);
    const season = (document.querySelector('input[name="simSeason"]:checked') || {}).value || "summer";
    if (houseSettings.targetTemp !== target || houseSettings.season !== season) {
        houseSettings.targetTemp = target;
        houseSettings.season = season;
        saveDemoSettings();
        renderHouseSettings();
    }
    demoState.targetTemp = target;
    demoState.season = season;
    runSimulation();
}

async function applyScenario(key) {
    if (connectionMode !== "demo") {
        showToast("Os cenários só funcionam em modo de demonstração.");
        return;
    }
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    if (!["auto", "eco"].includes(demoState.activeMode)) await activateMode("auto");
    simPauseUntil = 0;
    if (scenario.before) scenario.before(demoState);
    if (scenario.season) {
        houseSettings.season = scenario.season;
        demoState.season = scenario.season;
    }
    if (isFiniteNumber(scenario.target)) {
        houseSettings.targetTemp = scenario.target;
        demoState.targetTemp = scenario.target;
    }
    saveDemoSettings();
    renderHouseSettings();
    ["tempIn", "tempOut", "lux"].forEach((field) => {
        const map = { tempIn: "temperatureC", tempOut: "temperatureOutC", lux: "luminosityLux" };
        if (isFiniteNumber(scenario[field])) demoState[map[field]] = scenario[field];
    });
    demoState.rainDetected = scenario.rain === true;
    demoState.motionDetected = scenario.motion === true;
    pushSimLog(`Cenário: ${scenario.label}`);
    document.querySelectorAll(".scenario-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.scenario === key));
    runSimulation();
    showToast(`Cenário "${scenario.label}" aplicado. Vê a casa reagir.`);
}

function seedDemoAutomation() {
    if (connectionMode !== "demo" || automations.length) return;
    try {
        if (localStorage.getItem("domus-sim-seeded")) return;
        localStorage.setItem("domus-sim-seeded", "1");
    } catch (error) {
        return;
    }
    automations.push({
        id: "exemplo-hall",
        name: "Luz do hall com movimento (exemplo)",
        condition: "dark_motion",
        threshold: 50,
        device: "light6",
        action: "on",
        modes: ["auto", "eco", "night"],
        enabled: true
    });
    try { localStorage.setItem("domus-automations", JSON.stringify(automations)); } catch (error) { /* sem armazenamento */ }
    renderAutomationList();
}

/* ---------- página Início e Vista 3D ---------- */

function greetingText() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return "BOM DIA";
    if (hour >= 12 && hour < 20) return "BOA TARDE";
    return "BOA NOITE";
}

function renderHomeHero(state) {
    $("heroGreeting").textContent = greetingText();
    const tIn = state ? state.temperatureC : null;
    const tOut = state ? state.temperatureOutC : null;
    $("heroTempIn").textContent = temperatureText(tIn);
    $("heroTempOut").textContent = temperatureText(tOut);
    const target = state && isFiniteNumber(state.targetTemp) ? state.targetTemp : Number(houseSettings.targetTemp) || 25;
    const pct = (value) => Math.max(0, Math.min(100, ((value - 15) / 20) * 100));
    $("comfortTarget").style.left = `${pct(target - THERMAL_HYSTERESIS)}%`;
    $("comfortTarget").style.width = `${pct(target + THERMAL_HYSTERESIS) - pct(target - THERMAL_HYSTERESIS)}%`;
    const marker = $("comfortMarker");
    marker.hidden = !isFiniteNumber(tIn);
    if (isFiniteNumber(tIn)) {
        marker.style.left = `${pct(tIn)}%`;
        marker.className = "comfort-marker " + (tIn > target + THERMAL_HYSTERESIS ? "hot" : tIn < target - THERMAL_HYSTERESIS ? "cold" : "ok");
    }
    $("comfortLabel").textContent = `alvo ${numberText(target)} °C`;
    const season = (state && state.season) || houseSettings.season || "off";
    const mode = (state && state.activeMode) || "auto";
    $("heroSeason").textContent = `Estação: ${SEASON_NAMES[season] || "--"} · Modo ${MODE_NAMES[mode] || "--"}`;
    $("heroDecision").textContent = state
        ? thermalDecision(state).verdict
        : "Sem comunicação com a ESP32: as decisões continuam a ser tomadas na placa.";
}

function render3DEnvironment(state) {
    const viewport = $("live3dViewport");
    const lux = state ? state.luminosityLux : null;
    const phase = !isFiniteNumber(lux) ? "day" : lux < 50 ? "night" : lux < 400 ? "dusk" : "day";
    ["day", "dusk", "night"].forEach((name) => viewport.classList.toggle(`env-${name}`, phase === name));
    viewport.classList.toggle("env-rain", Boolean(state && state.rainDetected));
    $("live3dTempIn").textContent = temperatureText(state ? state.temperatureC : null);
    $("live3dTempOut").textContent = `Ext. ${temperatureText(state ? state.temperatureOutC : null)}`;
}

/* ---------- pesquisa rápida (Ctrl+K) ---------- */

const PAGE_LABELS = {
    home: "Início", plant: "Planta da Casa", live3d: "Vista 3D ao Vivo", equipment: "Equipamentos",
    automations: "Automatizações", schedules: "Horários", statistics: "Estatísticas", alerts: "Alertas",
    history: "Histórico", diagnostics: "Diagnóstico", settings: "Definições", about: "Sobre o projeto"
};
let commandItems = [];
let commandIndex = 0;

function normalizeText(text) {
    return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function buildCommands() {
    const list = [];
    Object.entries(PAGE_LABELS).forEach(([page, label]) =>
        list.push({ group: "Ir para", label, run: () => navigateToPage(page) }));
    Object.keys(MODE_NAMES).forEach((mode) =>
        list.push({ group: "Modo", label: `Ativar modo ${MODE_NAMES[mode]}`, run: () => activateMode(mode) }));
    LIGHT_IDS.forEach((device) => {
        list.push({ group: "Luz", label: `Ligar luz: ${simDeviceName(device)}`, run: () => controlDevice(device, true) });
        list.push({ group: "Luz", label: `Desligar luz: ${simDeviceName(device)}`, run: () => controlDevice(device, false) });
    });
    list.push({ group: "Luz", label: "Ligar todas as luzes", run: () => executeConfiguredAction("both_lights", "on") });
    list.push({ group: "Luz", label: "Desligar todas as luzes", run: () => executeConfiguredAction("both_lights", "off") });
    list.push({ group: "Equipamento", label: "Abrir janela", run: () => controlDevice("window1", true) });
    list.push({ group: "Equipamento", label: "Fechar janela", run: () => controlDevice("window1", false) });
    list.push({ group: "Equipamento", label: "Subir estore", run: () => controlDevice("window2", true) });
    list.push({ group: "Equipamento", label: "Descer estore", run: () => controlDevice("window2", false) });
    list.push({ group: "Equipamento", label: "Ligar ventoinha", run: () => controlDevice("fan", true) });
    list.push({ group: "Equipamento", label: "Desligar ventoinha", run: () => controlDevice("fan", false) });
    list.push({ group: "Equipamento", label: "Abrir torneira", run: () => controlDevice("faucet", true) });
    list.push({ group: "Equipamento", label: "Fechar torneira", run: () => controlDevice("faucet", false) });
    list.push({ group: "Equipamento", label: "Parar movimentos", run: () => stopMovements() });
    if (connectionMode === "demo") {
        Object.entries(SCENARIOS).forEach(([key, scenario]) =>
            list.push({
                group: "Simular", label: scenario.label,
                run: () => { navigateToPage("live3d"); applyScenario(key); }
            }));
    }
    list.push({ group: "Site", label: "Mudar tema claro/escuro", run: () => toggleTheme() });
    return list;
}

function renderCommandList() {
    const query = normalizeText($("commandInput").value.trim());
    const words = query.split(/\s+/).filter(Boolean);
    commandItems = buildCommands().filter((item) => {
        const haystack = normalizeText(`${item.group} ${item.label}`);
        return words.every((word) => haystack.includes(word));
    }).slice(0, 9);
    commandIndex = Math.min(commandIndex, Math.max(0, commandItems.length - 1));
    const list = $("commandList");
    list.replaceChildren();
    if (!commandItems.length) {
        const li = document.createElement("li");
        li.className = "command-empty";
        li.textContent = "Nenhum resultado. Experimenta \"luz\", \"modo\" ou \"chuva\".";
        list.append(li);
        return;
    }
    commandItems.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "command-item" + (index === commandIndex ? " active" : "");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(index === commandIndex));
        const group = document.createElement("span");
        group.className = "command-group";
        group.textContent = item.group;
        const label = document.createElement("span");
        label.textContent = item.label;
        li.append(group, label);
        li.addEventListener("mousemove", () => { if (commandIndex !== index) { commandIndex = index; renderCommandList(); } });
        li.addEventListener("click", () => runCommand(index));
        list.append(li);
    });
}

function openCommandPalette() {
    $("commandPalette").hidden = false;
    $("commandInput").value = "";
    commandIndex = 0;
    renderCommandList();
    $("commandInput").focus();
}

function closeCommandPalette() {
    $("commandPalette").hidden = true;
    $("openCommandPalette").focus();
}

function runCommand(index) {
    const item = commandItems[index];
    if (!item) return;
    closeCommandPalette();
    Promise.resolve(item.run()).catch((error) => showToast(error.message));
}

/* ---------- tema claro/escuro ---------- */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    $("themeToggle").setAttribute("aria-pressed", String(dark));
    $("themeToggle").setAttribute("aria-label", dark ? "Mudar para tema claro" : "Mudar para tema escuro");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0b1424" : "#10233f");
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("domus-theme", next); } catch (error) { /* sem armazenamento */ }
}

function initialTheme() {
    try {
        const saved = localStorage.getItem("domus-theme");
        if (saved === "dark" || saved === "light") return saved;
    } catch (error) { /* sem armazenamento */ }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* ---------- ligação às funções do app.js ---------- */

const baseRenderState = renderState;
renderState = function renderStateWithExtras(state) {
    baseRenderState(state);
    renderHomeHero(state);
    render3DEnvironment(state);
    renderSimulator(state);
};

const baseControlDevice = controlDevice;
controlDevice = async function controlDeviceWithRules(device, value) {
    if (connectionMode === "demo" && device === "window1" && value && demoState.rainDetected) {
        appendHistory({ device: simDeviceName("window1"), action: "Abrir", source: "aplicação", result: "bloqueada: sensor de chuva ativo (simulação)" });
        showToast("bloqueada: sensor de chuva ativo");
        return false;
    }
    const ok = await baseControlDevice(device, value);
    if (ok && connectionMode === "demo" && (device.startsWith("window") || device === "fan")) {
        simPauseUntil = Date.now() + THERMAL_PAUSE_DEMO_MS;   // respeitar a ordem manual, como a ESP32
        renderState(demoState);
    }
    return ok;
};

const baseActivateMode = activateMode;
activateMode = async function activateModeWithSimulation(mode) {
    const ok = await baseActivateMode(mode);
    if (ok && connectionMode === "demo") runSimulation();
    return ok;
};

function bindInteractiveEvents() {
    ["simTempIn", "simTempOut", "simLux", "simTarget"].forEach((id) =>
        $(id).addEventListener("input", readSimulatorInputs));
    ["simRain", "simMotion"].forEach((id) => $(id).addEventListener("change", readSimulatorInputs));
    document.querySelectorAll('input[name="simSeason"]').forEach((radio) =>
        radio.addEventListener("change", readSimulatorInputs));
    document.querySelectorAll(".scenario-chip").forEach((chip) =>
        chip.addEventListener("click", () => applyScenario(chip.dataset.scenario)));
    $("simResume").addEventListener("click", () => {
        simPauseUntil = 0;
        pushSimLog("Gestão térmica retomada pelo utilizador");
        runSimulation();
    });

    // Botões que levam a uma secção dentro de outra página
    document.querySelectorAll("[data-scroll-to]").forEach((button) =>
        button.addEventListener("click", () => window.setTimeout(() => {
            const target = $(button.dataset.scrollTo);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60)));

    // Cartões do Início funcionam com o teclado (Enter ou Espaço)
    document.querySelectorAll('[data-go-page][role="button"]').forEach((card) =>
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); card.click(); }
        }));

    $("openCommandPalette").addEventListener("click", openCommandPalette);
    $("commandInput").addEventListener("input", () => { commandIndex = 0; renderCommandList(); });
    $("commandPalette").addEventListener("click", (event) => {
        if (event.target === $("commandPalette")) closeCommandPalette();
    });
    $("commandInput").addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); commandIndex = Math.min(commandItems.length - 1, commandIndex + 1); renderCommandList(); }
        if (event.key === "ArrowUp") { event.preventDefault(); commandIndex = Math.max(0, commandIndex - 1); renderCommandList(); }
        if (event.key === "Enter") { event.preventDefault(); runCommand(commandIndex); }
    });
    $("themeToggle").addEventListener("click", toggleTheme);

    document.addEventListener("keydown", (event) => {
        const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            if ($("commandPalette").hidden) openCommandPalette(); else closeCommandPalette();
        } else if (event.key === "/" && !typing && $("commandPalette").hidden) {
            event.preventDefault();
            openCommandPalette();
        } else if (event.key === "Escape" && !$("commandPalette").hidden) {
            closeCommandPalette();
        } else if (event.key === "D" && event.shiftKey && !typing) {
            toggleTheme();
        }
    });
}

function registerOfflineSupport() {
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!("serviceWorker" in navigator) || !(window.location.protocol === "https:" || local)) return;
    // Quando há uma versão nova do site, a página passa a usá-la sozinha (sem ter de recarregar)
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !reloaded) { reloaded = true; window.location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").then((registration) => {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") registration.update().catch(() => {});
        });
    }).catch(() => { /* sem suporte nesta origem */ });
}

applyTheme(initialTheme());
bindInteractiveEvents();
seedDemoAutomation();
registerOfflineSupport();
renderState(currentState);
window.setInterval(() => {
    if (connectionMode === "demo") runSimulation();
}, SIM_TICK_MS);
