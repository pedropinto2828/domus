"use strict";

const $ = (id) => document.getElementById(id);
const toast = $("toast");

let toastTimer;
let refreshTimer;
let connectionMode = "demo";
let apiBaseUrl = "";
let apiToken = "";
let currentState = null;
let faucetDemoStopsAt = 0;
let schedules = [];
let automations = [];
let editingAutomationId = null;
let editingScheduleId = null;
let historyEntries = [];
let notifications = [];
let sensorSamples = [];
let lastContactTime = null;
let lastHistoryRefresh = 0;
let lastSystemError = "";
let lastConnectionTest = "";
let lastAlertSnapshot = null;
let selectedModePreview = null;
let lastSampleAt = 0;
let live3DLastUpdate = null;
let live3DSelection = { type: "room", id: "living" };
let live3DLastCommands = {};
let live3DPointer = null;
let live3DDragged = false;
let live3DRotation = { x: 8, y: -7, z: -4 };
let live3DScale = 1;
const API_REQUEST_TIMEOUT_MS = 8000;

// 6 divisões com iluminação; janela (window1) e estore (window2)
const LIGHT_IDS = ["light1", "light2", "light3", "light4", "light5", "light6"];
const isLight = (device) => LIGHT_IDS.includes(device);
const lightIndex = (device) => LIGHT_IDS.indexOf(device);

const LIVE3D_ROOMS = {
    living: {
        name: "Sala e hall",
        devices: ["window1", "light1", "light6", "fan"],
        sensors: ["temperatureC", "humidityPercent", "luminosityLux", "motionDetected", "window1"]
    },
    bedroom: {
        name: "Quartos e casa de banho",
        devices: ["window2", "light3", "light4", "light5"],
        sensors: ["window2"]
    },
    kitchen: { name: "Cozinha", devices: ["light2", "faucet"], sensors: [] },
    outside: { name: "Exterior", devices: [], sensors: ["temperatureOutC", "rainDetected", "luminosityLux"] }
};

const LIVE3D_DEVICE_NAMES = {
    window1: "Janela",
    window2: "Estore",
    light1: "Sala",
    light2: "Cozinha",
    light3: "Quarto 1",
    light4: "Quarto 2",
    light5: "Casa de banho",
    light6: "Hall/Garagem",
    fan: "Ventoinha",
    faucet: "Torneira",
    rainDetected: "Sensor de chuva",
    motionDetected: "Sensor de movimento"
};

const DEFAULT_SETTINGS = {
    homeName: "A minha casa",
    roomName: "Sala",
    devices: {
        window1: "Janela",
        window2: "Estore",
        light1: "Sala",
        light2: "Cozinha",
        light3: "Quarto 1",
        light4: "Quarto 2",
        light5: "Casa de banho",
        light6: "Hall/Garagem",
        fan: "Ventoinha",
        faucet: "Torneira"
    },
    fanOnTemp: 27,
    fanOffTemp: 25,
    darkThreshold: 50,
    noMotionSeconds: 120,
    faucetSeconds: 60,
    season: "summer",
    targetTemp: 25,
    temperatureOffsetC: 0,
    autoDevices: { light1: false, fan: false },
    weather: { city: "Vizela", lat: 41.38, lon: -8.31 },   // previsão do tempo (Open-Meteo)
    telegramToken: "",                                      // avisos no telemóvel: código do bot do Telegram
    telegramChatId: "",                                     // e a conversa para onde os enviar
    noticeLevel: "all",                                     // "all" = tudo; "important" = só o importante
    telegramCommands: true,                                 // aceitar ordens escritas ao bot (só da conversa ligada)
    energyPrice: 0.16,                                      // preço da eletricidade (€/kWh) para a página Energia
    care: {                                                 // Modo Cuidar (cuidar.js): pessoas idosas que vivem sozinhas
        enabled: false, hours: 4, start: 8, end: 22,        // avisar sem movimento durante 4 h, entre as 8 e as 22
        minTemp: 18, maxTemp: 28, maxHumidity: 70,          // avisos de saúde: frio, calor e humidade
        reminders: []                                       // até 4 lembretes diários { time: "09:00", text: "…" }
    }
};

const MODE_NAMES = {
    auto: "Automático",
    eco: "ECO",
    night: "Noite",
    away: "Ausente"
};

const MODE_ACTIONS = {
    auto: {
        window1: "keep", window2: "keep",
        light1: "keep", light2: "keep", light3: "keep", light4: "keep", light5: "keep", light6: "keep",
        fan: "keep", faucet: "off"
    },
    eco: {
        window1: "keep", window2: "keep",
        light1: "keep", light2: "keep", light3: "keep", light4: "keep", light5: "keep", light6: "keep",
        fan: "off", faucet: "off"
    },
    night: {
        window1: "closed", window2: "closed",
        light1: "off", light2: "off", light3: "off", light4: "off", light5: "off", light6: "off",
        fan: "off", faucet: "off"
    },
    away: {
        window1: "closed", window2: "closed",
        light1: "off", light2: "off", light3: "off", light4: "off", light5: "off", light6: "off",
        fan: "off", faucet: "off"
    }
};

const MODE_DEVICE_NAMES = {
    window1: "Janela",
    window2: "Estore",
    light1: "Sala",
    light2: "Cozinha",
    light3: "Quarto 1",
    light4: "Quarto 2",
    light5: "Casa de banho",
    light6: "Hall/Garagem",
    fan: "Ventoinha",
    faucet: "Torneira / bomba"
};

const MODE_ACTION_OPTIONS = {
    window1: [["keep", "Manter"], ["open", "Abrir"], ["closed", "Fechar"]],
    window2: [["keep", "Manter"], ["open", "Abrir"], ["closed", "Fechar"]],
    light1: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    light2: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    light3: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    light4: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    light5: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    light6: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    fan: [["keep", "Manter"], ["on", "Ligar"], ["off", "Desligar"]],
    faucet: [["keep", "Manter"], ["on", "Ligar por 60 s"], ["off", "Desligar"]]
};

const AUTOMATION_CONDITIONS = {
    rain: "É detetada chuva",
    dark_motion: "Está escuro e há movimento",
    no_motion: "Não há movimento durante um tempo",
    temperature_above: "A temperatura ultrapassa um limite",
    temperature_below: "A temperatura desce abaixo de um limite",
    faucet_open_for: "A torneira fica aberta durante um tempo",
    scheduled_time: "Chega a hora programada"
};

const AUTOMATION_ACTIONS = {
    windows: [["closed", "Fechar"], ["open", "Abrir"]],
    lights: [["off", "Desligar"], ["on", "Ligar"]],
    switch: [["off", "Desligar"], ["on", "Ligar"]]
};

const AUTOMATION_DEFAULTS = {
    rain: { device: "both_windows", action: "closed" },
    dark_motion: { device: "both_lights", action: "on" },
    no_motion: { device: "both_lights", action: "off" },
    temperature_above: { device: "fan", action: "on" },
    temperature_below: { device: "fan", action: "off" },
    faucet_open_for: { device: "faucet", action: "off" },
    scheduled_time: { device: "light1", action: "on" }
};

const DEMO_INITIAL_STATE = {
    connected: false,
    temperatureC: 24,
    temperatureOutC: 19,
    humidityPercent: 54,
    luminosityLux: 320,
    rainDetected: false,
    motionDetected: false,
    windows: ["closed", "open"],
    lights: [true, false, false, false, false, false],
    season: "summer",
    targetTemp: 25,
    fanOn: false,
    faucetOn: false,
    faucetRemainingSeconds: 0,
    activeMode: "auto",
    rtcAvailable: false,
    schedulesEnabled: false,
    localTime: null
};

let demoState = JSON.parse(JSON.stringify(DEMO_INITIAL_STATE));
let modeProfiles = JSON.parse(JSON.stringify(MODE_ACTIONS));

let houseSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(() => {
        toast.classList.remove("visible");
    }, 3000);
}

async function withBusyButton(button, label, action) {
    const originalMarkup = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
    try {
        await action();
    } finally {
        button.disabled = false;
        button.innerHTML = originalMarkup;
    }
}

function loadSavedPreferences() {
    try {
        const savedProfiles = localStorage.getItem("domus-profiles");
        const savedSchedules = localStorage.getItem("domus-schedules");
        const savedAutomations = localStorage.getItem("domus-automations");
        const savedSettings = localStorage.getItem("domus-settings");
        const savedHistory = localStorage.getItem("domus-history");
        const savedNotifications = localStorage.getItem("domus-notifications");
        const savedSamples = localStorage.getItem("domus-sensor-samples");
        apiBaseUrl = localStorage.getItem("domus-api-url") || "";
        apiToken = localStorage.getItem("domus-api-token") || "";
        const savedContact = localStorage.getItem("domus-last-contact");
        lastContactTime = savedContact ? new Date(savedContact) : null;
        connectionMode = localStorage.getItem("domus-connection-mode") === "esp32"
            ? "esp32"
            : "demo";

        if (savedProfiles) {
            const parsedProfiles = JSON.parse(savedProfiles);
            if (parsedProfiles && typeof parsedProfiles === "object") {
                modeProfiles = parsedProfiles;
            }
        }
        if (savedSchedules) {
            const parsedSchedules = JSON.parse(savedSchedules);
            if (Array.isArray(parsedSchedules)) schedules = parsedSchedules;
        }
        if (savedAutomations) {
            const parsedAutomations = JSON.parse(savedAutomations);
            if (Array.isArray(parsedAutomations)) {
                automations = parsedAutomations.filter(isValidAutomation);
            }
        }
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            if (parsedSettings && typeof parsedSettings === "object") {
                houseSettings = {
                    ...DEFAULT_SETTINGS,
                    ...parsedSettings,
                    devices: { ...DEFAULT_SETTINGS.devices, ...parsedSettings.devices },
                    autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...parsedSettings.autoDevices },
                    weather: { ...DEFAULT_SETTINGS.weather, ...parsedSettings.weather }
                };
            }
        }
        if (savedHistory) {
            const parsedHistory = JSON.parse(savedHistory);
            if (Array.isArray(parsedHistory)) historyEntries = parsedHistory.slice(0, 100);
        }
        if (savedNotifications) {
            const parsedNotifications = JSON.parse(savedNotifications);
            if (Array.isArray(parsedNotifications)) notifications = parsedNotifications.slice(0, 50);
        }
        if (savedSamples) {
            const parsedSamples = JSON.parse(savedSamples);
            if (Array.isArray(parsedSamples)) {
                sensorSamples = parsedSamples
                    .filter((sample) => sample && Number.isFinite(sample.timestamp))
                    .slice(-4000);
                lastSampleAt = sensorSamples.length
                    ? sensorSamples[sensorSamples.length - 1].timestamp
                    : 0;
            }
        }
    } catch (error) {
        console.warn("Não foi possível carregar as preferências.", error);
    }

    $("esp32Url").value = apiBaseUrl;
    $("esp32Token").value = apiToken;
    renderHouseSettings();
    renderHistory();
    renderNotifications();
    renderModeConfig();
    renderModePreview();
    renderScheduleList();
    renderAutomationForm();
    renderAutomationList();
    renderFloorPlan();
    renderStatistics();
    renderDiagnostics();
    renderModePreview();
}

function setConnectionStatus(status, className) {
    const statusPill = document.querySelector(".connection-pill");
    $("connectionStatus").textContent = status;
    $("systemConnectionStatus").textContent = status;
    $("dashboardConnectionDetail").textContent = status;
    $("homeConnectionSummary").textContent = status;
    $("homeConnectionDetail").textContent = className === "connected"
        ? "Comunicação ativa"
        : className === "demo" ? "Sem comandos reais" : "Verifica a ligação";
    statusPill.classList.remove("connected", "offline", "demo");
    statusPill.classList.add(className);
    statusPill.setAttribute("aria-label", `Estado da ESP32: ${status}`);
    $("sidebarConnectionStatus").textContent = status;
    $("connectionHelp").textContent = className === "connected"
        ? `Ligada a ${apiBaseUrl}.`
        : className === "offline"
            ? "Sem comunicação. Verifica o IP, o token e se a ESP32 está na mesma rede."
            : "Em demonstração; os valores são fictícios e os comandos não chegam à placa.";
    $("diagnosticStatus").textContent = className === "connected"
        ? `API disponível em ${apiBaseUrl}.`
        : className === "offline"
            ? "API indisponível. Confirma rede, endereço e token."
            : "Modo demonstração; hardware não ligado.";
    renderDiagnostics();
}

function numberText(value, digits = 1) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function timerText(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "Sem temporizador ativo";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `Tempo restante: ${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function renderState(state) {
    currentState = state;
    if (!state) {
        $("homeTemperature").textContent = "--";
        $("homeHumidity").textContent = "Humidade: --%";
        $("luminosityStatus").textContent = "--";
        $("rainStatus").textContent = "--";
        $("windowsSummary").textContent = "--";
        $("lightsSummary").textContent = "--";
        $("fanSummary").textContent = "--";
        $("faucetSummary").textContent = "--";
        $("faucetTimer").textContent = "Tempo restante: --";
        $("motionSummary").textContent = "--";
        $("summaryDisclaimer").textContent = "Sem comunicação com a ESP32; leituras indisponíveis.";
        ["window1Status", "window2Status", ...LIGHT_IDS.map((d) => `${d}Status`),
            "fanControlStatus", "faucetControlStatus"].forEach((id) => {
            $(id).textContent = "Sem comunicação";
        });
        $("automationNotice").textContent = connectionMode === "demo"
            ? "Modo demonstração: as regras não são executadas na ESP32."
            : "Sem comunicação; as regras e horários da ESP32 podem continuar a executar localmente.";
        renderFloorPlan();
        renderStatistics();
        renderDiagnostics();
        renderLive3D();
        return;
    }

    if (connectionMode === "esp32" && state.connected === true) {
        live3DLastUpdate = new Date();
        lastSystemError = "";
        lastAlertSnapshot = { ...(lastAlertSnapshot || {}), communicationFailure: false };
        lastContactTime = new Date();
        try {
            localStorage.setItem("domus-last-contact", lastContactTime.toISOString());
        } catch (error) {
            console.warn("Não foi possível guardar a última comunicação.", error);
        }
        recordSensorSample(state);
        monitorStateAlerts(state);
    } else if (connectionMode === "demo") {
        live3DLastUpdate = new Date();
        recordSensorSample(state);
    }

    const temperature = numberText(state.temperatureC);
    const humidity = numberText(state.humidityPercent, 0);
    $("homeTemperature").textContent = temperature;
    $("homeHumidity").textContent =
        `Exterior: ${numberText(state.temperatureOutC)} °C · Humidade: ${humidity}%`;

    $("luminosityStatus").textContent =
        typeof state.luminosityLux === "number"
            ? `${Math.round(state.luminosityLux)} lx`
            : "--";
    const seasonNames = { summer: "Verão", winter: "Inverno", off: "Desligada" };
    const season = state.season || houseSettings.season || "off";
    $("seasonStatus").textContent = season === "off"
        ? "Gestão térmica sazonal desligada."
        : `Gestão térmica: ${seasonNames[season]} · temperatura-alvo ${numberText(
            Number.isFinite(state.targetTemp) ? state.targetTemp : houseSettings.targetTemp)} °C` +
          (state.thermalPaused ? " · em pausa após ordem manual" : "");
    $("rainStatus").textContent = state.rainDetected === true
        ? "Detetada"
        : state.rainDetected === false
            ? "Não detetada"
            : "--";
    $("motionSummary").textContent = state.motionDetected === true
        ? "Detetado"
        : state.motionDetected === false
            ? "Sem movimento"
            : "--";

    const windows = Array.isArray(state.windows) ? state.windows : [];
    const openWindows = windows.filter((value) => value === "open").length;
    const closedWindows = windows.filter((value) => value === "closed").length;
    const unknownWindows = windows.length - openWindows - closedWindows;
    $("windowsSummary").textContent =
        `Janela: ${windowStateText(windows[0])} · Estore: ${windowStateText(windows[1])}`;
    void openWindows; void closedWindows; void unknownWindows;
    $("window1Status").textContent = windowStateText(windows[0]);
    $("window2Status").textContent = windowStateText(windows[1]);

    const lights = Array.isArray(state.lights) ? state.lights : [];
    const lightsOn = lights.filter((value) => value === true).length;
    const lightsOff = lights.filter((value) => value === false).length;
    $("lightsSummary").textContent = `${lightsOn} ${lightsOn === 1 ? "ligada" : "ligadas"} · ${lightsOff} ${lightsOff === 1 ? "desligada" : "desligadas"}`;
    const activeAutomaticDevices = state.autoDevices && typeof state.autoDevices === "object"
        ? state.autoDevices
        : houseSettings.autoDevices;
    if (state.autoDevices && typeof state.autoDevices === "object") {
        const changed = ["light1", "fan"].some((device) =>
            houseSettings.autoDevices[device] !== (state.autoDevices[device] === true));
        houseSettings.autoDevices = {
            ...houseSettings.autoDevices,
            light1: state.autoDevices.light1 === true,
            fan: state.autoDevices.fan === true
        };
        if (changed) {
            try {
                localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
            } catch (error) {
                console.warn("Não foi possível guardar os modos automáticos recebidos.", error);
            }
        }
        document.querySelectorAll("[data-auto-device]").forEach((button) => {
            const enabled = activeAutomaticDevices[button.dataset.autoDevice] === true;
            button.setAttribute("aria-pressed", String(enabled));
            button.classList.toggle("selected", enabled);
        });
    }

    LIGHT_IDS.forEach((device, index) => {
        $(`${device}Status`).textContent = `${lights[index] === true ? "Ligada" : "Desligada"}${
            index === 0 && activeAutomaticDevices.light1 ? " · Automático" : ""}`;
    });

    $("fanSummary").textContent = state.fanOn === true ? "Ligada" : "Desligada";
    $("fanControlStatus").textContent = `${$("fanSummary").textContent}${
        activeAutomaticDevices.fan ? " · Automático" : ""}`;
    $("faucetSummary").textContent = state.faucetOn === true ? "Ligada" : "Desligada";
    $("faucetControlStatus").textContent = $("faucetSummary").textContent;
    $("faucetTimer").textContent = timerText(state.faucetRemainingSeconds);
    $("faucetCountdown").textContent = state.faucetOn === true
        ? timerText(state.faucetRemainingSeconds)
        : "A torneira está fechada.";

    document.querySelectorAll("[data-toggle-device]").forEach((button) => {
        const deviceName = button.dataset.toggleDevice;
        const isOn = isLight(deviceName)
            ? lights[lightIndex(deviceName)] === true
            : deviceName === "fan"
                    ? state.fanOn === true
                    : state.faucetOn === true;
        button.setAttribute("aria-pressed", String(isOn));
    });

    $("systemLastContact").textContent = connectionMode === "esp32" && lastContactTime
        ? lastContactTime.toLocaleTimeString("pt-PT")
        : "--";
    $("systemRtcStatus").textContent = state.rtcAvailable
        ? (state.schedulesEnabled ? "RTC com hora válida" : "RTC sem hora válida")
        : "RTC não detetado";
    $("summaryDisclaimer").textContent = connectionMode === "demo"
        ? "Modo de demonstração — leituras ilustrativas, não provenientes de sensores reais."
        : "Leituras reais da ESP32: temperatura interior e exterior (DHT22) e luminosidade em lux (BH1750).";

    const activeMode = state.activeMode || "auto";
    document.querySelectorAll(".mode-button").forEach((button) => {
        const selected = button.dataset.mode === activeMode;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
    });

    $("scheduleClockStatus").textContent = state.schedulesEnabled
        ? "RTC pronto · horários ativos"
        : "RTC sem hora válida";
    $("automationNotice").textContent = connectionMode === "demo"
        ? "Modo demonstração: nenhuma regra ou ordem é enviada à ESP32."
        : "Regras e horários são guardados na ESP32. A execução local continua sem Wi-Fi.";
    renderFloorPlan();
    renderStatistics();
    renderDiagnostics();
    renderModePreview();
    renderLive3D();
}

function windowStateText(state) {
    if (state === "open") return "Aberta";
    if (state === "closed") return "Fechada";
    if (state === "unknown") return "Sem confirmação";
    return "Sem leitura";
}

function live3DDeviceName(device) {
    if (houseSettings.devices[device]) return houseSettings.devices[device];
    return LIVE3D_DEVICE_NAMES[device] || device;
}

function live3DDeviceStatus(device, state = currentState) {
    if (!state) return "Sem comunicação · estado indisponível";
    if (device === "window1" || device === "window2") {
        const index = Number(device.slice(-1)) - 1;
        const position = Array.isArray(state.windows) ? state.windows[index] : null;
        if (connectionMode === "demo") {
            if (position === "open") return "Aberta · simulação";
            if (position === "closed") return "Fechada · simulação";
            return "Desconhecida · simulação";
        }
        if (position === "open") return "Aberta · última ordem: abrir";
        if (position === "closed") return "Fechada · confirmada pelo sensor magnético";
        if (position === "unknown") return "Sem confirmação · o sensor magnético não indica fecho";
        return "Desconhecida · sem leitura do sensor";
    }
    if (device === "blind1" || device === "blind2") {
        return "Desconhecido · sem sensor nem integração na API";
    }
    let isOn;
    if (isLight(device)) {
        isOn = Array.isArray(state.lights) ? state.lights[lightIndex(device)] : null;
    } else if (device === "fan") {
        isOn = state.fanOn;
    } else if (device === "faucet") {
        isOn = state.faucetOn;
    }
    if (typeof isOn !== "boolean") return "Sem leitura do estado";
    const stateText = isOn ? "Ligada" : "Desligada";
    if (connectionMode === "demo") return `${stateText} · simulação`;
    if (device === "faucet") {
        return `${stateText} · estado comandado; sem sensor de fluxo`;
    }
    return `${stateText} · saída lógica; carga física não confirmada`;
}

function live3DSensorText(sensor, state = currentState) {
    if (!state) return "Sem comunicação";
    if (sensor === "temperatureC") {
        return `${numberText(state.temperatureC)} °C · DHT22 interior`;
    }
    if (sensor === "humidityPercent") {
        return `${numberText(state.humidityPercent, 0)}% · DHT22 interior`;
    }
    if (sensor === "luminosityLux") {
        return typeof state.luminosityLux === "number"
            ? `${Math.round(state.luminosityLux)} lx · BH1750`
            : "Sem leitura";
    }
    if (sensor === "temperatureOutC") {
        return `${numberText(state.temperatureOutC)} °C · DHT22 exterior`;
    }
    if (sensor === "rainDetected") {
        return state.rainDetected === true
            ? "Chuva detetada"
            : state.rainDetected === false ? "Sem chuva detetada" : "Sem leitura";
    }
    if (sensor === "motionDetected") {
        return state.motionDetected === true
            ? "Movimento detetado"
            : state.motionDetected === false ? "Sem movimento" : "Sem leitura";
    }
    if (sensor === "window1" || sensor === "window2") {
        return live3DDeviceStatus(sensor, state);
    }
    return "Sem leitura";
}

function live3DSelectionName() {
    if (live3DSelection.type === "room") {
        return LIVE3D_ROOMS[live3DSelection.id].name;
    }
    return live3DDeviceName(live3DSelection.id);
}

function renderLive3D() {
    const state = currentState;
    const isConnected = connectionMode === "esp32" && state && state.connected === true;
    const isDemo = connectionMode === "demo";
    const status = isDemo ? "Demonstração" : isConnected ? "Ligada" : "Sem comunicação";
    const connection = $("live3dConnection");
    connection.textContent = status;
    connection.classList.toggle("connected", Boolean(isConnected));
    connection.classList.toggle("offline", !isConnected && !isDemo);
    connection.classList.toggle("demo", isDemo);

    const alert = $("live3dAlert");
    alert.hidden = false;
    if (isDemo) {
        alert.textContent = "Modo demonstração: estes valores são ilustrativos e não representam leituras da ESP32.";
    } else if (!isConnected) {
        alert.textContent = "Sem comunicação com a ESP32. Os estados reais estão indisponíveis e os controlos ficam suspensos.";
    } else {
        alert.hidden = true;
        alert.textContent = "";
    }
    $("live3dDataSource").textContent = isDemo
        ? "Demonstração · dados simulados"
        : isConnected ? "Estado recebido da API da ESP32" : "Sem dados reais disponíveis";
    $("live3dLastUpdate").textContent = live3DLastUpdate
        ? `${live3DLastUpdate.toLocaleTimeString("pt-PT")}${isDemo ? " · simulação" : ""}`
        : "Ainda sem atualização";

    document.querySelectorAll("[data-live-room]").forEach((room) => {
        const selected = live3DSelection.type === "room" &&
            live3DSelection.id === room.dataset.liveRoom;
        room.classList.toggle("selected", selected);
        room.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-live-item]").forEach((item) => {
        const device = item.dataset.liveItem;
        const selected = live3DSelection.type === "device" &&
            live3DSelection.id === device;
        const deviceStatus = live3DDeviceStatus(device, state);
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
        item.setAttribute("aria-label", `${live3DDeviceName(device)}: ${deviceStatus}`);
        if (device === "window1" || device === "window2") {
            const index = Number(device.slice(-1)) - 1;
            const position = state && Array.isArray(state.windows) ? state.windows[index] : null;
            item.classList.toggle("is-open", position === "open");
            item.classList.toggle("is-closed", position === "closed");
        } else if (isLight(device)) {
            const isOn = state && Array.isArray(state.lights) ? state.lights[lightIndex(device)] : null;
            item.classList.toggle("is-on", isOn === true);
        } else if (device === "fan") {
            item.classList.toggle("is-on", Boolean(state && state.fanOn === true));
        } else if (device === "faucet") {
            item.classList.toggle("is-on", Boolean(state && state.faucetOn === true));
        }
    });

    const title = $("live3dDetailTitle");
    const itemStatus = $("live3dItemStatus");
    title.textContent = live3DSelectionName();
    itemStatus.textContent = live3DSelection.type === "device"
        ? live3DDeviceStatus(live3DSelection.id, state)
        : isDemo ? "Vista ilustrativa · não ligada à ESP32"
            : isConnected ? "Divisão selecionada · estado atualizado"
                : "Estado indisponível enquanto a ESP32 está desligada";
    itemStatus.classList.toggle("unknown", !isConnected && !isDemo);

    const roomId = live3DSelection.type === "room"
        ? live3DSelection.id
        : Object.keys(LIVE3D_ROOMS).find((key) =>
            LIVE3D_ROOMS[key].devices.includes(live3DSelection.id));
    const room = LIVE3D_ROOMS[roomId];
    const commandCandidates = live3DSelection.type === "device"
        ? [live3DLastCommands[live3DSelection.id]]
        : room ? room.devices.map((device) => live3DLastCommands[device]) : [];
    const lastCommand = commandCandidates
        .filter(Boolean)
        .sort((left, right) => right.timestamp - left.timestamp)[0];
    $("live3dLastCommand").textContent = lastCommand
        ? `${isDemo ? "Última ação de demonstração" : "Último comando enviado"}: ${lastCommand.action} · ${lastCommand.time}. Não confirma o estado físico.`
        : "Último comando: nenhum nesta sessão.";

    const sensors = $("live3dSensors");
    sensors.replaceChildren();
    if (!room || room.sensors.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = live3DSelection.type === "device" &&
            (live3DSelection.id === "blind1" || live3DSelection.id === "blind2")
            ? "Sem sensor/API de posição para este estore."
            : "Sem sensores exclusivos associados a esta divisão.";
        sensors.append(empty);
    } else {
        room.sensors.forEach((sensor) => {
            const entry = document.createElement("li");
            const name = document.createElement("span");
            const value = document.createElement("strong");
            name.textContent = sensor === "temperatureC" ? "Temperatura interior"
                : sensor === "temperatureOutC" ? "Temperatura exterior"
                : sensor === "humidityPercent" ? "Humidade"
                    : sensor === "luminosityLux" ? "Luminosidade"
                        : sensor === "rainDetected" ? "Chuva"
                            : sensor === "motionDetected" ? "Movimento"
                                : live3DDeviceName(sensor);
            value.textContent = live3DSensorText(sensor, state);
            entry.append(name, value);
            sensors.append(entry);
        });
    }

    const controls = $("live3dControls");
    controls.replaceChildren();
    const devices = live3DSelection.type === "device"
        ? [live3DSelection.id]
        : room ? room.devices : [];
    devices.forEach((device) => {
        const row = document.createElement("div");
        row.className = "live3d-control-row";
        const description = document.createElement("div");
        const name = document.createElement("strong");
        const statusText = document.createElement("span");
        name.textContent = live3DDeviceName(device);
        statusText.textContent = live3DDeviceStatus(device, state);
        description.append(name, statusText);
        row.append(description);

        const actions = document.createElement("div");
        actions.className = "live3d-control-actions";
        const commandEnabled = isDemo || Boolean(isConnected);
        const addAction = (label, action, value) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "secondary-button";
            button.textContent = label;
            button.dataset.live3dDevice = device;
            button.dataset.live3dAction = action;
            if (value !== undefined) button.dataset.live3dValue = String(value);
            button.disabled = !commandEnabled;
            actions.append(button);
        };
        if (device === "window1" || device === "window2") {
            addAction("Abrir", "set", true);
            addAction("Fechar", "set", false);
        } else if (isLight(device) || device === "fan") {
            let isOn = false;
            if (state) {
                if (device === "fan") isOn = state.fanOn === true;
                else isOn = Array.isArray(state.lights) && state.lights[lightIndex(device)] === true;
            }
            addAction(isOn ? "Desligar" : "Ligar", "set", !isOn);
        } else if (device === "faucet") {
            const isOn = Boolean(state && state.faucetOn === true);
            addAction(isOn ? "Fechar" : "Abrir", "set", !isOn);
        }
        if (actions.childElementCount) row.append(actions);
        controls.append(row);
    });
    if (devices.length === 0) {
        const empty = document.createElement("p");
        empty.className = "live3d-empty-controls";
        empty.textContent = live3DSelection.type === "device"
            ? "Este elemento não tem controlos disponíveis na API atual."
            : "Esta divisão não tem equipamentos controláveis associados.";
        controls.append(empty);
    }
}

function selectLive3DItem(type, id) {
    if (type === "room" && !LIVE3D_ROOMS[id]) return;
    live3DSelection = { type, id };
    renderLive3D();
}

function updateLive3DTransform() {
    $("live3dStage").style.transform =
        `perspective(1100px) rotateX(${live3DRotation.x}deg) ` +
        `rotateY(${live3DRotation.y}deg) rotateZ(${live3DRotation.z}deg) ` +
        `scale(${live3DScale})`;
}

function changeLive3DZoom(amount) {
    live3DScale = Math.min(1.65, Math.max(0.7, live3DScale + amount));
    updateLive3DTransform();
}

function addNotification({ title, message, severity = "info", key }) {
    if (key && notifications.some((item) => item.key === key)) return;
    const notification = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        device: severity === "error" ? "Ligação à ESP32" : "Sistema",
        action: title,
        source: "alerta",
        result: message,
        severity,
        key,
        read: false
    };
    notifications.unshift(notification);
    notifications = notifications.slice(0, 50);
    try {
        localStorage.setItem("domus-notifications", JSON.stringify(notifications));
    } catch (error) {
        console.warn("Não foi possível guardar o alerta.", error);
    }
    renderNotifications();
}

function monitorStateAlerts(state) {
    const rain = state.rainDetected === true;
    const previousSnapshot = lastAlertSnapshot || {};
    if (rain && !previousSnapshot.rain) {
        addNotification({
            title: "Chuva detetada",
            message: "O sensor reportou chuva. A ESP32 aplica a prioridade de segurança às ordens de abertura.",
            severity: "warning"
        });
    }
    const temperatureHigh = typeof state.temperatureC === "number" &&
        state.temperatureC >= houseSettings.fanOnTemp;
    if (temperatureHigh && !previousSnapshot.temperatureHigh) {
        addNotification({
            title: "Temperatura elevada",
            message: `Leitura de ${numberText(state.temperatureC)} °C, igual ou superior ao limite configurado de ${houseSettings.fanOnTemp} °C.`,
            severity: "warning"
        });
    }
    lastAlertSnapshot = { ...previousSnapshot, rain, temperatureHigh };
}

function recordSensorSample(state, force = false) {
    if (connectionMode !== "esp32" && connectionMode !== "demo") return;
    const timestamp = Date.now();
    const minInterval = force ? 5000 : 60000;
    if (timestamp - lastSampleAt < minInterval) return;
    lastSampleAt = timestamp;
    sensorSamples.push({
        timestamp,
        source: connectionMode,
        temperatureC: Number.isFinite(state.temperatureC) ? state.temperatureC : null,
        luminosityLux: Number.isFinite(state.luminosityLux) ? state.luminosityLux : null,
        temperatureOutC: Number.isFinite(state.temperatureOutC) ? state.temperatureOutC : null,
        humidityPercent: Number.isFinite(state.humidityPercent) ? state.humidityPercent : null
    });
    sensorSamples = sensorSamples.slice(-4000);
    try {
        localStorage.setItem("domus-sensor-samples", JSON.stringify(sensorSamples));
    } catch (error) {
        console.warn("Não foi possível guardar as amostras dos sensores.", error);
    }
    renderStatistics();
}

const FLOOR_ROOMS = {
    living: {
        name: () => "Sala e hall",
        devices: ["window1", "light1", "light6", "fan"],
        sensors: ["temperature", "humidity", "luminosity", "motion"]
    },
    bedroom: {
        name: () => "Quartos e casa de banho",
        devices: ["window2", "light3", "light4", "light5"],
        sensors: []
    },
    kitchen: {
        name: () => "Cozinha",
        devices: ["light2", "faucet"],
        sensors: []
    },
    outside: {
        name: () => "Exterior",
        devices: [],
        sensors: ["temperatureOut", "rain", "luminosity"]
    }
};

function deviceStateText(device) {
    if (!currentState) {
        return connectionMode === "demo" ? "Sem dados de demonstração" : "Sem resposta da API";
    }
    if (device === "window1" || device === "window2") {
        const index = Number(device.slice(-1)) - 1;
        const value = currentState.windows && currentState.windows[index];
        return value === "unknown" ? "Posição desconhecida (contacto)" : windowStateText(value);
    }
    if (isLight(device)) {
        const value = currentState.lights && currentState.lights[lightIndex(device)];
        return typeof value === "boolean"
            ? value ? "Ligada (saída)" : "Desligada (saída)"
            : "Estado desconhecido (API)";
    }
    if (device === "fan") return typeof currentState.fanOn === "boolean"
        ? currentState.fanOn ? "Ligada (saída)" : "Desligada (saída)"
        : "Estado desconhecido (API)";
    if (device === "faucet") {
        if (typeof currentState.faucetOn !== "boolean") return "Estado desconhecido (API)";
        return currentState.faucetOn
            ? `Ligada · ${timerText(currentState.faucetRemainingSeconds)}`
            : "Desligada (MOSFET)";
    }
    return "Estado não disponível";
}

function sensorStateText(sensor) {
    if (!currentState) return connectionMode === "demo" ? "Sem leitura de demonstração" : "Sem resposta da API";
    switch (sensor) {
        case "temperature":
            return Number.isFinite(currentState.temperatureC)
                ? `${numberText(currentState.temperatureC)} °C`
                : "Sem leitura";
        case "humidity":
            return Number.isFinite(currentState.humidityPercent)
                ? `${numberText(currentState.humidityPercent, 0)}%`
                : "Sem leitura";
        case "luminosity":
            return Number.isFinite(currentState.luminosityLux)
                ? `${Math.round(currentState.luminosityLux)} lx`
                : "Sem leitura";
        case "temperatureOut":
            return Number.isFinite(currentState.temperatureOutC)
                ? `${numberText(currentState.temperatureOutC)} °C`
                : "Sem leitura";
        case "motion":
            return typeof currentState.motionDetected === "boolean"
                ? currentState.motionDetected ? "Movimento detetado" : "Sem movimento"
                : "Sem leitura";
        case "rain":
            return typeof currentState.rainDetected === "boolean"
                ? currentState.rainDetected ? "Chuva detetada" : "Sem chuva detetada"
                : "Sem leitura";
        default:
            return "Sem leitura";
    }
}

function roomActionButtons(device) {
    if (device.startsWith("window")) {
        return [["open", "Abrir"], ["stop", "Parar"], ["close", "Fechar"]];
    }
    if (device === "faucet") return [["on", "Abrir"], ["off", "Fechar"]];
    return [["toggle", "Alternar"]];
}

function renderFloorPlan() {
    const selectedElement = document.querySelector(".floor-room[data-room].selected");
    const selected = selectedElement && selectedElement.dataset && selectedElement.dataset.room
        ? selectedElement.dataset.room
        : "living";
    $("floorRoomLivingName").textContent = "Sala e hall";
    $("floorRoomLivingDevices").textContent = FLOOR_ROOMS.living.devices
        .map((device) => houseSettings.devices[device])
        .join(" · ");
    $("floorRoomBedroomDevices").textContent = FLOOR_ROOMS.bedroom.devices
        .map((device) => houseSettings.devices[device])
        .join(" · ");
    $("floorRoomKitchenDevices").textContent = FLOOR_ROOMS.kitchen.devices
        .map((device) => houseSettings.devices[device])
        .join(" · ");
    $("floorRoomOutsideDevices").textContent = "Temperatura exterior · chuva · luz";
    $("floorPlanConnection").textContent = connectionMode === "demo"
        ? "Demonstração"
        : currentState && currentState.connected === true ? "Estado recebido da ESP32" : "Sem comunicação";
    $("floorSelectedRoom").textContent = FLOOR_ROOMS[selected].name();
    document.querySelectorAll(".floor-room[data-room]").forEach((room) => {
        const active = room.dataset.room === selected;
        room.classList.toggle("selected", active);
        room.setAttribute("aria-pressed", String(active));
    });

    const list = $("floorDeviceList");
    list.replaceChildren();
    FLOOR_ROOMS[selected].devices.forEach((device) => {
        const item = document.createElement("li");
        item.className = "floor-device-item";
        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = houseSettings.devices[device];
        const status = document.createElement("span");
        status.textContent = deviceStateText(device);
        details.append(name, status);
        item.append(details);
        roomActionButtons(device).forEach(([action, label]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "device-action";
            button.textContent = label;
            button.dataset.floorDevice = device;
            button.dataset.floorAction = action;
            item.append(button);
        });
        list.append(item);
    });
    FLOOR_ROOMS[selected].sensors.forEach((sensor) => {
        const labels = {
            temperature: "Temperatura interior",
            temperatureOut: "Temperatura exterior",
            humidity: "Humidade",
            luminosity: "Luminosidade",
            motion: "Movimento",
            rain: "Chuva"
        };
        const item = document.createElement("li");
        item.className = "floor-device-item floor-sensor-item";
        const name = document.createElement("strong");
        name.textContent = labels[sensor];
        const status = document.createElement("span");
        status.textContent = sensorStateText(sensor);
        item.append(name, status);
        list.append(item);
    });
    if (!list.children.length) {
        const empty = document.createElement("li");
        empty.className = "statistics-empty";
        empty.textContent = "Esta divisão ainda não tem equipamentos associados.";
        list.append(empty);
    }
}

function handleFloorPlanAction(device, action) {
    if (action === "stop") return stopMovements(device);
    if (action === "toggle") {
        const isOn = device === "fan"
            ? currentState && currentState.fanOn === true
            : currentState && currentState.lights && currentState.lights[lightIndex(device)] === true;
        return controlDevice(device, !isOn);
    }
    return controlDevice(device, action === "open" || action === "on");
}

function selectedStatisticsRange() {
    const end = Date.now();
    const period = $("statisticsPeriod").value;
    const days = period === "day" ? 1 : period === "month" ? 30 : 7;
    const start = new Date();
    if (period === "day") start.setHours(0, 0, 0, 0);
    else start.setTime(end - days * 24 * 60 * 60 * 1000);
    return { start: start.getTime(), end };
}

function samplesForPeriod() {
    const { start, end } = selectedStatisticsRange();
    return sensorSamples.filter((sample) =>
        sample.timestamp >= start && sample.timestamp <= end);
}

function renderLineChart(svg, points, color, unit) {
    const ns = "http://www.w3.org/2000/svg";
    svg.replaceChildren();
    if (!points.length) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", "320");
        text.setAttribute("y", "115");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "chart-empty");
        text.textContent = "Sem dados registados";
        svg.append(text);
        return;
    }
    const min = Math.min(...points.map((point) => point.value));
    const max = Math.max(...points.map((point) => point.value));
    const range = max - min || 1;
    const coordinates = points.map((point, index) => ({
        x: points.length === 1 ? 320 : 42 + (index / (points.length - 1)) * 576,
        y: 190 - ((point.value - min) / range) * 145,
        value: point.value
    }));
    const baseline = document.createElementNS(ns, "path");
    baseline.setAttribute("d", "M42 190H618");
    baseline.setAttribute("class", "chart-axis");
    svg.append(baseline);
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", coordinates.map((point) => `${point.x},${point.y}`).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    coordinates.forEach((point, index) => {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(point.x));
        circle.setAttribute("cy", String(point.y));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", color);
        const title = document.createElementNS(ns, "title");
        title.textContent = `${new Date(points[index].timestamp).toLocaleString("pt-PT")}: ${point.value}${unit}`;
        circle.append(title);
        svg.append(circle);
    });
    const minText = document.createElementNS(ns, "text");
    minText.setAttribute("x", "8");
    minText.setAttribute("y", "194");
    minText.setAttribute("class", "chart-label");
    minText.textContent = `${numberText(min)}${unit}`;
    const maxText = document.createElementNS(ns, "text");
    maxText.setAttribute("x", "8");
    maxText.setAttribute("y", "52");
    maxText.setAttribute("class", "chart-label");
    maxText.textContent = `${numberText(max)}${unit}`;
    svg.append(minText, maxText);
}

function historyDeviceMatches(entry, device) {
    return entry.device === device || entry.device === houseSettings.devices[device];
}

function calculateFanRuntime(entries, now) {
    const events = entries
        .filter((entry) => historyDeviceMatches(entry, "fan") &&
            ["ligar", "desligar"].includes(String(entry.action).toLowerCase()))
        .sort((a, b) => a.timestamp - b.timestamp);
    let activeSince = null;
    let elapsed = 0;
    events.forEach((entry) => {
        if (String(entry.action).toLowerCase() === "ligar") activeSince = entry.timestamp;
        else if (activeSince !== null) {
            elapsed += Math.max(0, entry.timestamp - activeSince);
            activeSince = null;
        }
    });
    if (activeSince !== null && currentState && currentState.fanOn === true) {
        elapsed += Math.max(0, now - activeSince);
    }
    return elapsed;
}

function renderStatistics() {
    if (!$("statisticsPeriod")) return;
    const { start, end } = selectedStatisticsRange();
    const samples = samplesForPeriod();
    const activity = historyEntries.filter((entry) =>
        Number(entry.timestamp) >= start && Number(entry.timestamp) <= end);
    const tempPoints = samples.filter((sample) => Number.isFinite(sample.temperatureC))
        .map((sample) => ({ timestamp: sample.timestamp, value: sample.temperatureC }));
    const lightPoints = samples.filter((sample) => Number.isFinite(sample.luminosityLux))
        .map((sample) => ({ timestamp: sample.timestamp, value: Math.round(sample.luminosityLux) }));
    renderLineChart($("temperatureChart"), tempPoints, "#d07a35", " °C");
    renderLineChart($("lightChart"), lightPoints, "#557b60", " lx");
    const countActivations = activity.filter((entry) =>
        /ligar/i.test(entry.action) &&
        LIGHT_IDS.some((device) => historyDeviceMatches(entry, device))).length;
    const fanRuntimeMs = calculateFanRuntime(activity, end);
    const automaticFaucetClosures = activity.filter((entry) =>
        historyDeviceMatches(entry, "faucet") &&
        /autom[aá]tic/i.test(entry.action)).length;
    const scheduleRuns = activity.filter((entry) =>
        String(entry.source).toLowerCase().includes("horário") ||
        String(entry.source).toLowerCase().includes("schedule")).length;
    $("statLightActivations").textContent = String(countActivations);
    $("statFanRuntime").textContent = activity.some((entry) => historyDeviceMatches(entry, "fan"))
        ? `${Math.floor(fanRuntimeMs / 60000)} min`
        : "Sem registos";
    $("statFaucetClosures").textContent = String(automaticFaucetClosures);
    $("statScheduleRuns").textContent = String(scheduleRuns);
    $("statisticsDataSource").textContent = samples.length
        ? [...new Set(samples.map((sample) => sample.source === "esp32" ? "ESP32" : "demonstração"))].join(" · ")
        : "Sem amostras";
    $("statisticsEmpty").hidden = samples.length > 0;
}

function renderDiagnostics() {
    if (!$("diagnosticSensorList")) return;
    const connected = connectionMode === "esp32" && currentState && currentState.connected === true;
    $("diagnosticsConnectionStatus").textContent = lastConnectionTest ||
        (connectionMode === "demo"
        ? "Demonstração — sem ligação física"
        : connected ? "API ligada" : "API sem resposta");
    $("diagnosticsLastContact").textContent = connectionMode === "esp32" && lastContactTime
        ? lastContactTime.toLocaleString("pt-PT")
        : "Ainda sem comunicação real";
    $("diagnosticsError").textContent = lastSystemError || "Sem erros registados.";
    $("temperatureCalibrationStatus").textContent =
        `Correção atual: ${numberText(houseSettings.temperatureOffsetC !== undefined && houseSettings.temperatureOffsetC !== null ? houseSettings.temperatureOffsetC : 0)} °C`;
    const sensorDescriptions = [
        ["Temperatura exterior (DHT22)", currentState && Number.isFinite(currentState.temperatureOutC)
            ? `${numberText(currentState.temperatureOutC)} °C`
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"],
        ["Temperatura interior (DHT22)", currentState && Number.isFinite(currentState.temperatureC)
            ? `${numberText(currentState.temperatureC)} °C`
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"],
        ["Humidade (DHT22)", currentState && Number.isFinite(currentState.humidityPercent)
            ? `${numberText(currentState.humidityPercent, 0)}%`
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"],
        ["Luminosidade (BH1750)", currentState && Number.isFinite(currentState.luminosityLux)
            ? `${Math.round(currentState.luminosityLux)} lx`
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"],
        ["Chuva", currentState && typeof currentState.rainDetected === "boolean"
            ? currentState.rainDetected ? "Chuva detetada" : "Sem chuva detetada"
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"],
        ["Movimento (PIR)", currentState && typeof currentState.motionDetected === "boolean"
            ? currentState.motionDetected ? "Movimento detetado" : "Sem movimento"
            : currentState ? "Sem leitura do sensor" : connectionMode === "demo" ? "Dados simulados" : "Sem resposta da API"]
    ];
    const renderRows = (target, rows) => {
        target.replaceChildren();
        rows.forEach(([name, status]) => {
            const item = document.createElement("li");
            const label = document.createElement("strong");
            label.textContent = name;
            const value = document.createElement("span");
            value.textContent = status;
            item.append(label, value);
            target.append(item);
        });
    };
    renderRows($("diagnosticSensorList"), sensorDescriptions);
    const deviceDescriptions = ["window1", "window2", ...LIGHT_IDS, "fan", "faucet"]
        .map((device) => {
            const status = currentState
                ? deviceStateText(device)
                : connectionMode === "demo" ? "Não testado; modo demonstração"
                    : "Sem resposta da API";
            return [houseSettings.devices[device], status];
        });
    deviceDescriptions.push(["RTC / horários", currentState
        ? currentState.rtcAvailable
            ? currentState.schedulesEnabled ? "RTC com hora válida" : "RTC sem hora válida"
            : "RTC não detetado"
        : connectionMode === "demo" ? "Não testado; modo demonstração" : "Sem resposta da API"]);
    renderRows($("diagnosticDeviceList"), deviceDescriptions);
}

function modeActionDescription(device, action) {
    if (!action || action === "keep") return null;
    const name = houseSettings.devices[device] || device;
    if (action === "open") return `Abrir ${name}`;
    if (action === "closed") return `Fechar ${name}`;
    if (action === "on") return device === "faucet" ? `Ligar ${name} durante 60 s` : `Ligar ${name}`;
    return `Desligar ${name}`;
}

function renderModePreview(mode) {
    if (arguments.length) selectedModePreview = mode;
    const previewMode = selectedModePreview || (currentState && currentState.activeMode ? currentState.activeMode : "auto");
    const actions = Object.entries(modeProfiles[previewMode] || {})
        .map(([device, action]) => modeActionDescription(device, action))
        .filter(Boolean);
    automations.filter((rule) => rule.enabled && automationModeCompatible(rule, previewMode) &&
        (Array.isArray(rule.modes)
            ? rule.modes.includes(previewMode)
            : previewMode === "auto"))
        .forEach((rule) => actions.push(`Regra: ${rule.name} (${AUTOMATION_CONDITIONS[rule.condition]})`));
    $("modePreviewTitle").textContent = `Pré-visualização: ${MODE_NAMES[previewMode]}`;
    $("modePreviewActions").textContent = actions.length
        ? actions.join(" · ")
        : "Nenhuma ação será executada; os equipamentos mantêm o estado atual.";
    document.querySelectorAll(".mode-button").forEach((button) => {
        button.classList.toggle("preview-selected", button.dataset.mode === previewMode);
    });
}

function renderHouseSettings() {
    $("settingHouseName").value = houseSettings.homeName;
    $("settingRoomName").value = houseSettings.roomName;
    $("settingWindow1Name").value = houseSettings.devices.window1;
    $("settingWindow2Name").value = houseSettings.devices.window2;
    LIGHT_IDS.forEach((device, index) => {
        $(`settingLight${index + 1}Name`).value = houseSettings.devices[device];
    });
    $("settingSeason").value = houseSettings.season || "off";
    $("settingTargetTemp").value = Number.isFinite(houseSettings.targetTemp) ? houseSettings.targetTemp : 25;
    $("settingFanName").value = houseSettings.devices.fan;
    $("settingFaucetName").value = houseSettings.devices.faucet;
    $("settingFanOnTemp").value = houseSettings.fanOnTemp;
    $("settingFanOffTemp").value = houseSettings.fanOffTemp;
    $("settingTemperatureOffset").value = houseSettings.temperatureOffsetC !== undefined && houseSettings.temperatureOffsetC !== null ? houseSettings.temperatureOffsetC : 0;
    $("settingDarkThreshold").value = houseSettings.darkThreshold;
    $("settingNoMotionSeconds").value = houseSettings.noMotionSeconds;
    $("settingFaucetSeconds").value = houseSettings.faucetSeconds;
    $("dashboardHouseName").textContent = houseSettings.homeName;
    $("footerHouseName").textContent = houseSettings.homeName;
    $("roomHeading").textContent = houseSettings.roomName;
    $("window1Name").textContent = houseSettings.devices.window1;
    $("window2Name").textContent = houseSettings.devices.window2;
    LIGHT_IDS.forEach((device) => {
        $(`${device}Name`).textContent = houseSettings.devices[device];
    });
    $("fanName").textContent = houseSettings.devices.fan;
    $("faucetName").textContent = houseSettings.devices.faucet;
    $("faucetDuration").value = houseSettings.faucetSeconds;
    $("settingTelegramCommands").checked = houseSettings.telegramCommands !== false;
    $("settingEnergyPrice").value = Number.isFinite(houseSettings.energyPrice) ? houseSettings.energyPrice : 0.16;
    document.querySelectorAll("[data-auto-device]").forEach((button) => {
        const enabled = houseSettings.autoDevices[button.dataset.autoDevice] === true;
        button.setAttribute("aria-pressed", String(enabled));
        button.classList.toggle("selected", enabled);
    });
    document.querySelectorAll("#automationDevice option, #scheduleDevice option").forEach((option) => {
        const device = option.value;
        if (houseSettings.devices[device]) option.textContent = houseSettings.devices[device];
    });
}

async function saveHouseSettings() {
    const previousSettings = JSON.parse(JSON.stringify(houseSettings));
    const textSettings = {
        homeName: $("settingHouseName").value.trim(),
        roomName: $("settingRoomName").value.trim(),
        devices: {
            window1: $("settingWindow1Name").value.trim(),
            window2: $("settingWindow2Name").value.trim(),
            light1: $("settingLight1Name").value.trim(),
            light2: $("settingLight2Name").value.trim(),
            light3: $("settingLight3Name").value.trim(),
            light4: $("settingLight4Name").value.trim(),
            light5: $("settingLight5Name").value.trim(),
            light6: $("settingLight6Name").value.trim(),
            fan: $("settingFanName").value.trim(),
            faucet: $("settingFaucetName").value.trim()
        },
        fanOnTemp: Number($("settingFanOnTemp").value),
        fanOffTemp: Number($("settingFanOffTemp").value),
        temperatureOffsetC: Number($("settingTemperatureOffset").value),
        darkThreshold: Number($("settingDarkThreshold").value),
        noMotionSeconds: Number($("settingNoMotionSeconds").value),
        faucetSeconds: Number($("settingFaucetSeconds").value),
        season: $("settingSeason").value,
        targetTemp: Number($("settingTargetTemp").value),
        autoDevices: { ...houseSettings.autoDevices },
        weather: {
            city: $("settingWeatherCity").value.trim() || DEFAULT_SETTINGS.weather.city,
            lat: Number($("settingWeatherCoords").dataset.lat),
            lon: Number($("settingWeatherCoords").dataset.lon)
        },
        telegramToken: $("settingTelegramToken").value.trim(),
        telegramChatId: $("settingTelegramChat").value.trim(),
        noticeLevel: $("settingNoticeLevel").value === "important" ? "important" : "all",
        telegramCommands: $("settingTelegramCommands").checked,
        energyPrice: Number($("settingEnergyPrice").value),
        care: typeof readCareForm === "function" ? readCareForm() : houseSettings.care
    };
    if (Object.values(textSettings.devices).some((value) => !value) ||
        !textSettings.homeName || !textSettings.roomName ||
        !Number.isFinite(textSettings.fanOnTemp) ||
        !Number.isFinite(textSettings.fanOffTemp) ||
        textSettings.fanOffTemp >= textSettings.fanOnTemp ||
        !Number.isFinite(textSettings.temperatureOffsetC) ||
        textSettings.temperatureOffsetC < -10 || textSettings.temperatureOffsetC > 10 ||
        !Number.isInteger(textSettings.darkThreshold) ||
        textSettings.darkThreshold < 0 || textSettings.darkThreshold > 65535 ||
        !["off", "summer", "winter"].includes(textSettings.season) ||
        !Number.isFinite(textSettings.targetTemp) ||
        textSettings.targetTemp < 15 || textSettings.targetTemp > 35 ||
        !Number.isInteger(textSettings.noMotionSeconds) ||
        textSettings.noMotionSeconds < 1 || textSettings.noMotionSeconds > 86400 ||
        !Number.isInteger(textSettings.faucetSeconds) ||
        textSettings.faucetSeconds < 1 || textSettings.faucetSeconds > 60) {
        showToast("Revê os nomes e limites. A temperatura de desligar deve ser inferior à de ligar.");
        return false;
    }
    if (textSettings.weather.city.length > 40 ||
        !Number.isFinite(textSettings.weather.lat) || Math.abs(textSettings.weather.lat) > 90 ||
        !Number.isFinite(textSettings.weather.lon) || Math.abs(textSettings.weather.lon) > 180) {
        showToast("Revê a cidade da previsão do tempo (carrega em Procurar cidade).");
        return false;
    }
    if ((textSettings.telegramToken && !/^\d{5,15}:[A-Za-z0-9_-]{20,60}$/.test(textSettings.telegramToken)) ||
        (textSettings.telegramChatId && !/^-?\d{1,19}$/.test(textSettings.telegramChatId))) {
        showToast("Revê o código do bot e a conversa do Telegram (carrega em Ligar ao meu Telegram).");
        return false;
    }
    if (typeof careFormProblem === "function") {
        const problem = careFormProblem(textSettings.care);
        if (problem) {
            showToast(problem);
            return false;
        }
    }
    if (!Number.isFinite(textSettings.energyPrice) || textSettings.energyPrice < 0.01 || textSettings.energyPrice > 1) {
        showToast("O preço da eletricidade tem de estar entre 0,01 e 1 €/kWh.");
        return false;
    }

    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/settings", {
                method: "PUT",
                body: JSON.stringify({ settings: textSettings })
            });
            houseSettings = config.settings || textSettings;
        } else {
            houseSettings = textSettings;
            demoState.season = textSettings.season;
            demoState.targetTemp = Number(textSettings.targetTemp);
        }
    } catch (error) {
        houseSettings = previousSettings;
        renderHouseSettings();
        showToast(error.message);
        return false;
    }
    try {
        localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
    } catch (error) {
        console.warn("Não foi possível guardar as definições.", error);
        if (connectionMode === "demo") {
            houseSettings = previousSettings;
            renderHouseSettings();
            showToast("Não foi possível guardar as definições neste navegador; as alterações foram revertidas.");
        } else {
            showToast("Definições guardadas na ESP32, mas não neste navegador.");
        }
        return false;
    }
    renderHouseSettings();
    if (connectionMode === "demo") renderState(demoState);
    showToast(connectionMode === "esp32"
        ? "Definições guardadas na ESP32."
        : "Definições guardadas neste navegador.");
    return true;
}

function appendHistory({ device, action, source, result, timestamp = Date.now() }) {
    const entry = {
        id: `${timestamp}-${Math.random().toString(36).slice(2)}`,
        timestamp,
        device,
        action,
        source,
        result
    };
    historyEntries.unshift(entry);
    historyEntries = historyEntries.slice(0, 100);
    notifications.unshift({ ...entry, read: false });
    notifications = notifications.slice(0, 50);
    try {
        localStorage.setItem("domus-history", JSON.stringify(historyEntries));
        localStorage.setItem("domus-notifications", JSON.stringify(notifications));
    } catch (error) {
        console.warn("Não foi possível guardar o histórico local.", error);
    }
    renderHistory();
    renderNotifications();
    renderStatistics();
    renderFloorPlan();
}

function renderHistoryEntry(entry) {
    const item = document.createElement("li");
    item.className = "history-item";
    const title = document.createElement("strong");
    title.textContent = `${entry.device} — ${entry.action}`;
    const metadata = document.createElement("small");
    const date = new Date(entry.timestamp);
    metadata.textContent = `${date.toLocaleString("pt-PT")} · ${entry.source} · ${entry.result}`;
    const details = document.createElement("button");
    details.type = "button";
    details.className = "history-details-button";
    details.textContent = "Detalhes";
    details.setAttribute("aria-expanded", "false");
    details.addEventListener("click", () => {
        const expanded = details.getAttribute("aria-expanded") === "true";
        details.setAttribute("aria-expanded", String(!expanded));
        details.textContent = expanded ? "Detalhes" : "Ocultar detalhes";
        metadata.hidden = expanded;
    });
    metadata.hidden = true;
    item.append(title, details, metadata);
    return item;
}

function filteredHistoryEntries() {
    const deviceFilter = $("historyDeviceFilter").value;
    const actionFilter = $("historyActionFilter").value.toLowerCase();
    const from = $("historyFrom").value ? new Date(`${$("historyFrom").value}T00:00:00`).getTime() : 0;
    const to = $("historyTo").value ? new Date(`${$("historyTo").value}T23:59:59`).getTime() : Infinity;
    return historyEntries.filter((entry) => {
        const time = Number(entry.timestamp) || 0;
        const action = String(entry.action || "").toLowerCase();
        return (!deviceFilter || entry.device === deviceFilter) &&
            (!actionFilter || action.includes(actionFilter)) &&
            time >= from && time <= to;
    });
}

function renderHistory() {
    const list = $("historyList");
    list.replaceChildren();
    const filtered = filteredHistoryEntries();
    const selector = $("historyDeviceFilter");
    const selectedDevice = selector.value;
    const deviceNames = [...new Set(historyEntries.map((entry) => entry.device).filter(Boolean))];
    selector.replaceChildren(new Option("Todos", ""));
    deviceNames.forEach((device) => selector.add(new Option(device, device)));
    if (deviceNames.includes(selectedDevice)) selector.value = selectedDevice;
    const latestByDevice = new Map();
    historyEntries.forEach((entry) => {
        if (!latestByDevice.has(entry.device)) latestByDevice.set(entry.device, entry);
    });
    [["light1LastAction", houseSettings.devices.light1],
        ["fanLastAction", houseSettings.devices.fan]].forEach(([id, device]) => {
        const latest = latestByDevice.get(device);
        $(id).textContent = latest
            ? `Última ação: ${latest.action} · ${new Date(latest.timestamp).toLocaleTimeString("pt-PT")}`
            : "Sem ações registadas";
    });

    if (!filtered.length) {
        const empty = document.createElement("li");
        empty.className = "history-empty";
        empty.textContent = historyEntries.length
            ? "Não há registos para estes filtros."
            : connectionMode === "esp32"
                ? "Ainda não há eventos disponíveis no histórico da ESP32."
                : "Ainda não há atividade registada.";
        list.append(empty);
        return;
    }
    filtered.forEach((entry) => list.append(renderHistoryEntry(entry)));
}

function renderNotifications() {
    const list = $("notificationList");
    list.replaceChildren();
    const unread = notifications.filter((notification) => !notification.read).length;
    $("notificationCount").textContent = String(unread);
    $("notificationCount").hidden = unread === 0;
    $("sidebarAlertCount").textContent = String(unread);
    $("sidebarAlertCount").hidden = unread === 0;
    if (!notifications.length) {
        const empty = document.createElement("li");
        empty.className = "history-empty";
        empty.textContent = "Não há notificações.";
        list.append(empty);
        renderHomeOverview();
        return;
    }
    notifications.forEach((notification) => {
        const item = renderHistoryEntry(notification);
        item.classList.toggle("unread", !notification.read);
        item.classList.add(`severity-${notification.severity || "info"}`);
        list.append(item);
    });
    renderHomeOverview();
}

function renderHomeOverview() {
    const scheduleList = $("homeUpcomingSchedules");
    const alertList = $("homeRecentAlerts");
    if (!scheduleList || !alertList) return;
    scheduleList.replaceChildren();
    alertList.replaceChildren();

    const upcoming = schedules
        .filter((schedule) => schedule.enabled)
        .map((schedule) => ({ schedule, nextRun: nextScheduleDate(schedule) }))
        .filter((item) => item.nextRun)
        .sort((a, b) => a.nextRun - b.nextRun)
        .slice(0, 3);
    if (!upcoming.length) {
        const empty = document.createElement("li");
        empty.className = "home-preview-empty";
        empty.textContent = "Não há horários ativos.";
        scheduleList.append(empty);
    } else {
        upcoming.forEach(({ schedule, nextRun }) => {
            const item = document.createElement("li");
            const title = document.createElement("strong");
            title.textContent = schedule.name || MODE_NAMES[schedule.mode] || "Tarefa programada";
            const detail = document.createElement("span");
            detail.textContent = nextRun.toLocaleString("pt-PT", {
                weekday: "short", day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit"
            });
            item.append(title, detail);
            scheduleList.append(item);
        });
    }

    const recent = notifications.slice(0, 3);
    if (!recent.length) {
        const empty = document.createElement("li");
        empty.className = "home-preview-empty";
        empty.textContent = "Não há alertas recentes.";
        alertList.append(empty);
    } else {
        recent.forEach((notification) => {
            const item = document.createElement("li");
            item.className = `home-alert-preview severity-${notification.severity || "info"}`;
            const title = document.createElement("strong");
            title.textContent = notification.action || notification.device || "Alerta";
            const detail = document.createElement("span");
            detail.textContent = notification.result || "";
            item.append(title, detail);
            alertList.append(item);
        });
    }
}

function mergeRemoteHistory(entries) {
    if (!Array.isArray(entries)) return;
    const known = new Set(historyEntries.map((entry) => String(entry.id)));
    const newEntries = entries
        .filter((entry) => entry && entry.id !== undefined && !known.has(String(entry.id)))
        .map((entry) => ({
            ...entry,
            timestamp: Number(entry.timestamp) < 1000000000000
                ? Number(entry.timestamp) * 1000
                : Number(entry.timestamp)
        }));
    if (!newEntries.length) return;
    historyEntries = [...newEntries, ...historyEntries].slice(0, 100);
    notifications = [
        ...newEntries.map((entry) => ({ ...entry, read: false })),
        ...notifications
    ].slice(0, 50);
    try {
        localStorage.setItem("domus-history", JSON.stringify(historyEntries));
        localStorage.setItem("domus-notifications", JSON.stringify(notifications));
    } catch (error) {
        console.warn("Não foi possível guardar o histórico recebido da ESP32.", error);
    }
    renderHistory();
    renderNotifications();
}

async function refreshRemoteHistory(force = false) {
    if (connectionMode !== "esp32" ||
        (!force && Date.now() - lastHistoryRefresh < 15000)) return;
    lastHistoryRefresh = Date.now();
    try {
        const result = await apiRequest("/api/history");
        if (!Array.isArray(result.history)) {
            throw new Error("A API não devolveu um histórico válido.");
        }
        mergeRemoteHistory(result.history);
    } catch (error) {
        if (force) throw error;
        console.warn("Não foi possível atualizar o histórico da ESP32.", error);
    }
}

function openNotifications() {
    navigateToPage("alerts");
}

function closeNotifications() {
    navigateToPage("home");
}

function renderModeConfig() {
    const grid = $("modeConfigGrid");
    grid.replaceChildren();

    Object.entries(MODE_NAMES).forEach(([mode, label]) => {
        const card = document.createElement("article");
        card.className = "mode-profile";

        const heading = document.createElement("h3");
        heading.textContent = label;
        card.append(heading);

        Object.entries(MODE_DEVICE_NAMES).forEach(([device]) => {
            const field = document.createElement("label");
            field.className = "mode-action-field";
            field.append(document.createTextNode(houseSettings.devices[device] || device));

            const select = document.createElement("select");
            select.dataset.modeProfile = mode;
            select.dataset.deviceAction = device;
            MODE_ACTION_OPTIONS[device].forEach(([value, optionLabel]) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = optionLabel;
                select.append(option);
            });
            const profileValue = modeProfiles[mode] && modeProfiles[mode][device] ? modeProfiles[mode][device] : undefined;
            select.value = profileValue || "keep";
            field.append(select);
            card.append(field);
        });

        grid.append(card);
    });
}

function renderScheduleList() {
    const list = $("scheduleList");
    list.replaceChildren();

    schedules.forEach((schedule) => {
        const item = document.createElement("li");
        item.className = "schedule-item";
        const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
            .filter((_, index) => schedule.daysMask & (1 << index))
            .join(", ");
        const details = document.createElement("div");
        details.className = "schedule-details";
        const name = document.createElement("strong");
        name.textContent = schedule.name || MODE_NAMES[schedule.mode] || "Horário";
        const description = document.createElement("span");
        description.textContent = schedule.mode
            ? `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} · ${weekdays} · Modo ${MODE_NAMES[schedule.mode]}`
            : `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} · ${weekdays} · ${scheduleDescription(schedule)}`;
        const nextRun = document.createElement("small");
        nextRun.textContent = `Próxima execução: ${nextScheduleExecution(schedule)}`;
        details.append(name, description, nextRun);
        item.append(details);

        const enabledLabel = document.createElement("label");
        enabledLabel.className = "schedule-enabled";
        const enabled = document.createElement("input");
        enabled.type = "checkbox";
        enabled.checked = schedule.enabled;
        enabled.setAttribute("aria-label", `Ativar horário ${name.textContent}`);
        enabled.addEventListener("change", () => {
            const previousSchedules = JSON.parse(JSON.stringify(schedules));
            schedule.enabled = enabled.checked;
            persistSchedules(previousSchedules);
        });
        enabledLabel.append(enabled, document.createTextNode("Ativo"));
        item.append(enabledLabel);

        const actions = document.createElement("div");
        actions.className = "schedule-item-actions";
        const runNow = document.createElement("button");
        runNow.type = "button";
        runNow.className = "secondary-button";
        runNow.textContent = "Executar agora";
        runNow.addEventListener("click", () => withBusyButton(runNow, "A executar…", async () => {
            const target = schedule.mode ? "mode" : schedule.device;
            const action = schedule.mode || schedule.action;
            await executeConfiguredAction(target, action);
        }));
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary-button";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => editSchedule(schedule));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button";
        remove.textContent = "Eliminar";
        remove.addEventListener("click", () => {
            const previousSchedules = JSON.parse(JSON.stringify(schedules));
            schedules = schedules.filter((itemSchedule) => itemSchedule.id !== schedule.id);
            if (editingScheduleId === schedule.id) resetScheduleForm();
            persistSchedules(previousSchedules);
        });
        actions.append(runNow, edit, remove);
        item.append(actions);
        list.append(item);
    });
    renderScheduleCalendar();
    renderHomeOverview();
}

function scheduleDeviceName(device) {
    if (device === "both_windows") return "Janela e estore";
    if (device === "both_lights") return "Todas as luzes";
    if (device === "mode") return "Modo da casa";
    return houseSettings.devices[device] || device;
}

function scheduleDescription(schedule) {
    if (schedule.device === "mode") {
        return `Modo ${MODE_NAMES[schedule.action] || schedule.action}`;
    }
    const action = ["open", "closed"].includes(schedule.action)
        ? schedule.action === "open" ? "Abrir" : "Fechar"
        : schedule.action === "on" ? "Ligar" : "Desligar";
    return `${action} ${scheduleDeviceName(schedule.device)}`;
}

function nextScheduleDate(schedule) {
    const now = new Date();
    for (let offset = 0; offset < 8; offset += 1) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + offset);
        const mondayBasedDay = (candidate.getDay() + 6) % 7;
        if (!(schedule.daysMask & (1 << mondayBasedDay))) continue;
        candidate.setHours(schedule.hour, schedule.minute, 0, 0);
        if (candidate <= now) continue;
        return candidate;
    }
    return null;
}

function nextScheduleExecution(schedule) {
    const candidate = nextScheduleDate(schedule);
    if (candidate) {
        return candidate.toLocaleString("pt-PT", {
            weekday: "short", day: "2-digit", month: "2-digit",
            hour: "2-digit", minute: "2-digit"
        });
    }
    return "a aguardar relógio";
}

function renderScheduleCalendar() {
    const calendar = $("scheduleCalendar");
    if (!calendar) return;
    calendar.replaceChildren();
    const now = new Date();
    const schedulesByDay = Array.from({ length: 7 }, (_, offset) => {
        const day = new Date(now);
        day.setDate(now.getDate() + offset);
        const weekday = (day.getDay() + 6) % 7;
        const items = schedules.filter((schedule) => {
            if (!schedule.enabled || !(schedule.daysMask & (1 << weekday))) return false;
            if (offset > 0) return true;
            const execution = new Date(day);
            execution.setHours(schedule.hour, schedule.minute, 0, 0);
            return execution > now;
        });
        return { day, items };
    });

    schedulesByDay.forEach(({ day, items }) => {
        const card = document.createElement("article");
        card.className = "schedule-calendar-day";
        const heading = document.createElement("h4");
        heading.textContent = day.toLocaleDateString("pt-PT", { weekday: "short" });
        const date = document.createElement("span");
        date.className = "schedule-calendar-date";
        date.textContent = day.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
        const list = document.createElement("ul");
        if (!items.length) {
            const empty = document.createElement("li");
            empty.className = "schedule-calendar-empty";
            empty.textContent = "—";
            list.append(empty);
        } else {
            items.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
            items.forEach((schedule) => {
                const item = document.createElement("li");
                const time = document.createElement("strong");
                time.textContent = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
                const name = document.createElement("span");
                name.textContent = schedule.name || MODE_NAMES[schedule.mode] || scheduleDescription(schedule);
                item.append(time, name);
                list.append(item);
            });
        }
        card.append(heading, date, list);
        calendar.append(card);
    });
}

function updateScheduleActions(preferredAction) {
    const device = $("scheduleDevice").value;
    const action = $("scheduleAction");
    const values = device === "mode"
        ? [["auto", "Automático"], ["eco", "ECO"], ["night", "Noite"], ["away", "Ausente"]]
        : ["both_windows", "window1", "window2"].includes(device)
            ? [["closed", "Fechar"], ["open", "Abrir"]]
            : [["off", "Desligar"], ["on", "Ligar"]];
    const selected = preferredAction || action.value;
    action.replaceChildren();
    values.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        action.append(option);
    });
    action.value = values.some(([value]) => value === selected) ? selected : values[0][0];
}

function resetScheduleForm() {
    editingScheduleId = null;
    $("scheduleForm").reset();
    $("scheduleRepeat").checked = true;
    $("scheduleEnabled").checked = true;
    updateScheduleActions();
    $("saveSchedule").textContent = "Guardar horário";
    $("cancelScheduleEdit").hidden = true;
}

function editSchedule(schedule) {
    editingScheduleId = schedule.id;
    $("scheduleName").value = schedule.name || "";
    $("scheduleDevice").value = schedule.mode ? "mode" : schedule.device;
    updateScheduleActions(schedule.mode || schedule.action);
    $("scheduleTime").value =
        `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
    document.querySelectorAll('input[name="scheduleDay"]').forEach((input) => {
        input.checked = Boolean(schedule.daysMask & (1 << Number(input.value)));
    });
    $("scheduleRepeat").checked = schedule.repeat !== false;
    $("scheduleEnabled").checked = schedule.enabled;
    $("saveSchedule").textContent = "Guardar alterações";
    $("cancelScheduleEdit").hidden = false;
    $("scheduleForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

function automationTargetType(device) {
    if (device === "both_windows" || device.startsWith("window")) return "windows";
    if (device === "both_lights" || device.startsWith("light")) return "lights";
    return "switch";
}

function automationActionOptions(device) {
    return AUTOMATION_ACTIONS[automationTargetType(device)];
}

function automationDeviceName(device) {
    if (device === "both_windows") return "Janela e estore";
    if (device === "both_lights") return "Todas as luzes";
    return houseSettings.devices[device] || device;
}

function isValidAutomation(rule) {
    if (!rule) return false;
    const validId = (typeof rule.id === "string" &&
        rule.id.length > 0) ||
        (Number.isInteger(rule.id) && rule.id >= 0 && rule.id <= 0xffffffff);
    const validDevice = ["window1", "window2", "both_windows", ...LIGHT_IDS,
        "both_lights", "fan", "faucet"].includes(rule.device);
    if (!validId ||
        typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 60 ||
        !AUTOMATION_CONDITIONS[rule.condition] ||
        !validDevice ||
        !automationActionOptions(rule.device).some(([value]) => value === rule.action) ||
        typeof rule.enabled !== "boolean" ||
        (rule.modes !== undefined &&
            (!Array.isArray(rule.modes) || !rule.modes.length || rule.modes.length > 4 ||
             rule.modes.some((mode) => !Object.hasOwn(MODE_NAMES, mode))))) {
        return false;
    }

    if (["temperature_above", "temperature_below"].includes(rule.condition) &&
        (!Number.isFinite(rule.threshold) || rule.threshold < -40 || rule.threshold > 85)) {
        return false;
    }
    if (rule.condition === "dark_motion" &&
        (!Number.isInteger(rule.threshold) || rule.threshold < 0 || rule.threshold > 65535)) {
        return false;
    }
    if (["no_motion", "faucet_open_for"].includes(rule.condition) &&
        (!Number.isInteger(rule.durationSeconds) || rule.durationSeconds < 1 ||
            rule.durationSeconds > (rule.condition === "faucet_open_for" ? 60 : 86400))) {
        return false;
    }
    if (rule.condition === "scheduled_time" &&
        (!/^\d{2}:\d{2}$/.test(rule.time) ||
            Number(rule.time.slice(0, 2)) > 23 ||
            Number(rule.time.slice(3, 5)) > 59 ||
            !Array.isArray(rule.days) ||
            !rule.days.length || rule.days.length > 7 ||
            rule.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
        return false;
    }
    return true;
}

function appendAutomationField(container, labelText, input) {
    const label = document.createElement("label");
    label.append(document.createTextNode(labelText));
    label.append(input);
    container.append(label);
}

function renderAutomationParameters(values = {}) {
    const container = $("automationParameters");
    const condition = $("automationCondition").value;
    container.replaceChildren();

    if (condition === "temperature_above" || condition === "temperature_below" ||
        condition === "dark_motion") {
        const input = document.createElement("input");
        input.id = "automationThreshold";
        input.type = "number";
        input.required = true;
        input.step = condition === "dark_motion" ? "1" : "0.5";
        input.min = condition === "dark_motion" ? "0" : "-40";
        input.max = condition === "dark_motion" ? "65535" : "85";
        input.value = values.threshold !== undefined && values.threshold !== null
            ? values.threshold
            : (condition === "temperature_below" ? 25 : condition === "dark_motion" ? 50 : 27);
        appendAutomationField(
            container,
            condition === "dark_motion"
                ? "Limite de luminosidade (lx)"
                : "Temperatura limite (°C)",
            input
        );
        if (condition === "dark_motion") {
            const note = document.createElement("p");
            note.className = "automation-field-note";
            note.textContent = "A regra considera escuro quando a luminosidade (BH1750) é igual ou inferior ao limite, em lux.";
            container.append(note);
        }
        return;
    }

    if (condition === "no_motion" || condition === "faucet_open_for") {
        const input = document.createElement("input");
        input.id = "automationDuration";
        input.type = "number";
        input.required = true;
        input.min = "1";
        input.max = condition === "faucet_open_for" ? "60" : "86400";
        input.step = "1";
        input.value = values.durationSeconds !== undefined && values.durationSeconds !== null
            ? values.durationSeconds
            : (condition === "faucet_open_for" ? 30 : 300);
        appendAutomationField(container, "Tempo (segundos)", input);
        const note = document.createElement("p");
        note.className = "automation-field-note";
        note.textContent = condition === "faucet_open_for"
            ? "A ESP32 mede o tempo e mantém também o limite de segurança da torneira."
            : "A ESP32 mede o tempo sem movimento e reinicia a contagem quando deteta movimento.";
        container.append(note);
        return;
    }

    if (condition === "scheduled_time") {
        const timeLabel = document.createElement("label");
        timeLabel.append(document.createTextNode("Hora"));
        const timeInput = document.createElement("input");
        timeInput.id = "automationTime";
        timeInput.type = "time";
        timeInput.required = true;
        timeInput.value = values.time || "08:00";
        timeLabel.append(timeInput);
        container.append(timeLabel);

        const fieldset = document.createElement("fieldset");
        fieldset.className = "automation-days";
        const legend = document.createElement("legend");
        legend.textContent = "Dias";
        fieldset.append(legend);
        const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
        names.forEach((name, day) => {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "automationDay";
            checkbox.value = String(day);
            checkbox.checked = (values.days || [1, 2, 3, 4, 5]).includes(day);
            label.append(checkbox, document.createTextNode(name));
            fieldset.append(label);
        });
        container.append(fieldset);
    }
}

function updateAutomationActionOptions(preferredAction) {
    const actionSelect = $("automationAction");
    const options = automationActionOptions($("automationDevice").value);
    const currentAction = preferredAction || actionSelect.value;
    actionSelect.replaceChildren();
    options.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        actionSelect.append(option);
    });
    actionSelect.value = options.some(([value]) => value === currentAction)
        ? currentAction
        : options[0][0];
}

function renderAutomationForm(automation = null) {
    editingAutomationId = automation && automation.id !== undefined && automation.id !== null ? automation.id : null;
    $("automationName").value = automation && automation.name ? automation.name : "";
    $("automationCondition").value = automation && automation.condition ? automation.condition : "rain";
    $("automationDevice").value = automation && automation.device
        ? automation.device
        : AUTOMATION_DEFAULTS[$("automationCondition").value].device;
    renderAutomationParameters(automation || {});
    updateAutomationActionOptions((automation && automation.action) || AUTOMATION_DEFAULTS[$("automationCondition").value].action);
    const activeModes = automation && automation.modes ? automation.modes : ["auto"];
    document.querySelectorAll('input[name="automationMode"]').forEach((input) => {
        input.checked = activeModes.includes(input.value);
    });
    $("saveAutomation").textContent = automation
        ? "Guardar alterações"
        : "Guardar automatização";
    $("cancelAutomationEdit").hidden = !automation;
}

function automationDescription(rule) {
    let condition = AUTOMATION_CONDITIONS[rule.condition];
    if (rule.condition === "temperature_above" || rule.condition === "temperature_below") {
        condition += ` (${numberText(rule.threshold)} °C)`;
    } else if (rule.condition === "dark_motion") {
        condition += ` (luminosidade ≤ ${rule.threshold} lx)`;
    } else if (rule.condition === "no_motion" || rule.condition === "faucet_open_for") {
        condition += ` (${rule.durationSeconds} s)`;
    } else if (rule.condition === "scheduled_time") {
        const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
            .filter((_, index) => rule.days.includes(index))
            .join(", ");
        condition += ` (${rule.time}, ${days})`;
    }
    const actionOption = automationActionOptions(rule.device)
        .find(([value]) => value === rule.action);
    const action = actionOption && actionOption[1] ? actionOption[1] : rule.action;
    const modes = (rule.modes || ["auto"]).map((mode) => MODE_NAMES[mode]).join(", ");
    return `${condition} → ${action} ${automationDeviceName(rule.device)} · ${modes}`;
}

function renderAutomationList() {
    const list = $("automationList");
    list.replaceChildren();
    $("automationCount").textContent =
        `${automations.length} ${automations.length === 1 ? "regra" : "regras"}`;

    if (automations.length === 0) {
        const empty = document.createElement("li");
        empty.className = "automation-empty";
        empty.textContent = "Ainda não há regras. Cria a primeira no formulário acima.";
        list.append(empty);
        renderModePreview();
        return;
    }

    automations.forEach((rule) => {
        const item = document.createElement("li");
        item.className = "automation-card";

        const details = document.createElement("div");
        details.className = "automation-details";
        const heading = document.createElement("strong");
        heading.textContent = rule.name;
        const description = document.createElement("span");
        description.textContent = automationDescription(rule);
        const lastRun = document.createElement("small");
        if (rule.lastRun) {
            const date = new Date(rule.lastRun);
            lastRun.textContent = `Última execução: ${date.toLocaleString("pt-PT")} · ${rule.lastResult || "concluída"}`;
        } else {
            lastRun.textContent = "Ainda não executada";
        }
        details.append(heading, description, lastRun);
        item.append(details);

        const enabledLabel = document.createElement("label");
        enabledLabel.className = "automation-enabled";
        const enabled = document.createElement("input");
        enabled.type = "checkbox";
        enabled.checked = rule.enabled;
        enabled.setAttribute("aria-label", `Ativar regra ${rule.name}`);
        enabled.addEventListener("change", () => {
            const previousAutomations = JSON.parse(JSON.stringify(automations));
            rule.enabled = enabled.checked;
            void persistAutomations(previousAutomations);
            renderAutomationList();
        });
        enabledLabel.append(enabled, document.createTextNode("Ativa"));
        item.append(enabledLabel);

        const actions = document.createElement("div");
        actions.className = "automation-card-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary-button";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => {
            renderAutomationForm(rule);
            $("automationName").focus();
            $("automationForm").scrollIntoView({ behavior: "smooth", block: "center" });
        });
        const test = document.createElement("button");
        test.type = "button";
        test.className = "secondary-button";
        test.textContent = "Testar simulação";
        test.addEventListener("click", () => testAutomation(rule));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button";
        remove.textContent = "Eliminar";
        remove.addEventListener("click", () => {
            const previousAutomations = JSON.parse(JSON.stringify(automations));
            automations = automations.filter((candidate) => candidate.id !== rule.id);
            if (editingAutomationId === rule.id) renderAutomationForm();
            void persistAutomations(previousAutomations);
            renderAutomationList();
        });
        actions.append(test, edit, remove);
        item.append(actions);
        list.append(item);
    });
    renderModePreview();
}

function automationConditionPreview(rule, state) {
    if (!state) return "Sem leituras disponíveis para avaliar a condição.";
    switch (rule.condition) {
        case "rain":
            return state.rainDetected === true ? "Condição satisfeita: chuva detetada."
                : state.rainDetected === false ? "Condição não satisfeita: sem chuva detetada."
                    : "Leitura de chuva indisponível.";
        case "dark_motion":
            if (typeof state.luminosityLux !== "number" || typeof state.motionDetected !== "boolean") {
                return "Leituras de luminosidade ou movimento indisponíveis.";
            }
            return state.luminosityLux <= rule.threshold && state.motionDetected
                ? "Condição satisfeita: escuro e movimento detetado."
                : "Condição não satisfeita com as leituras atuais.";
        case "temperature_above":
        case "temperature_below":
            if (typeof state.temperatureC !== "number") return "Leitura de temperatura indisponível.";
            return (rule.condition === "temperature_above"
                ? state.temperatureC > rule.threshold
                : state.temperatureC < rule.threshold)
                ? `Condição satisfeita: ${numberText(state.temperatureC)} °C.`
                : `Condição não satisfeita: ${numberText(state.temperatureC)} °C.`;
        case "no_motion":
            return state.motionDetected === false
                ? "Sem movimento neste instante; a duração completa só pode ser confirmada pela ESP32."
                : state.motionDetected === true
                    ? "Condição não satisfeita: movimento detetado."
                    : "Leitura de movimento indisponível.";
        case "faucet_open_for":
            return state.faucetOn
                ? "Torneira ligada; a duração contínua é controlada pela ESP32."
                : "Condição não satisfeita: torneira desligada.";
        case "scheduled_time":
            return "A regra de horário é avaliada pela ESP32 quando a hora e o dia configurados ocorrerem.";
        default:
            return "Condição sem avaliação disponível.";
    }
}

function testAutomation(rule) {
    const preview = automationConditionPreview(rule, currentState);
    const wouldRun = preview.startsWith("Condição satisfeita:");
    const result = `${preview} ${wouldRun
        ? `A simulação prevê: ${rule.action} ${automationDeviceName(rule.device)}.`
        : "Nenhum equipamento foi acionado."}`;
    appendHistory({
        device: automationDeviceName(rule.device),
        action: `Testar automatização: ${rule.name}`,
        source: "simulação",
        result
    });
    showToast(result);
}

async function persistAutomations(previousAutomations = automations) {
    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/automations", {
                method: "PUT",
                body: JSON.stringify({ automations })
            });
            automations = Array.isArray(config.automations) ? config.automations : automations;
        } else {
            localStorage.setItem("domus-automations", JSON.stringify(automations));
        }
        renderAutomationList();
        showToast(connectionMode === "esp32"
            ? "Regra guardada na ESP32."
            : "Regra guardada neste navegador; não funciona offline.");
    } catch (error) {
        automations = previousAutomations;
        renderAutomationList();
        showToast(error.message);
    }
}

function readAutomationForm() {
    const condition = $("automationCondition").value;
    const rule = {
        id: editingAutomationId !== undefined && editingAutomationId !== null ? editingAutomationId : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: $("automationName").value.trim(),
        condition,
        device: $("automationDevice").value,
        action: $("automationAction").value,
        modes: Array.from(document.querySelectorAll('input[name="automationMode"]:checked'))
            .map((input) => input.value),
        enabled: true
    };
    const existing = automations.find((candidate) => candidate.id === editingAutomationId);
    if (existing) {
        rule.enabled = existing.enabled;
        rule.lastRun = existing.lastRun;
        rule.lastResult = existing.lastResult;
        rule.lastExecutionKey = existing.lastExecutionKey;
    }

    if (condition === "temperature_above" || condition === "temperature_below" ||
        condition === "dark_motion") {
        rule.threshold = Number($("automationThreshold").value);
    } else if (condition === "no_motion" || condition === "faucet_open_for") {
        rule.durationSeconds = Number($("automationDuration").value);
    } else if (condition === "scheduled_time") {
        rule.time = $("automationTime").value;
        rule.days = Array.from(document.querySelectorAll('input[name="automationDay"]:checked'))
            .map((input) => Number(input.value));
    }
    return rule;
}

async function saveAutomation(event) {
    event.preventDefault();
    const rule = readAutomationForm();
    if (!rule.name) {
        showToast("Dá um nome à regra.");
        $("automationName").focus();
        return;
    }
    if (!isValidAutomation(rule)) {
        showToast("Verifica os limites, a hora e os dias escolhidos.");
        return;
    }
    if (rule.modes.includes("eco") &&
        ![...LIGHT_IDS, "both_lights", "fan"].includes(rule.device)) {
        showToast("No modo ECO, escolhe regras de iluminação ou ventilação.");
        return;
    }
    if (rule.modes.some((mode) => !automationModeCompatible(rule, mode))) {
        showToast("A ação não é compatível com um dos modos selecionados; Noite/Ausente não podem abrir janelas ou ligar cargas.");
        return;
    }

    const previousAutomations = JSON.parse(JSON.stringify(automations));
    if (editingAutomationId === null) {
        automations.push(rule);
    } else {
        automations = automations.map((candidate) =>
            candidate.id === editingAutomationId ? rule : candidate);
    }
    await persistAutomations(previousAutomations);
    if (automations.some((candidate) => candidate.id === rule.id)) {
        renderAutomationForm();
    }
}

function automationModeCompatible(rule, mode) {
    const isWindow = ["window1", "window2", "both_windows"].includes(rule.device);
    if (mode === "eco") {
        return [...LIGHT_IDS, "both_lights", "fan"].includes(rule.device);
    }
    if (mode === "night" || mode === "away") {
        return isWindow ? rule.action === "closed" : rule.action === "off";
    }
    return mode === "auto";
}

async function apiRequest(path, options = {}) {
    if (!apiBaseUrl || !apiToken) {
        throw new Error("Configura o endereço IP e o token da ESP32.");
    }

    const headers = {
        Authorization: `Bearer ${apiToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
    };
    let response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
        () => controller.abort(),
        API_REQUEST_TIMEOUT_MS
    );
    try {
        response = await fetch(`${apiBaseUrl}${path}`, {
            ...options,
            headers,
            signal: controller.signal
        });
    } catch (error) {
        window.clearTimeout(timeoutId);
        const requestError = controller.signal.aborted
            ? new Error(`Tempo limite ao contactar ${apiBaseUrl}. Verifica a rede e se a ESP32 está disponível.`)
            : error;
        lastSystemError = `Falha de comunicação com ${apiBaseUrl}: ${requestError.message}`;
        renderDiagnostics();
        throw requestError;
    }

    let result;
    try {
        result = await response.json();
    } catch (error) {
        const requestError = controller.signal.aborted
            ? new Error(`Tempo limite ao ler a resposta de ${apiBaseUrl}.`)
            : new Error(`A API respondeu com HTTP ${response.status} sem JSON válido.`);
        lastSystemError = requestError.message;
        renderDiagnostics();
        throw requestError;
    } finally {
        window.clearTimeout(timeoutId);
    }
    if (!response.ok) {
        const error = new Error(result.error || `A API respondeu com HTTP ${response.status}.`);
        lastSystemError = error.message;
        renderDiagnostics();
        throw error;
    }
    lastSystemError = "";
    renderDiagnostics();
    return result;
}

async function refreshRemoteState(showError = false) {
    if (connectionMode !== "esp32") return false;
    try {
        const state = await apiRequest("/api/state");
        if (state.connected !== true) throw new Error("A ESP32 não confirmou a ligação.");
        setConnectionStatus("Ligada", "connected");
        renderState(state);
        await refreshRemoteHistory();
        return true;
    } catch (error) {
        setConnectionStatus("Sem comunicação", "offline");
        renderState(null);
        lastSystemError = error.message;
        if (!(lastAlertSnapshot && lastAlertSnapshot.communicationFailure)) {
            addNotification({
                title: "Falha de comunicação",
                message: error.message,
                severity: "error"
            });
        }
        lastAlertSnapshot = { ...(lastAlertSnapshot || {}), communicationFailure: true };
        renderDiagnostics();
        if (showError) showToast(error.message);
        return false;
    }
}

async function connectToEsp32() {
    const inputUrl = $("esp32Url").value.trim().replace(/\/+$/, "");
    const inputToken = $("esp32Token").value.trim();
    let parsedUrl;
    try {
        parsedUrl = new URL(inputUrl);
    } catch (error) {
        showToast("Indica um endereço válido, por exemplo http://domus.local ou o IP mostrado no Monitor Série.");
        return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username || parsedUrl.password || !inputToken) {
        showToast("Usa um endereço HTTP/HTTPS local e indica o token da API.");
        return;
    }

    apiBaseUrl = parsedUrl.origin;
    apiToken = inputToken;
    connectionMode = "esp32";
    let preferenceWarning = "";
    try {
        localStorage.setItem("domus-api-url", apiBaseUrl);
        localStorage.setItem("domus-api-token", apiToken);
        localStorage.setItem("domus-connection-mode", connectionMode);
    } catch (error) {
        console.warn("Não foi possível guardar a configuração da API.", error);
        preferenceWarning = "A configuração não ficou guardada neste navegador. ";
    }

    try {
        const config = await apiRequest("/api/config");
        if (config.profiles) modeProfiles = config.profiles;
        schedules = Array.isArray(config.schedules) ? config.schedules : [];
        automations = Array.isArray(config.automations) ? config.automations : [];
        if (config.settings) {
            houseSettings = {
                ...DEFAULT_SETTINGS,
                ...config.settings,
                devices: { ...DEFAULT_SETTINGS.devices, ...config.settings.devices },
                autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...config.settings.autoDevices }
            };
            try {
                localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
            } catch (error) {
                console.warn("Não foi possível guardar as definições recebidas da ESP32.", error);
                preferenceWarning = "As definições não ficaram guardadas neste navegador. ";
            }
            renderHouseSettings();
        }
        mergeRemoteHistory(config.history);
        renderModeConfig();
        renderScheduleList();
        renderAutomationList();
        const connected = await refreshRemoteState(true);
        if (!connected) return;
        closeSettings();
        if (currentState) showToast(`${preferenceWarning}Ligação à ESP32 estabelecida.`);
    } catch (error) {
        lastSystemError = error.message;
        setConnectionStatus("Sem comunicação", "offline");
        renderState(null);
        renderDiagnostics();
        showToast(`${preferenceWarning}${error.message}`);
    }
}

function useDemoMode() {
    connectionMode = "demo";
    lastSystemError = "";
    lastConnectionTest = "";
    demoState = JSON.parse(JSON.stringify(DEMO_INITIAL_STATE));
    try {
        localStorage.setItem("domus-connection-mode", "demo");
        modeProfiles = JSON.parse(localStorage.getItem("domus-profiles")) || 
            JSON.parse(JSON.stringify(MODE_ACTIONS));
        schedules = JSON.parse(localStorage.getItem("domus-schedules")) || [];
        automations = JSON.parse(localStorage.getItem("domus-automations")) || [];
        historyEntries = JSON.parse(localStorage.getItem("domus-history")) || [];
        notifications = JSON.parse(localStorage.getItem("domus-notifications")) || [];
    } catch (error) {
        console.warn("Não foi possível guardar o modo de demonstração.", error);
    }
    renderModeConfig();
    renderScheduleList();
    renderAutomationList();
    renderHistory();
    renderNotifications();
    setConnectionStatus("Demonstração", "demo");
    renderState(demoState);
    closeSettings();
}

function applyDemoProfile(mode) {
    const profile = modeProfiles[mode];
    if (!profile) return;

    ["window1", "window2"].forEach((device, index) => {
        if (profile[device] === "open") demoState.windows[index] = "open";
        if (profile[device] === "closed") demoState.windows[index] = "closed";
    });
    LIGHT_IDS.forEach((device, index) => {
        if (profile[device] === "on") demoState.lights[index] = true;
        if (profile[device] === "off") demoState.lights[index] = false;
    });
    if (profile.fan === "on") demoState.fanOn = true;
    if (profile.fan === "off") demoState.fanOn = false;
    if (profile.faucet === "on") {
        demoState.faucetOn = true;
        faucetDemoStopsAt = Date.now() + 60000;
    }
    if (profile.faucet === "off") {
        demoState.faucetOn = false;
        faucetDemoStopsAt = 0;
    }
}

async function activateMode(mode) {
    try {
        if (connectionMode === "esp32") {
            const state = await apiRequest("/api/mode", {
                method: "POST",
                body: JSON.stringify({ mode })
            });
            renderState(state);
        } else {
            demoState.activeMode = mode;
            applyDemoProfile(mode);
            renderState(demoState);
        }
        appendHistory({
            device: "Modos da casa",
            action: `Ativar modo ${MODE_NAMES[mode]}`,
            source: "aplicação",
            result: connectionMode === "esp32"
                ? "ordem enviada à ESP32; confirmação por equipamento indisponível"
                : "simulação"
        });
        return true;
    } catch (error) {
        appendHistory({
            device: "Modos da casa",
            action: `Ativar modo ${MODE_NAMES[mode]}`,
            source: "aplicação",
            result: `falha: ${error.message}`
        });
        showToast(error.message);
        await refreshRemoteState(false);
        return false;
    }
}

async function controlDevice(device, value) {
    const isWindow = device.startsWith("window");
    const body = isWindow ? { open: value } : { on: value };
    if (device === "faucet" && value) {
        const duration = Number($("faucetDuration").value);
        body.durationSeconds = Number.isFinite(duration)
            ? Math.min(60, Math.max(1, duration))
            : 60;
    }

    try {
        let responseState;
        if (connectionMode === "esp32") {
            responseState = await apiRequest(`/api/devices/${device}`, {
                method: "POST",
                body: JSON.stringify(body)
            });
            renderState(responseState);
        } else if (isWindow) {
            demoState.windows[Number(device.slice(-1)) - 1] = value ? "open" : "closed";
            renderState(demoState);
        } else if (isLight(device)) {
            demoState.lights[lightIndex(device)] = value;
            renderState(demoState);
        } else if (device === "fan") {
            demoState.fanOn = value;
            renderState(demoState);
        } else {
            demoState.faucetOn = value;
            faucetDemoStopsAt = value
                ? Date.now() + body.durationSeconds * 1000
                : 0;
            renderState(demoState);
        }

        const action = isWindow
            ? value ? "Abrir" : "Fechar"
            : value ? "Ligar" : "Desligar";
        const observedWindowState = isWindow && responseState && Array.isArray(responseState.windows)
            ? responseState.windows[Number(device.slice(-1)) - 1]
            : null;
        const result = connectionMode === "demo"
            ? "simulação"
            : isWindow && observedWindowState === (value ? "open" : "closed")
                ? "posição indicada pelo contacto"
                : isWindow
                    ? "ordem enviada; posição não confirmada"
                    : "saída lógica atualizada; carga física não confirmada";
        live3DLastCommands[device] = {
            action,
            time: new Date().toLocaleTimeString("pt-PT"),
            timestamp: Date.now()
        };
        renderLive3D();
        appendHistory({
            device: houseSettings.devices[device],
            action,
            source: "aplicação",
            result
        });
        return true;
    } catch (error) {
        appendHistory({
            device: houseSettings.devices[device] || device,
            action: (isWindow ? value ? "Abrir" : "Fechar" : value ? "Ligar" : "Desligar"),
            source: "aplicação",
            result: `falha: ${error.message}`
        });
        showToast(error.message);
        await refreshRemoteState(false);
        return false;
    }
}

async function saveModeProfiles() {
    const previousProfiles = modeProfiles;
    const updatedProfiles = JSON.parse(JSON.stringify(modeProfiles));
    document.querySelectorAll("[data-mode-profile][data-device-action]").forEach((select) => {
        updatedProfiles[select.dataset.modeProfile][select.dataset.deviceAction] = select.value;
    });

    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/profiles", {
                method: "PUT",
                body: JSON.stringify({ profiles: updatedProfiles })
            });
            modeProfiles = config.profiles;
        } else {
            modeProfiles = updatedProfiles;
            localStorage.setItem("domus-profiles", JSON.stringify(modeProfiles));
        }
        renderModeConfig();
        showToast(connectionMode === "demo"
            ? "Ações guardadas neste navegador; não serão executadas na placa."
            : "Ações guardadas na ESP32.");
    } catch (error) {
        modeProfiles = previousProfiles;
        renderModeConfig();
        showToast(error.message);
    }
}

async function persistSchedules(previousSchedules = schedules) {
    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/schedules", {
                method: "PUT",
                body: JSON.stringify({ schedules })
            });
            schedules = config.schedules;
        } else {
            localStorage.setItem("domus-schedules", JSON.stringify(schedules));
        }
        renderScheduleList();
        showToast(connectionMode === "demo"
            ? "Horário guardado neste navegador; só a ESP32 o executa sem Wi-Fi."
            : "Horários guardados na ESP32.");
        return true;
    } catch (error) {
        schedules = previousSchedules;
        renderScheduleList();
        showToast(error.message);
        return false;
    }
}

async function addSchedule(event) {
    event.preventDefault();
    const [hour, minute] = $("scheduleTime").value.split(":").map(Number);
    const daysMask = Array.from(
        document.querySelectorAll('input[name="scheduleDay"]:checked')
    ).reduce((mask, input) => mask | (1 << Number(input.value)), 0);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !daysMask) {
        showToast("Escolhe uma hora e pelo menos um dia.");
        return;
    }
    const previousSchedules = JSON.parse(JSON.stringify(schedules));
    const schedule = {
        id: editingScheduleId !== undefined && editingScheduleId !== null ? editingScheduleId : Date.now() % 1000000000,
        name: $("scheduleName").value.trim(),
        enabled: $("scheduleEnabled").checked,
        hour,
        minute,
        daysMask,
        repeat: $("scheduleRepeat").checked
    };
    if (!schedule.name) {
        showToast("Dá um nome ao horário.");
        $("scheduleName").focus();
        return;
    }
    if ($("scheduleDevice").value === "mode") {
        schedule.mode = $("scheduleAction").value;
    } else {
        schedule.device = $("scheduleDevice").value;
        schedule.action = $("scheduleAction").value;
    }
    if (editingScheduleId === null) {
        if (schedules.length >= 12) {
            showToast("A ESP32 aceita no máximo 12 horários.");
            return;
        }
        schedules.push(schedule);
    } else {
        schedules = schedules.map((existing) =>
            existing.id === editingScheduleId ? schedule : existing);
    }
    if (await persistSchedules(previousSchedules)) resetScheduleForm();
}

async function executeConfiguredAction(device, action) {
    if (device === "mode") return activateMode(action);
    const value = ["open", "on"].includes(action);
    const devices = device === "both_windows"
        ? ["window1", "window2"]
        : device === "both_lights"
            ? [...LIGHT_IDS]
            : [device];
    for (const target of devices) {
        if (!await controlDevice(target, value)) return false;
    }
    return true;
}

async function executeScheduleNow() {
    const device = $("scheduleDevice").value;
    const action = $("scheduleAction").value;
    const confirmed = await executeConfiguredAction(device, action);
    if (confirmed) showToast("Ação executada agora. Consulta o histórico para ver o resultado.");
}

async function setAutomaticDevice(device, enabled) {
    const previousSettings = JSON.parse(JSON.stringify(houseSettings));
    const updatedSettings = {
        ...houseSettings,
        autoDevices: { ...houseSettings.autoDevices, [device]: enabled }
    };
    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/settings", {
                method: "PUT",
                body: JSON.stringify({ settings: updatedSettings })
            });
            houseSettings = {
                ...DEFAULT_SETTINGS,
                ...config.settings,
                devices: { ...DEFAULT_SETTINGS.devices, ...config.settings.devices },
                autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...config.settings.autoDevices }
            };
        } else {
            houseSettings = updatedSettings;
        }
        localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
        renderHouseSettings();
        showToast(connectionMode === "esp32"
            ? `${houseSettings.devices[device]} em modo automático na ESP32.`
            : "Preferência guardada neste navegador; não controla o equipamento em demonstração.");
    } catch (error) {
        houseSettings = previousSettings;
        renderHouseSettings();
        showToast(error.message);
    }
}

async function stopMovements(device = "all") {
    const label = device === "all" ? "Todos os movimentos" : houseSettings.devices[device];
    if (connectionMode !== "esp32") {
        appendHistory({
            device: label,
            action: "Parar movimentos",
            source: "simulação",
            result: "nenhum comando enviado; modo demonstração"
        });
        showToast("Modo demonstração: nenhum movimento físico foi parado.");
        return;
    }
    try {
        const state = await apiRequest("/api/stop", {
            method: "POST",
            body: JSON.stringify({ device })
        });
        renderState(state);
        appendHistory({
            device: label,
            action: "Parar movimentos",
            source: "aplicação",
            result: "sinal dos servos interrompido; posição física não confirmada"
        });
    } catch (error) {
        appendHistory({
            device: label,
            action: "Parar movimentos",
            source: "aplicação",
            result: `falha: ${error.message}`
        });
        showToast(error.message);
    }
}

async function testConnection() {
    let url;
    try {
        url = new URL($("esp32Url").value.trim());
    } catch (error) {
        showToast("Indica um endereço IP válido da ESP32.");
        return;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        showToast("Usa um endereço HTTP/HTTPS sem credenciais incorporadas.");
        return;
    }
    const oldUrl = apiBaseUrl;
    const oldToken = apiToken;
    lastConnectionTest = "";
    apiBaseUrl = url.origin;
    apiToken = $("esp32Token").value.trim();
    try {
        const state = await apiRequest("/api/state");
        if (state.connected !== true) throw new Error("A ESP32 não confirmou a ligação.");
        lastConnectionTest = `Teste da API bem-sucedido · ${apiBaseUrl}`;
        lastSystemError = "";
        $("connectionHelp").textContent = `Teste concluído: API disponível em ${apiBaseUrl}.`;
        showToast("Ligação testada com sucesso. As preferências não foram alteradas.");
    } catch (error) {
        lastSystemError = error.message;
        lastConnectionTest = "Falha no teste da API";
        $("connectionHelp").textContent = `Falha no teste: ${error.message}`;
        showToast(error.message);
    } finally {
        apiBaseUrl = oldUrl;
        apiToken = oldToken;
        renderDiagnostics();
    }
}

async function testSensors() {
    if (connectionMode !== "esp32") {
        $("sensorTestResult").textContent = "Indisponível em demonstração; sem sensores reais.";
        showToast("Liga à ESP32 para testar as leituras reais.");
        return;
    }
    try {
        const state = await apiRequest("/api/state");
        if (!state || state.connected !== true) {
            throw new Error("A ESP32 não confirmou uma leitura válida dos sensores.");
        }
        renderState(state);
        setConnectionStatus("Ligada", "connected");
        recordSensorSample(state, true);
        renderStatistics();
        const temperature = typeof state.temperatureC === "number"
            ? `${numberText(state.temperatureC)} °C`
            : "temperatura sem leitura";
        const humidity = typeof state.humidityPercent === "number"
            ? `${numberText(state.humidityPercent, 0)}% humidade`
            : "humidade sem leitura";
        $("sensorTestResult").textContent =
            `${temperature}; exterior ${numberText(state.temperatureOutC)} °C; ${humidity}; luminosidade ${Number.isFinite(state.luminosityLux) ? Math.round(state.luminosityLux) + " lx" : "sem leitura"}; ` +
            `chuva ${state.rainDetected === true ? "detetada" : state.rainDetected === false ? "não detetada" : "sem leitura"}; ` +
            `movimento ${state.motionDetected === true ? "detetado" : state.motionDetected === false ? "não detetado" : "sem leitura"}.`;
        showToast("Leituras atuais recebidas da ESP32; sensores físicos não foram acionados.");
    } catch (error) {
        $("sensorTestResult").textContent = `Falha: ${error.message}`;
        showToast(error.message);
    }
}

async function calibrateTemperature(event) {
    event.preventDefault();
    if (connectionMode !== "esp32" || !currentState || currentState.connected !== true ||
        !Number.isFinite(currentState.temperatureC)) {
        $("temperatureCalibrationStatus").textContent =
            "Liga à ESP32 e confirma uma leitura válida antes de calibrar.";
        showToast("A calibração requer uma leitura atual da ESP32.");
        return;
    }

    const referenceText = $("temperatureReference").value.trim();
    const reference = Number(referenceText);
    if (!referenceText || !Number.isFinite(reference) || reference < -40 || reference > 85) {
        showToast("Indica uma temperatura de referência entre -40 e 85 °C.");
        return;
    }
    const currentOffset = houseSettings.temperatureOffsetC !== undefined && houseSettings.temperatureOffsetC !== null
        ? houseSettings.temperatureOffsetC
        : 0;
    const temperatureOffsetC = Number(
        (currentOffset + reference - currentState.temperatureC).toFixed(1)
    );
    if (temperatureOffsetC < -10 || temperatureOffsetC > 10) {
        showToast("A diferença excede a correção máxima de ±10 °C.");
        return;
    }

    const updatedSettings = { ...houseSettings, temperatureOffsetC };
    try {
        const config = await apiRequest("/api/config/settings", {
            method: "PUT",
            body: JSON.stringify({ settings: updatedSettings })
        });
        if (!isValidSettings(config.settings)) {
            throw new Error("A API não devolveu definições válidas após guardar a calibração.");
        }
        houseSettings = {
            ...DEFAULT_SETTINGS,
            ...config.settings,
            devices: { ...DEFAULT_SETTINGS.devices, ...config.settings.devices },
            autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...config.settings.autoDevices }
        };
        let savedLocally = true;
        try {
            localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
        } catch (error) {
            console.warn("Não foi possível guardar a calibração neste navegador.", error);
            savedLocally = false;
        }
        renderHouseSettings();
        $("temperatureCalibrationStatus").textContent =
            `Calibração guardada: correção de ${numberText(temperatureOffsetC)} °C.`;
        await refreshRemoteState(false);
        showToast(savedLocally
            ? "Correção guardada na ESP32. A temperatura ajustada será usada nas regras."
            : "Calibração guardada na ESP32, mas não neste navegador.");
    } catch (error) {
        showToast(`Não foi possível calibrar o sensor: ${error.message}`);
    }
}

async function runFullDiagnostics() {
    if (connectionMode !== "esp32") {
        $("fullDiagnosticsResult").textContent =
            "Verificação indisponível em demonstração; não há ligação nem sensores reais.";
        showToast("Liga à ESP32 para executar a verificação completa.");
        return;
    }
    try {
        const state = await apiRequest("/api/state");
        const config = await apiRequest("/api/config");
        if (state.connected !== true) throw new Error("A ESP32 não confirmou a ligação.");
        setConnectionStatus("Ligada", "connected");
        renderState(state);
        const configurationValid = isValidSettings(config.settings) &&
            isValidModeProfiles(config.profiles) &&
            Array.isArray(config.schedules) && config.schedules.length <= 12 &&
            config.schedules.every(isValidSchedule) &&
            Array.isArray(config.automations) && config.automations.length <= 16 &&
            config.automations.every(isValidAutomation);
        const sensors = [
            Number.isFinite(state.temperatureC),
            Number.isFinite(state.humidityPercent),
            Number.isFinite(state.luminosityLux),
            Number.isFinite(state.temperatureOutC),
            typeof state.rainDetected === "boolean",
            typeof state.motionDetected === "boolean"
        ];
        const rtcStatus = state.rtcAvailable
            ? state.schedulesEnabled ? "RTC com hora válida" : "RTC sem hora válida"
            : "RTC não detetado";
        $("fullDiagnosticsResult").textContent =
            `API: OK · Configuração: ${configurationValid ? "válida" : "inválida"} · ` +
            `Sensores: ${sensors.filter(Boolean).length}/5 com leitura · ${rtcStatus}. ` +
            "As saídas não foram acionadas.";
        showToast(configurationValid
            ? "Verificação concluída sem acionar equipamentos."
            : "A API respondeu, mas a configuração devolvida é inválida.");
    } catch (error) {
        $("fullDiagnosticsResult").textContent = `Verificação falhou: ${error.message}`;
        showToast(error.message);
    }
}

function exportHistory() {
    const rows = [["Data", "Equipamento", "Ação", "Origem", "Resultado"]];
    filteredHistoryEntries().forEach((entry) => rows.push([
        new Date(entry.timestamp).toISOString(),
        entry.device,
        entry.action,
        entry.source,
        entry.result
    ]));
    const csv = rows.map((row) =>
        row.map((value) => `"${String(value !== undefined && value !== null ? value : "").replace(/"/g, '""')}"`).join(",")
    ).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `domus-historico-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function exportStatistics() {
    const { start, end } = selectedStatisticsRange();
    const rows = [[
        "Data e hora", "Tipo", "Origem", "Temperatura C", "Luminosidade lx",
        "Equipamento", "Ação", "Resultado"
    ]];
    sensorSamples.filter((sample) =>
        sample.timestamp >= start && sample.timestamp <= end).forEach((sample) => {
        rows.push([
            new Date(sample.timestamp).toISOString(),
            "sensor",
            sample.source === "esp32" ? "ESP32" : "demonstração",
            sample.temperatureC !== undefined && sample.temperatureC !== null ? sample.temperatureC : "",
            sample.luminosityLux !== undefined && sample.luminosityLux !== null ? sample.luminosityLux : "",
            "",
            "",
            ""
        ]);
    });
    historyEntries.filter((entry) =>
        Number(entry.timestamp) >= start && Number(entry.timestamp) <= end).forEach((entry) => {
        rows.push([
            new Date(entry.timestamp).toISOString(),
            "atividade",
            entry.source,
            "",
            "",
            entry.device,
            entry.action,
            entry.result
        ]);
    });
    downloadCsv(rows, `domus-estatisticas-${$("statisticsPeriod").value}.csv`);
}

function downloadCsv(rows, filename) {
    const csv = rows.map((row) =>
        row.map((value) => `"${String(value !== undefined && value !== null ? value : "").replace(/"/g, '""')}"`).join(",")
    ).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

function isValidSettings(settings) {
    const deviceKeys = Object.keys(DEFAULT_SETTINGS.devices);
    return settings && typeof settings === "object" &&
        typeof settings.homeName === "string" && settings.homeName.trim().length > 0 &&
        settings.homeName.length <= 40 &&
        typeof settings.roomName === "string" && settings.roomName.trim().length > 0 &&
        settings.roomName.length <= 40 &&
        settings.devices && deviceKeys.every((key) =>
            typeof settings.devices[key] === "string" &&
            settings.devices[key].trim().length > 0 && settings.devices[key].length <= 40) &&
        Number.isFinite(settings.fanOnTemp) && settings.fanOnTemp >= -40 && settings.fanOnTemp <= 85 &&
        Number.isFinite(settings.fanOffTemp) && settings.fanOffTemp >= -40 &&
        settings.fanOffTemp < settings.fanOnTemp &&
        Number.isFinite(settings.temperatureOffsetC !== undefined && settings.temperatureOffsetC !== null ? settings.temperatureOffsetC : 0) &&
        (settings.temperatureOffsetC !== undefined && settings.temperatureOffsetC !== null ? settings.temperatureOffsetC : 0) >= -10 &&
        (settings.temperatureOffsetC !== undefined && settings.temperatureOffsetC !== null ? settings.temperatureOffsetC : 0) <= 10 &&
        Number.isInteger(settings.darkThreshold) && settings.darkThreshold >= 0 &&
        settings.darkThreshold <= 65535 &&
        Number.isInteger(settings.noMotionSeconds) && settings.noMotionSeconds >= 1 &&
        settings.noMotionSeconds <= 86400 &&
        Number.isInteger(settings.faucetSeconds) && settings.faucetSeconds >= 1 &&
        settings.faucetSeconds <= 60 &&
        (settings.autoDevices == null ||
            (typeof settings.autoDevices === "object" &&
                typeof settings.autoDevices.light1 === "boolean" &&
                typeof settings.autoDevices.fan === "boolean"));
}

function isValidModeProfiles(profiles) {
    const devices = Object.keys(MODE_DEVICE_NAMES);
    return profiles && Object.keys(MODE_NAMES).every((mode) =>
        profiles[mode] && devices.every((device) =>
            MODE_ACTION_OPTIONS[device].some(([value]) => profiles[mode][device] === value)));
}

function isValidSchedule(schedule) {
    if (!schedule || typeof schedule !== "object") return false;
    const validMode = ["auto", "eco", "night", "away"].includes(schedule.mode);
    const validDevice = ["window1", "window2", "both_windows", ...LIGHT_IDS,
        "both_lights", "fan", "faucet"].includes(schedule && schedule.device ? schedule.device : undefined);
    const isWindow = ["window1", "window2", "both_windows"].includes(schedule.device);
    const validAction = validMode || (validDevice &&
        (isWindow
            ? ["open", "closed"].includes(schedule.action)
            : ["on", "off"].includes(schedule.action)));
    return schedule && Number.isInteger(schedule.id) && schedule.id >= 0 &&
        schedule.id <= 0xffffffff && typeof schedule.enabled === "boolean" &&
        Number.isInteger(schedule.hour) && schedule.hour >= 0 && schedule.hour <= 23 &&
        Number.isInteger(schedule.minute) && schedule.minute >= 0 && schedule.minute <= 59 &&
        Number.isInteger(schedule.daysMask) && schedule.daysMask >= 1 && schedule.daysMask <= 127 &&
        (schedule.repeat === undefined || typeof schedule.repeat === "boolean") &&
        (schedule.name === undefined ||
            (typeof schedule.name === "string" && schedule.name.length <= 60)) &&
        (schedule.repeat !== false || typeof schedule.name === "string") &&
        validAction;
}

function validateConfigurationBackup(backup) {
    if (!backup || backup.schemaVersion !== 1 ||
        !isValidSettings(backup.settings) ||
        !isValidModeProfiles(backup.profiles) ||
        !Array.isArray(backup.schedules) || backup.schedules.length > 12 ||
        !backup.schedules.every(isValidSchedule) ||
        !Array.isArray(backup.automations) || backup.automations.length > 16 ||
        !backup.automations.every(isValidAutomation)) {
        throw new Error("Ficheiro inválido ou incompatível. A configuração atual não foi alterada.");
    }
}

function currentConfigurationBackup() {
    const settings = JSON.parse(JSON.stringify(houseSettings));
    settings.telegramToken = "";   // o código do bot é secreto: nunca vai para o ficheiro
    delete settings.siriCode;      // nem o código da Siri da demonstração
    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        settings,
        profiles: JSON.parse(JSON.stringify(modeProfiles)),
        schedules: JSON.parse(JSON.stringify(schedules)),
        automations: JSON.parse(JSON.stringify(automations)),
        appPreferences: {
            statisticsPeriod: $("statisticsPeriod").value
        }
    };
}

function exportConfiguration() {
    const json = JSON.stringify(currentConfigurationBackup(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `domus-configuracao-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Cópia de segurança exportada. O token da API e o código do bot não foram incluídos.");
}

async function importConfiguration(event) {
    const file = event.target && event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 100000) {
        showToast("O ficheiro excede o tamanho máximo de 100 KB.");
        return;
    }
    let imported;
    try {
        imported = JSON.parse(await file.text());
        validateConfigurationBackup(imported);
    } catch (error) {
        showToast(error instanceof SyntaxError
            ? "O ficheiro não contém JSON válido. A configuração atual foi mantida."
            : error.message);
        return;
    }
    if (!window.confirm("Importar esta configuração? As regras, horários, modos e limites atuais serão substituídos.")) {
        return;
    }
    const previousLocalValues = new Map(
        ["domus-settings", "domus-profiles", "domus-schedules", "domus-automations"]
            .map((key) => [key, localStorage.getItem(key)])
    );
    const rollbackLocalConfiguration = () => {
        const failures = [];
        previousLocalValues.forEach((value, key) => {
            try {
                if (value === null) localStorage.removeItem(key);
                else localStorage.setItem(key, value);
            } catch (error) {
                failures.push(error.message);
            }
        });
        if (failures.length) {
            throw new Error(`Não foi possível repor a cópia local: ${failures.join("; ")}`);
        }
    };
    // A cópia não traz o código do bot: mantém-se o que estava neste aparelho
    if (!imported.settings.telegramToken) imported.settings.telegramToken = houseSettings.telegramToken || "";
    if (!imported.settings.siriCode && houseSettings.siriCode) imported.settings.siriCode = houseSettings.siriCode;
    try {
        localStorage.setItem("domus-settings", JSON.stringify(imported.settings));
        localStorage.setItem("domus-profiles", JSON.stringify(imported.profiles));
        localStorage.setItem("domus-schedules", JSON.stringify(imported.schedules));
        localStorage.setItem("domus-automations", JSON.stringify(imported.automations));
    } catch (error) {
        try {
            rollbackLocalConfiguration();
        } catch (rollbackError) {
            showToast(`${error.message}. ${rollbackError.message}`);
            return;
        }
        showToast(`Não foi possível guardar a configuração local: ${error.message}`);
        return;
    }

    let importedSettings = imported.settings;
    let importedProfiles = imported.profiles;
    let importedSchedules = imported.schedules;
    let importedAutomations = imported.automations;
    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/backup", {
                method: "PUT",
                body: JSON.stringify(imported)
            });
            if (!isValidSettings(config.settings) ||
                !isValidModeProfiles(config.profiles) ||
                !Array.isArray(config.schedules) ||
                !config.schedules.every(isValidSchedule) ||
                !Array.isArray(config.automations) ||
                !config.automations.every(isValidAutomation)) {
                throw new Error("A ESP32 devolveu uma configuração inválida após a importação.");
            }
            importedSettings = config.settings;
            importedProfiles = config.profiles;
            importedSchedules = config.schedules;
            importedAutomations = config.automations;
        }
    } catch (error) {
        try {
            rollbackLocalConfiguration();
        } catch (rollbackError) {
            showToast(`Importação falhou: ${error.message}. ${rollbackError.message}`);
            return;
        }
        showToast(`Importação falhou: ${error.message}. A configuração atual foi mantida.`);
        return;
    }

    houseSettings = {
            ...DEFAULT_SETTINGS,
        ...importedSettings,
        devices: { ...DEFAULT_SETTINGS.devices, ...importedSettings.devices },
        autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...importedSettings.autoDevices }
    };
    modeProfiles = importedProfiles;
    schedules = importedSchedules;
    automations = importedAutomations;
    if (["day", "week", "month"].includes(imported.appPreferences && imported.appPreferences.statisticsPeriod ? imported.appPreferences.statisticsPeriod : undefined)) {
        $("statisticsPeriod").value = imported.appPreferences.statisticsPeriod;
    }
    renderHouseSettings();
    renderModeConfig();
    renderScheduleList();
    renderAutomationList();
    renderAutomationForm();
    renderModePreview();
    renderFloorPlan();
    renderStatistics();
    showToast(connectionMode === "esp32"
        ? "Configuração validada, importada e guardada na ESP32."
        : "Configuração importada neste navegador; não foi enviada para hardware.");
}

async function clearHistory() {
    if (!window.confirm("Queres mesmo limpar o histórico? Esta ação não pode ser desfeita.")) return;
    try {
        if (connectionMode === "esp32") {
            await apiRequest("/api/history", { method: "DELETE" });
        }
        historyEntries = [];
        localStorage.setItem("domus-history", "[]");
        renderHistory();
        showToast(connectionMode === "esp32"
            ? "Histórico apagado na ESP32."
            : "Histórico deste navegador apagado.");
    } catch (error) {
        showToast(error.message);
    }
}

async function restoreDefaults() {
    if (!window.confirm("Restaurar definições, modos, horários e automatizações predefinidos?")) return;
    const previous = {
        settings: houseSettings,
        profiles: modeProfiles,
        schedules,
        automations
    };
    try {
        if (connectionMode === "esp32") {
            const config = await apiRequest("/api/config/reset", { method: "POST" });
            modeProfiles = config.profiles || JSON.parse(JSON.stringify(MODE_ACTIONS));
            schedules = Array.isArray(config.schedules) ? config.schedules : [];
            automations = Array.isArray(config.automations) ? config.automations : [];
            houseSettings = {
                ...DEFAULT_SETTINGS,
                ...config.settings,
                devices: { ...DEFAULT_SETTINGS.devices, ...config.settings.devices },
                autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...config.settings.autoDevices }
            };
        } else {
            houseSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            modeProfiles = JSON.parse(JSON.stringify(MODE_ACTIONS));
            schedules = [];
            automations = [];
        }
        localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
        localStorage.setItem("domus-profiles", JSON.stringify(modeProfiles));
        localStorage.setItem("domus-schedules", "[]");
        localStorage.setItem("domus-automations", "[]");
        renderHouseSettings();
        renderModeConfig();
        renderScheduleList();
        renderAutomationList();
        renderAutomationForm();
        showToast(connectionMode === "esp32"
            ? "Predefinições restauradas na ESP32."
            : "Predefinições restauradas neste navegador; sem alterações no hardware.");
    } catch (error) {
        houseSettings = previous.settings;
        modeProfiles = previous.profiles;
        schedules = previous.schedules;
        automations = previous.automations;
        renderHouseSettings();
        renderModeConfig();
        renderScheduleList();
        renderAutomationList();
        showToast(`Não foi possível concluir a reposição: ${error.message}`);
    }
}

function openSettings() {
    navigateToPage("settings");
}

function closeSettings() {
    navigateToPage("home");
}

// O menu tem 7 entradas. Algumas juntam várias páginas, mostradas em separadores
// no topo (por exemplo, Automático = Automatizações + Horários).
// Os nomes antigos das páginas continuam a funcionar (#horarios, botões "Ver todos"…).
const PAGE_GROUPS = [
    { nav: "automations", tabs: [["automations", "Automatizações"], ["schedules", "Horários"]] },
    { nav: "energy", tabs: [["energy", "Energia"], ["statistics", "Estatísticas"]] },
    { nav: "history", tabs: [["history", "Histórico"], ["alerts", "Alertas"]] },
    { nav: "settings", tabs: [["settings", "Definições"], ["diagnostics", "Diagnóstico"], ["about", "Sobre o projeto"]] }
];
// Páginas que passaram a ser uma secção de outra
const PAGE_ALIASES = { plant: { page: "home", section: "floorPlanSection" } };

function pageGroupOf(pageName) {
    return PAGE_GROUPS.find((group) => group.tabs.some(([page]) => page === pageName));
}

function buildPageTabs() {
    PAGE_GROUPS.forEach((group) => {
        group.tabs.forEach(([pageName]) => {
            const view = document.querySelector(`[data-page-view="${pageName}"]`);
            if (!view || view.querySelector(":scope > .page-tabs")) return;
            const bar = document.createElement("nav");
            bar.className = "page-tabs";
            bar.setAttribute("aria-label", "Separadores desta página");
            group.tabs.forEach(([tabPage, label]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "page-tab" + (tabPage === pageName ? " active" : "");
                button.dataset.tabPage = tabPage;
                button.textContent = label;
                if (tabPage === pageName) button.setAttribute("aria-current", "page");
                button.addEventListener("click", () => navigateToPage(tabPage));
                bar.append(button);
            });
            view.prepend(bar);
        });
    });
}

function navigateToPage(pageName, { updateHistory = true } = {}) {
    const alias = PAGE_ALIASES[pageName];
    if (alias) {
        navigateToPage(alias.page, { updateHistory });
        window.setTimeout(() => {
            const section = $(alias.section);
            if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
        return;
    }
    const page = document.querySelector(`[data-page-view="${pageName}"]`);
    if (!page) return;
    const group = pageGroupOf(pageName);
    const navPage = group ? group.nav : pageName;
    document.querySelectorAll("[data-page-view]").forEach((view) => {
        const active = view === page;
        view.classList.toggle("active", active);
        view.setAttribute("aria-hidden", String(!active));
    });
    document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
        const active = item.dataset.page === navPage;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
    });
    document.body.classList.remove("mobile-nav-open");
    $("mobileMenuToggle").setAttribute("aria-expanded", "false");
    $("mobileMenuToggle").setAttribute("aria-label", "Abrir menu");
    window.scrollTo(0, 0);
    if (updateHistory && window.location.hash !== `#${pageName}`) {
        window.history.pushState({ pageName }, "", `#${pageName}`);
    }
}

function toggleMobileNavigation(forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean"
        ? forceOpen
        : !document.body.classList.contains("mobile-nav-open");
    document.body.classList.toggle("mobile-nav-open", shouldOpen);
    $("mobileMenuToggle").setAttribute("aria-expanded", String(shouldOpen));
    $("mobileMenuToggle").setAttribute("aria-label", shouldOpen ? "Fechar menu" : "Abrir menu");
}

function bindEvents() {
    $("openSettings").addEventListener("click", openSettings);
    $("closeSettings").addEventListener("click", closeSettings);
    $("openNotifications").addEventListener("click", openNotifications);
    $("closeNotifications").addEventListener("click", closeNotifications);
    $("mobileMenuToggle").addEventListener("click", () => toggleMobileNavigation());
    $("navBackdrop").addEventListener("click", () => toggleMobileNavigation(false));
    document.querySelectorAll(".nav-item[data-page]").forEach((button) => {
        button.addEventListener("click", () => navigateToPage(button.dataset.page));
    });
    $("live3dViewport").addEventListener("click", (event) => {
        if (live3DDragged) {
            live3DDragged = false;
            return;
        }
        const room = event.target.closest("[data-live-room]");
        const item = event.target.closest("[data-live-item]");
        if (room) selectLive3DItem("room", room.dataset.liveRoom);
        else if (item) selectLive3DItem("device", item.dataset.liveItem);
    });
    $("live3dViewport").addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const room = event.target.closest("[data-live-room]");
        const item = event.target.closest("[data-live-item]");
        if (!room && !item) return;
        event.preventDefault();
        if (room) selectLive3DItem("room", room.dataset.liveRoom);
        else selectLive3DItem("device", item.dataset.liveItem);
    });
    $("live3dViewport").addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".live3d-zoom")) return;
        live3DPointer = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false
        };
    });
    window.addEventListener("pointermove", (event) => {
        if (!live3DPointer || live3DPointer.id !== event.pointerId) return;
        const deltaX = event.clientX - live3DPointer.x;
        const deltaY = event.clientY - live3DPointer.y;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 3) live3DPointer.moved = true;
        live3DRotation.y += deltaX * 0.45;
        live3DRotation.x = Math.min(42, Math.max(-12, live3DRotation.x - deltaY * 0.35));
        live3DPointer.x = event.clientX;
        live3DPointer.y = event.clientY;
        updateLive3DTransform();
    });
    const endLive3DRotation = (event) => {
        if (!live3DPointer || live3DPointer.id !== event.pointerId) return;
        live3DDragged = live3DPointer.moved;
        live3DPointer = null;
    };
    window.addEventListener("pointerup", endLive3DRotation);
    window.addEventListener("pointercancel", endLive3DRotation);
    $("live3dViewport").addEventListener("wheel", (event) => {
        event.preventDefault();
        changeLive3DZoom(event.deltaY < 0 ? 0.06 : -0.06);
    }, { passive: false });
    $("live3dZoomIn").addEventListener("click", () => changeLive3DZoom(0.12));
    $("live3dZoomOut").addEventListener("click", () => changeLive3DZoom(-0.12));
    $("live3dResetView").addEventListener("click", () => {
        live3DRotation = { x: 8, y: -7, z: -4 };
        live3DScale = 1;
        updateLive3DTransform();
    });
    $("live3dControls").addEventListener("click", (event) => {
        const button = event.target.closest("[data-live3d-device][data-live3d-value]");
        if (!button || button.disabled) return;
        const device = button.dataset.live3dDevice;
        const value = button.dataset.live3dValue === "true";
        void withBusyButton(button, "A enviar…", () => controlDevice(device, value));
    });
    document.querySelectorAll("[data-page-link]").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            navigateToPage(link.dataset.pageLink);
        });
    });
    document.querySelectorAll("[data-go-page]").forEach((button) => {
        button.addEventListener("click", () => navigateToPage(button.dataset.goPage));
    });
    $("clearNotifications").addEventListener("click", () => {
        notifications = notifications.map((notification) => ({ ...notification, read: true }));
        try {
            localStorage.setItem("domus-notifications", JSON.stringify(notifications));
        } catch (error) {
            console.warn("Não foi possível guardar o estado das notificações.", error);
        }
        renderNotifications();
    });
    $("connectEsp32").addEventListener("click", () =>
        withBusyButton($("connectEsp32"), "A ligar…", connectToEsp32));
    $("useDemoMode").addEventListener("click", useDemoMode);
    $("testConnection").addEventListener("click", () =>
        withBusyButton($("testConnection"), "A testar…", testConnection));
    $("changeIp").addEventListener("click", () => $("esp32Url").focus());
    $("testSensors").addEventListener("click", () =>
        withBusyButton($("testSensors"), "A ler…", testSensors));
    $("diagnosticsTestConnection").addEventListener("click", () =>
        withBusyButton($("diagnosticsTestConnection"), "A testar…", testConnection));
    $("diagnosticsRefreshState").addEventListener("click", async () =>
        withBusyButton($("diagnosticsRefreshState"), "A atualizar…", async () => {
            if (connectionMode === "esp32") {
                const updated = await refreshRemoteState(true);
                if (updated && currentState) recordSensorSample(currentState, true);
            } else {
                renderState(demoState);
                recordSensorSample(demoState, true);
                showToast("Demonstração atualizada; leituras não vêm de sensores reais.");
            }
        }));
    $("diagnosticsTestSensors").addEventListener("click", () =>
        withBusyButton($("diagnosticsTestSensors"), "A ler…", testSensors));
    $("runFullDiagnostics").addEventListener("click", () =>
        withBusyButton($("runFullDiagnostics"), "A verificar…", runFullDiagnostics));
    $("temperatureCalibrationForm").addEventListener("submit", (event) => {
        const button = $("temperatureCalibrationForm").querySelector('button[type="submit"]');
        void withBusyButton(button, "A calibrar…", () => calibrateTemperature(event));
    });
    $("refreshStatistics").addEventListener("click", async () =>
        withBusyButton($("refreshStatistics"), "A atualizar…", async () => {
            if (connectionMode === "esp32") {
                const updated = await refreshRemoteState(true);
                if (updated && currentState) recordSensorSample(currentState, true);
            } else {
                recordSensorSample(demoState, true);
                showToast("Amostra de demonstração guardada; não são dados reais.");
            }
            renderStatistics();
        }));
    $("exportStatistics").addEventListener("click", () =>
        withBusyButton($("exportStatistics"), "A exportar…", exportStatistics));
    $("statisticsPeriod").addEventListener("change", renderStatistics);
    $("exportConfiguration").addEventListener("click", exportConfiguration);
    $("importConfigurationFile").addEventListener("change", (event) => importConfiguration(event));
    $("applySelectedMode").addEventListener("click", () =>
        withBusyButton($("applySelectedMode"), "A aplicar…", () =>
            activateMode(
                selectedModePreview ||
                (currentState && currentState.activeMode ? currentState.activeMode : "auto")
            )
        )
    );
    $("restoreDefaults").addEventListener("click", () =>
        withBusyButton($("restoreDefaults"), "A repor…", restoreDefaults));
    $("saveModeProfiles").addEventListener("click", () =>
        withBusyButton($("saveModeProfiles"), "A guardar…", saveModeProfiles));
    $("scheduleForm").addEventListener("submit", (event) =>
        withBusyButton($("saveSchedule"), "A guardar…", () => addSchedule(event)));
    $("scheduleDevice").addEventListener("change", () => updateScheduleActions());
    $("cancelScheduleEdit").addEventListener("click", resetScheduleForm);
    $("executeScheduleNow").addEventListener("click", () =>
        withBusyButton($("executeScheduleNow"), "A executar…", executeScheduleNow));
    $("automationForm").addEventListener("submit", (event) =>
        withBusyButton($("saveAutomation"), "A guardar…", () => saveAutomation(event)));
    $("automationCondition").addEventListener("change", () => {
        const defaults = AUTOMATION_DEFAULTS[$("automationCondition").value];
        if (editingAutomationId === null) {
            $("automationDevice").value = defaults.device;
        }
        renderAutomationParameters();
        updateAutomationActionOptions(
            editingAutomationId === null ? defaults.action : undefined
        );
    });
    $("automationDevice").addEventListener("change", () =>
        updateAutomationActionOptions());
    $("cancelAutomationEdit").addEventListener("click", () =>
        renderAutomationForm());

    $("saveSettings").addEventListener("click", async () => {
        await withBusyButton($("saveSettings"), "A guardar…", async () => {
            if (await saveHouseSettings()) closeSettings();
        });
    });
    $("refreshState").addEventListener("click", async () => {
        await withBusyButton($("refreshState"), "A atualizar…", async () => {
            if (connectionMode === "esp32") await refreshRemoteState(true);
            else showToast("Modo demonstração: não há sensores reais para atualizar.");
        });
    });
    $("stopMovements").addEventListener("click", () =>
        withBusyButton($("stopMovements"), "A parar…", () => stopMovements()));
    $("refreshHistory").addEventListener("click", async () => {
        await withBusyButton($("refreshHistory"), "A atualizar…", async () => {
            if (connectionMode === "esp32") {
                try {
                    await refreshRemoteHistory(true);
                    showToast("Histórico atualizado a partir da ESP32.");
                } catch (error) {
                    showToast(error.message);
                }
            } else {
                renderHistory();
                showToast("Histórico local atualizado.");
            }
        });
    });
    $("exportHistory").addEventListener("click", () =>
        withBusyButton($("exportHistory"), "A exportar…", exportHistory));
    $("clearHistory").addEventListener("click", () =>
        withBusyButton($("clearHistory"), "A limpar…", clearHistory));
    ["historyDeviceFilter", "historyActionFilter", "historyFrom", "historyTo"]
        .forEach((id) => $(id).addEventListener("change", renderHistory));

    document.querySelectorAll(".mode-button").forEach((button) => {
        button.addEventListener("click", () =>
            renderModePreview(button.dataset.mode));
    });
    document.querySelectorAll(".floor-room[data-room]").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".floor-room[data-room]").forEach((room) =>
                room.classList.remove("selected"));
            button.classList.add("selected");
            renderFloorPlan();
        });
    });
    $("floorDeviceList").addEventListener("click", (event) => {
        const button = event.target.closest("[data-floor-device]");
        if (!button) return;
        void withBusyButton(button, "A enviar…", () =>
            handleFloorPlanAction(button.dataset.floorDevice, button.dataset.floorAction));
    });
    document.querySelectorAll("[data-device][data-open]").forEach((button) => {
        button.addEventListener("click", () =>
            withBusyButton(button, "A enviar…", () =>
                controlDevice(button.dataset.device, button.dataset.open === "true")));
    });
    document.querySelectorAll("[data-toggle-device]").forEach((button) => {
        button.addEventListener("click", () => {
            const isOn = button.getAttribute("aria-pressed") !== "true";
            void withBusyButton(button, "A enviar…", () =>
                controlDevice(button.dataset.toggleDevice, isOn));
        });
    });
    document.querySelectorAll("[data-auto-device]").forEach((button) => {
        button.addEventListener("click", () => {
            const device = button.dataset.autoDevice;
            void withBusyButton(button, "A guardar…", () =>
                setAutomaticDevice(device, houseSettings.autoDevices[device] !== true));
        });
    });
    document.querySelectorAll("[data-stop-device]").forEach((button) => {
        button.addEventListener("click", () =>
            withBusyButton(button, "A parar…", () => stopMovements(button.dataset.stopDevice)));
    });
    document.querySelectorAll("[data-open-settings]").forEach((button) => {
        button.addEventListener("click", () => {
            openSettings();
            $("settingFanOnTemp").focus();
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.body.classList.contains("mobile-nav-open")) {
            toggleMobileNavigation(false);
        }
    });
    window.addEventListener("popstate", () => {
        const requestedPage = window.location.hash.slice(1);
        navigateToPage(requestedPage || "home", { updateHistory: false });
    });
}

async function init() {
    loadSavedPreferences();
    bindEvents();
    updateLive3DTransform();
    buildPageTabs();
    const requestedPage = window.location.hash.slice(1);
    const initialMatch = document.querySelector(`[data-page-view="${requestedPage}"]`);
    const initialPage = PAGE_ALIASES[requestedPage]
        ? requestedPage
        : initialMatch && initialMatch.dataset && initialMatch.dataset.pageView
            ? initialMatch.dataset.pageView
            : "home";
    navigateToPage(initialPage, { updateHistory: false });
    if (connectionMode === "esp32") {
        setConnectionStatus("A ligar…", "offline");
        renderState(null);
        try {
            const config = await apiRequest("/api/config");
            if (config.profiles) modeProfiles = config.profiles;
            schedules = Array.isArray(config.schedules) ? config.schedules : [];
            automations = Array.isArray(config.automations) ? config.automations : [];
            if (config.settings) {
                houseSettings = {
                    ...DEFAULT_SETTINGS,
                    ...config.settings,
                    devices: { ...DEFAULT_SETTINGS.devices, ...config.settings.devices },
                    autoDevices: { ...DEFAULT_SETTINGS.autoDevices, ...config.settings.autoDevices }
                };
                localStorage.setItem("domus-settings", JSON.stringify(houseSettings));
                renderHouseSettings();
            }
            mergeRemoteHistory(config.history);
            renderModeConfig();
            renderScheduleList();
            renderAutomationList();
            renderHistory();
            await refreshRemoteState(false);
        } catch (error) {
            lastSystemError = error.message;
            setConnectionStatus("Sem comunicação", "offline");
            renderState(null);
            addNotification({
                title: "Falha de comunicação",
                message: error.message,
                severity: "error"
            });
            renderDiagnostics();
        }
    } else {
        connectionMode = "demo";
        setConnectionStatus("Demonstração", "demo");
        renderState(demoState);
    }

    refreshTimer = window.setInterval(() => {
        if (connectionMode === "esp32") refreshRemoteState(false);
        if (connectionMode === "demo" && demoState.faucetOn && faucetDemoStopsAt) {
            const seconds = Math.max(0, Math.ceil((faucetDemoStopsAt - Date.now()) / 1000));
            demoState.faucetRemainingSeconds = seconds;
            if (seconds === 0) {
                demoState.faucetOn = false;
                faucetDemoStopsAt = 0;
                appendHistory({
                    device: houseSettings.devices.faucet,
                    action: "Desligar automaticamente",
                    source: "temporizador",
                    result: "simulação"
                });
                if (typeof sendPhoneNotice === "function") {
                    sendPhoneNotice("Torneira fechada", "A torneira fechou-se sozinha ao fim do tempo definido.", "droplet", 4);
                }
            }
            renderState(demoState);
        }
    }, 5000);
}

init();
