// TRACKS CONFIGURATION
const TRACKS = ['Lead Vocal', 'Backing Vocal', 'Drums', 'Bass', 'Piano', 'Guitar', 'Other', 'Instrumental'];
const DOT_COUNT = 20;

// GLOBAL VARIABLES
let audioCtx, masterGain, masterAnalyser, masterFreqData;
let duration = 0, startTime = 0, pausedAt = 0, isPlaying = false, isLooping = false, isMouseDown = false;
let masterVolume = 1.0, masterPeakHold = 0;
let isMasterVisible = false;

// Arrays sized to 8
let buffers = new Array(8).fill(null), sources = new Array(8).fill(null), gains = new Array(8).fill(null);
let analysers = new Array(8).fill(null), freqData = new Array(8).fill(null);

// State Arrays
let volumeState = new Array(8).fill(1.0);
let muteState = new Array(8).fill(false);
let soloState = new Array(8).fill(false);
let linkState = new Array(8).fill(false);
let uploadedFiles = []; 

// MVSEP STATE
const MVSEP_API_URL = 'https://mvsep.com/api/v1';
// PUBLIC PROXY: Needed for GitHub Pages to bypass CORS
const CORS_PROXY = 'https://corsproxy.io/?'; 

let mvsepToken = localStorage.getItem('mvsep_token') || '';

// PRO RECORDING STATE (AudioWorklet)
let recordNode = null;
let isRecording = false;
let recBuffersL = [], recBuffersR = [];
let recLength = 0;
let recShadowAlpha = 1.0;
let showRecShadow = false;
let recShadowTimeout = null;
let recStartTime = 0, recEndTime = 0;
let stopRecordingResolver = null;

// VIDEO RECORDING STATE
let mediaRecorder = null;
let videoChunks = [];
let videoCanvas = document.getElementById('videoCanvas');
let videoCtx = videoCanvas.getContext('2d');
let videoStreamDest = null;
let videoBgImage = null;

// DOM Elements
const mixerBoard = document.getElementById('mixerBoard');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const recordBtn = document.getElementById('recordBtn');
const layoutBtn = document.getElementById('layoutBtn');
const masterBtn = document.getElementById('masterBtn');
const helpBtn = document.getElementById('helpBtn');
const seekBar = document.getElementById('seekBar');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const importModal = document.getElementById('importModal');
const helpModal = document.getElementById('helpModal');
const recSettingsModal = document.getElementById('recSettingsModal');
const recFileNameInput = document.getElementById('recFileName');
const recFormatSelect = document.getElementById('recFormat');
const recBitrateSelect = document.getElementById('recBitrate');
const recBitDepthSelect = document.getElementById('recBitDepth'); 
const bitrateRow = document.getElementById('bitrateRow'); 
const bitDepthRow = document.getElementById('bitDepthRow');
const videoBgRow = document.getElementById('videoBgRow'); 
const recBgImageInput = document.getElementById('recBgImage');
const saveRecSettingsBtn = document.getElementById('saveRecSettings');
const cancelRecSettingsBtn = document.getElementById('cancelRecSettings');
const encodingModal = document.getElementById('encodingModal');
const encodingBar = document.getElementById('encodingBar');
const encodingPercent = document.getElementById('encodingPercent');
const loader = document.getElementById('loader');
const bulkFileBtn = document.getElementById('bulkFileBtn');
const assignmentList = document.getElementById('assignmentList');
const loadStemsBtn = document.getElementById('loadStemsBtn');
const clearBtn = document.getElementById('clearBtn');

// MVSEP DOM
const mvsepModalBtn = document.getElementById('mvsepModalBtn');
const mvsepModal = document.getElementById('mvsepModal');
const mvsepLoginView = document.getElementById('mvsepLoginView');
const mvsepWorkView = document.getElementById('mvsepWorkView');
const mvsepTokenInput = document.getElementById('mvsepTokenInput');
const mvsepLoginBtn = document.getElementById('mvsepLoginBtn');
const mvsepFileBtn = document.getElementById('mvsepFileBtn');
const mvsepFileName = document.getElementById('mvsepFileName');
const mvsepLog = document.getElementById('mvsepLog');
const mvsepProgress = document.getElementById('mvsepProgress');
const mvsepCancelBtn = document.getElementById('mvsepCancelBtn');

function getClientY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
function getClientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

// --- BUFFERED RECORDER WORKLET ---
const recorderWorkletCode = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this._bufferL = new Float32Array(this.bufferSize);
    this._bufferR = new Float32Array(this.bufferSize);
    this._index = 0;
    this.isRecording = false;
    
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.isRecording = true;
      } else if (e.data === 'stop') {
        this.isRecording = false;
        if (this._index > 0) {
          this.port.postMessage({
            l: this._bufferL.slice(0, this._index),
            r: this._bufferR.slice(0, this._index),
            isFinal: true
          });
        } else {
          this.port.postMessage({ isFinal: true });
        }
        this._index = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input.length > 1 ? input[1] : input[0];
    for (let i = 0; i < left.length; i++) {
      this._bufferL[this._index] = left[i];
      this._bufferR[this._index] = right[i];
      this._index++;
      if (this._index >= this.bufferSize) {
        this.port.postMessage({
          l: this._bufferL.slice(),
          r: this._bufferR.slice()
        });
        this._index = 0;
      }
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

// --- INITIALIZE AUDIO ENGINE ---
async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const blob = new Blob([recorderWorkletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
        await audioCtx.audioWorklet.addModule(url);
    } catch(e) { console.error("Worklet Error:", e); }

    masterGain = audioCtx.createGain();
    masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 64;
    masterFreqData = new Uint8Array(masterAnalyser.frequencyBinCount);
    
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(audioCtx.destination);
    
    masterBtn.classList.toggle('active', isMasterVisible);
}

function setupMasterUI() {
    const container = document.getElementById('masterSlider');
    if(!container) return;
    
    container.innerHTML = '';
    for (let d = 0; d < DOT_COUNT; d++) {
        const dot = document.createElement('div');
        dot.className = 'dot lit';
        if (d >= Math.round(masterVolume * DOT_COUNT)) dot.classList.remove('lit');
        container.appendChild(dot);
    }
    
    const handleMaster = (e) => {
        const rect = container.getBoundingClientRect();
        const isHorizontal = mixerBoard.classList.contains('rack-view') || window.innerWidth <= 768;
        
        if (isHorizontal) {
            const clientX = getClientX(e);
            masterVolume = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        } else {
            const clientY = getClientY(e);
            masterVolume = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
        }
        
        if (masterGain) masterGain.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.03);
        
        const dots = container.querySelectorAll('.dot');
        const active = Math.round(masterVolume * DOT_COUNT);
        dots.forEach((d, i) => d.classList.toggle('lit', i < active));
    };

    container.onmousedown = (e) => { isMouseDown = true; handleMaster(e); };
    container.onmousemove = (e) => { if (isMouseDown) handleMaster(e); };
    container.addEventListener('touchstart', (e) => { e.preventDefault(); isMouseDown = true; handleMaster(e); }, {passive: false});
    container.addEventListener('touchmove', (e) => { e.preventDefault(); if (isMouseDown) handleMaster(e); }, {passive: false});
}

// --- RENDER UI ---
function renderMixer(activeIndices = []) {
    mixerBoard.innerHTML = '';
    const hasStems = activeIndices && activeIndices.length > 0;

    if (!hasStems && !isMasterVisible) {
        mixerBoard.classList.add('is-empty');
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-state';
        emptyMsg.innerHTML = `<div style="font-size:2rem; opacity:0.3;">🎚️</div><p>NO STEMS LOADED</p>`;
        mixerBoard.appendChild(emptyMsg);
        return;
    }
    
    mixerBoard.classList.remove('is-empty');
    
    try {
        if (isMasterVisible) {
            const masterDiv = document.createElement('div');
            masterDiv.className = 'channel master-channel';
            masterDiv.id = 'masterChannel';
            masterDiv.innerHTML = `
                <div class="track-name" style="color:#fff;">MASTER</div>
                <div class="meter-container">
                    <div class="peak-led" id="peak-master"></div>
                    <div class="vu-meter" id="vu-master">
                        ${'<div class="vu-bar"></div>'.repeat(12)}
                    </div>
                </div>
                <div class="dot-slider-container" id="masterSlider"></div>
                <div class="channel-controls">
                    <button class="ctrl-btn" style="opacity:1; pointer-events:none; border-color:transparent; background:transparent; font-size:1.2rem;" title="Mode">🦝</button>
                    <div class="ctrl-btn rack-spacer"></div>
                    <div class="ctrl-btn rack-spacer"></div>
                </div>
            `;
            mixerBoard.appendChild(masterDiv);
            setupMasterUI();
        }
        
        if (hasStems) {
            activeIndices.forEach(i => {
                const name = TRACKS[i];
                const channel = document.createElement('div');
                channel.className = 'channel';
                
                channel.innerHTML = `
                    <div class="track-name">${name}</div>
                    <div class="meter-container">
                        <div class="peak-led" id="peak-${i}"></div>
                        <div class="vu-meter" id="vu-${i}">${'<div class="vu-bar"></div>'.repeat(12)}</div>
                    </div>
                    <div class="dot-slider-container" id="slider-${i}">
                        ${'<div class="dot lit"></div>'.repeat(DOT_COUNT)}
                    </div>
                    <div class="channel-controls">
                        <button class="ctrl-btn solo" id="solo-${i}">SOLO</button>
                        <button class="ctrl-btn mute" id="mute-${i}">MUTE</button>
                        <button class="ctrl-btn link" id="link-${i}">🔗</button>
                    </div>`;
                
                mixerBoard.appendChild(channel);
                
                const sliderEl = document.getElementById(`slider-${i}`);
                const updateSlider = (e) => {
                    const rect = sliderEl.getBoundingClientRect();
                    const isHorizontal = mixerBoard.classList.contains('rack-view') || window.innerWidth <= 768;
                    
                    let val;
                    if (isHorizontal) {
                        const clientX = getClientX(e);
                        val = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    } else {
                        const clientY = getClientY(e);
                        val = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
                    }

                    const diff = val - volumeState[i];
                    volumeState[i] = val;
                    
                    if (linkState[i]) {
                        volumeState.forEach((v, idx) => {
                            if (linkState[idx] && idx !== i) {
                                volumeState[idx] = Math.max(0, Math.min(1, v + diff));
                                updateVisualsForTrack(idx);
                            }
                        });
                    }
                    updateVisualsForTrack(i);
                    updateAudioEngine();
                };

                sliderEl.onmousedown = (e) => { isMouseDown = true; updateSlider(e); };
                sliderEl.addEventListener('mousemove', (e) => { if(isMouseDown) updateSlider(e); });
                sliderEl.addEventListener('touchstart', (e) => { e.preventDefault(); isMouseDown = true; updateSlider(e); }, {passive: false});
                sliderEl.addEventListener('touchmove', (e) => { e.preventDefault(); if(isMouseDown) updateSlider(e); }, {passive: false});

                document.getElementById(`solo-${i}`).onclick = () => toggleSolo(i);
                document.getElementById(`mute-${i}`).onclick = () => toggleMute(i);
                document.getElementById(`link-${i}`).onclick = () => toggleLink(i);
                
                updateVisualsForTrack(i);
            });
        }
        
        updateGlobalSoloVisuals();
        
    } catch (e) {
        console.error("Error rendering mixer:", e);
    }
}

function updateVisualsForTrack(i) {
    const slider = document.getElementById(`slider-${i}`);
    if (!slider) return;
    
    const dots = slider.querySelectorAll('.dot');
    const activeDots = Math.round(volumeState[i] * DOT_COUNT);
    dots.forEach((d, idx) => d.classList.toggle('lit', idx < activeDots));
    
    if (muteState[i]) slider.classList.add('dots-muted');
    else slider.classList.remove('dots-muted');

    document.getElementById(`solo-${i}`).classList.toggle('active', soloState[i]);
    document.getElementById(`mute-${i}`).classList.toggle('active', muteState[i]);
    document.getElementById(`link-${i}`).classList.toggle('active', linkState[i]);
}

function updateGlobalSoloVisuals() {
    const anySolo = soloState.some(s => s);
    const allMuteBtns = document.querySelectorAll('.ctrl-btn.mute');
    allMuteBtns.forEach(btn => {
        if (anySolo) btn.classList.add('inactive');
        else btn.classList.remove('inactive');
    });
}

// --- FILE HANDLING ---
bulkFileBtn.onchange = (e) => { handleFiles(Array.from(e.target.files)); };

function handleFiles(files) {
    const uniqueFiles = new Map();
    files.forEach(f => {
        const nameParts = f.name.split('.');
        if (nameParts.length > 1) nameParts.pop();
        const nameNoExt = nameParts.join('.');
        const baseName = nameNoExt.replace(/[- _(]\d+\)?$/, '');
        
        if (!uniqueFiles.has(baseName)) uniqueFiles.set(baseName, f);
        else {
            const existing = uniqueFiles.get(baseName);
            if (f.name.length < existing.name.length) uniqueFiles.set(baseName, f);
        }
    });
    
    uploadedFiles = Array.from(uniqueFiles.values());
    assignmentList.innerHTML = '';
    loadStemsBtn.disabled = false;
    const assignments = new Array(8).fill(null);
    const rules = [
        { regex: /lead|vocals-lead|main/i, index: 0 },
        { regex: /(back|choir|harmony)(?!.*other)/i, index: 1 },
        { regex: /drum|perc/i, index: 2 },
        { regex: /bass/i, index: 3 },
        { regex: /piano|key/i, index: 4 },
        { regex: /guitar|elec|acous/i, index: 5 },
        { regex: /(other|synth|string|brass|fx)(?!.*vocal)/i, index: 6 },
        { regex: /inst/i, index: 7 }
    ];

    uploadedFiles.forEach(file => {
        const name = file.name.toLowerCase();
        let matched = false;
        for (let rule of rules) {
            if (rule.regex.test(name) && !assignments[rule.index]) {
                assignments[rule.index] = file;
                matched = true;
                break;
            }
        }
        if (!matched && (name.includes('vocal') || name.includes('acapella'))) {
            const looksLikeBacking = /back|harmony|choir/.test(name);
            if (!assignments[0] && !looksLikeBacking) assignments[0] = file;
        }
    });
    
    // EXCEPTION: If any instrumental stems (2-6) are present, remove 'Instrumental' (7)
    const hasInstrumentals = [2, 3, 4, 5, 6].some(i => assignments[i] !== null);
    if (hasInstrumentals) {
        assignments[7] = null; 
    }

    TRACKS.forEach((trackName, i) => {
        const row = document.createElement('div');
        row.className = 'assign-row';
        row.innerHTML = `<div class="assign-label">${trackName}</div>`;
        const select = document.createElement('select');
        select.className = 'assign-select';
        select.id = `assign-${i}`;
        const noneOpt = document.createElement('option');
        noneOpt.value = "";
        noneOpt.innerText = "-- Empty --";
        select.appendChild(noneOpt);
        uploadedFiles.forEach((file, fIdx) => {
            const opt = document.createElement('option');
            opt.value = fIdx;
            opt.innerText = file.name;
            if (assignments[i] === file) opt.selected = true;
            select.appendChild(opt);
        });
        row.appendChild(select);
        assignmentList.appendChild(row);
    });
}

async function processImport() {
    await initAudio(); 
    stopAudio(); 
    importModal.style.display = 'none'; loader.style.display = 'block';
    
    linkState.fill(false); muteState.fill(false); soloState.fill(false); volumeState.fill(1.0);
    
    buffers.fill(null);

    const decodePromises = TRACKS.map(async (_, i) => {
        const select = document.getElementById(`assign-${i}`);
        const fileIndex = select.value;
        if (fileIndex === "") { buffers[i] = null; return; }
        
        const file = uploadedFiles[parseInt(fileIndex)];
        try {
            const ab = await file.arrayBuffer();
            buffers[i] = await audioCtx.decodeAudioData(ab);
        } catch (e) { 
            console.error("Error decoding", file.name); 
            buffers[i] = null; 
        }
    });

    await Promise.all(decodePromises);
    
    const activeIndices = buffers.map((b, i) => b ? i : -1).filter(i => i !== -1);
    renderMixer(activeIndices);
    
    duration = 0;
    buffers.forEach(b => { 
        if (b && typeof b.duration === 'number' && b.duration > duration) {
            duration = b.duration; 
        }
    });
    
    gains = TRACKS.map((_, i) => {
        const g = audioCtx.createGain();
        g.gain.value = volumeState[i];
        const a = audioCtx.createAnalyser();
        a.fftSize = 32; analysers[i] = a; freqData[i] = new Uint8Array(a.frequencyBinCount);
        g.connect(a);
        return g;
    });

    updateAudioEngine();
    loader.style.display = 'none';
    [playPauseBtn, stopBtn, loopBtn, seekBar, recordBtn, clearBtn].forEach(el => el.disabled = false);
    totalTimeLabel.innerText = formatTime(duration);
    renderVisualizers();
}

function clearProject() {
    stopAudio(); 
    buffers = new Array(8).fill(null); uploadedFiles = []; duration = 0; pausedAt = 0;
    linkState.fill(false); muteState.fill(false); soloState.fill(false); volumeState.fill(1.0);
    assignmentList.innerHTML = '';
    renderMixer([]); 
    seekBar.value = 0;
    seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
    currentTimeLabel.innerText = "0:00"; totalTimeLabel.innerText = "0:00";
    [playPauseBtn, stopBtn, loopBtn, recordBtn, seekBar, clearBtn].forEach(el => el.disabled = true);
    importModal.style.display = 'none';
}

// --- MVSEP INTEGRATION ---

// 1. UI Handling
mvsepModalBtn.onclick = () => {
    importModal.style.display = 'none';
    mvsepModal.style.display = 'flex';
    if (mvsepToken) {
        showMvsepWorkView();
    } else {
        mvsepLoginView.style.display = 'block';
        mvsepWorkView.style.display = 'none';
    }
};

mvsepLoginBtn.onclick = () => {
    const t = mvsepTokenInput.value.trim();
    if (t) {
        mvsepToken = t;
        localStorage.setItem('mvsep_token', t);
        showMvsepWorkView();
    }
};

function showMvsepWorkView() {
    mvsepLoginView.style.display = 'none';
    mvsepWorkView.style.display = 'block';
    mvsepProgress.style.width = '0%';
    mvsepLog.innerHTML = '<div class="log-entry">Waiting for file...</div>';
}

mvsepFileBtn.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    mvsepFileName.innerText = file.name;
    startMvsepWorkflow(file);
};

mvsepCancelBtn.onclick = () => {
    mvsepModal.style.display = 'none';
    if (uploadedFiles.length > 0) importModal.style.display = 'flex';
};

function logMvsep(msg, type='info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerText = `> ${msg}`;
    mvsepLog.appendChild(entry);
    mvsepLog.scrollTop = mvsepLog.scrollHeight;
}

// 2. LOGIC
async function startMvsepWorkflow(file) {
    mvsepFileBtn.disabled = true;
    try {
        logMvsep("Starting Separation Workflow...", "info");
        logMvsep("Note: Using Public Proxy for CORS...", "info");
        
        // STAGE 1: ENSEMBLE (Model 28, Option 1)
        logMvsep("Stage 1/2: Uploading to Ensemble (Model 28)...");
        mvsepProgress.style.width = '10%';
        
        const ensembleHash = await uploadToMvsep(file, 28, 1);
        if (!ensembleHash) throw new Error("Upload failed");
        
        logMvsep(`Task created: ${ensembleHash}. Processing...`);
        mvsepProgress.style.width = '20%';
        
        const ensembleFiles = await pollMvsepTask(ensembleHash);
        mvsepProgress.style.width = '40%';
        logMvsep("Stage 1 Complete. Downloading stems...");

        // Download Stage 1 Stems
        const stage1Blobs = {};
        let vocalsBlob = null;

        for (const [key, url] of Object.entries(ensembleFiles)) {
            logMvsep(`Downloading: ${key}...`);
            const blob = await downloadUrlToBlob(url);
            
            downloadBlob(blob, `Stage1_${key}.wav`);
            
            stage1Blobs[key] = blob;
            if (key.toLowerCase().includes('vocal')) vocalsBlob = blob;
        }

        if (!vocalsBlob) throw new Error("No vocals found in Stage 1 results");

        // STAGE 2: KARAOKE (Model 49, Option 6) on VOCALS stem
        logMvsep("Stage 2/2: Separating Vocals (Model 49)...");
        mvsepProgress.style.width = '50%';
        
        // Re-wrap blob as File for upload
        const vocalFile = new File([vocalsBlob], "vocals.wav", { type: "audio/wav" });
        const karaokeHash = await uploadToMvsep(vocalFile, 49, 6);
        
        logMvsep(`Task created: ${karaokeHash}. Processing...`);
        mvsepProgress.style.width = '60%';
        
        const karaokeFiles = await pollMvsepTask(karaokeHash);
        mvsepProgress.style.width = '80%';
        logMvsep("Stage 2 Complete. Downloading vocal stems...");
        
        const stage2Blobs = {};
        for (const [key, url] of Object.entries(karaokeFiles)) {
            logMvsep(`Downloading: ${key}...`);
            const blob = await downloadUrlToBlob(url);
            
            downloadBlob(blob, `Stage2_${key}.wav`);
            
            stage2Blobs[key] = blob;
        }

        // 3. AUTO-ASSIGN to MIXER
        mvsepProgress.style.width = '90%';
        logMvsep("Importing to Stem//OS...");

        uploadedFiles = [];
        const assignmentMap = new Array(8).fill(null);

        const addAndAssign = (blob, name, index) => {
            if(!blob) return;
            const f = new File([blob], name, { type: "audio/wav" });
            uploadedFiles.push(f);
            if (index !== -1) assignmentMap[index] = f;
        };

        for (const [key, blob] of Object.entries(stage2Blobs)) {
            const k = key.toLowerCase();
            if (k.includes('lead') || k.includes('vocals')) addAndAssign(blob, "Lead Vocal.wav", 0);
            else if (k.includes('back') || k.includes('other') || k.includes('instrumental')) addAndAssign(blob, "Backing Vocal.wav", 1);
        }

        for (const [key, blob] of Object.entries(stage1Blobs)) {
            const k = key.toLowerCase();
            if (k.includes('drum')) addAndAssign(blob, "Drums.wav", 2);
            else if (k.includes('bass')) addAndAssign(blob, "Bass.wav", 3);
            else if (k.includes('other')) addAndAssign(blob, "Other.wav", 6);
        }

        mvsepModal.style.display = 'none';
        importModal.style.display = 'flex';
        
        handleFiles(uploadedFiles);
        
        setTimeout(() => {
            assignmentMap.forEach((file, i) => {
                if (file) {
                    const select = document.getElementById(`assign-${i}`);
                    for (let opt of select.options) {
                        if (opt.innerText === file.name) {
                            select.value = opt.value;
                            break;
                        }
                    }
                }
            });
            logMvsep("Done! Confirm in Import menu.");
        }, 100);

        mvsepProgress.style.width = '100%';

    } catch (e) {
        console.error(e);
        logMvsep(`Error: ${e.message}`, 'error');
        mvsepFileBtn.disabled = false;
        mvsepFileBtn.value = '';
    }
}

// API HELPERS with PROXY
async function uploadToMvsep(file, sepType, modelOpt) {
    const formData = new FormData();
    formData.append('api_token', mvsepToken);
    formData.append('audiofile', file);
    formData.append('sep_type', sepType);
    formData.append('model_opt', modelOpt);
    formData.append('is_demo', '0');

    const targetUrl = `${MVSEP_API_URL}/separator/create`;
    // Bypass CORS by prepending the proxy
    const proxyUrl = CORS_PROXY + targetUrl;

    const res = await fetch(proxyUrl, {
        method: 'POST',
        body: formData
    });
    
    const data = await res.json();
    if (data.success) return data.data.hash;
    
    // Sometimes the proxy returns the JSON but the API said failure
    throw new Error(data.message || "API Error");
}

async function pollMvsepTask(hash) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            try {
                const targetUrl = `${MVSEP_API_URL}/separator/get?hash=${hash}`;
                // Bypass CORS for polling too
                const proxyUrl = CORS_PROXY + targetUrl;

                const res = await fetch(proxyUrl);
                const data = await res.json();
                
                if (data.success) {
                    const status = data.data.status; 
                    if (status === 2) {
                        clearInterval(interval);
                        resolve(data.data.files);
                    } else if (status === -1) {
                        clearInterval(interval);
                        reject(new Error("Separation failed on server"));
                    } else {
                        logMvsep(`...Status: ${status === 0 ? 'Queue' : 'Processing'}...`);
                    }
                } else {
                    throw new Error("Poll Error");
                }
            } catch (e) {
                clearInterval(interval);
                reject(e);
            }
        }, 4000); // Check every 4s (polite polling)
    });
}

async function downloadUrlToBlob(url) {
    // URL typically comes as http://... from API, we need to proxy it
    // Ensure we encode it if the proxy requires it, but usually simple append works for this proxy
    const proxyUrl = CORS_PROXY + url;
    
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("Download failed");
    return await res.blob();
}


// --- CONTROLS ---
function toggleMaster() {
    isMasterVisible = !isMasterVisible;
    masterBtn.classList.toggle('active', isMasterVisible);
    const activeIndices = buffers.map((b, i) => b ? i : -1).filter(i => i !== -1);
    renderMixer(activeIndices);
}

function toggleLink(i) {
    linkState[i] = !linkState[i];
    const btn = document.getElementById(`link-${i}`);
    if(btn) btn.classList.toggle('active', linkState[i]);
}
function toggleMute(i) {
    const anySolo = soloState.some(s => s);
    if (anySolo) return;
    const newState = !muteState[i];
    muteState[i] = newState;
    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { if (linkState[tIdx]) muteState[tIdx] = newState; });
    }
    TRACKS.forEach((_, idx) => updateVisualsForTrack(idx));
    updateAudioEngine();
}
function toggleSolo(i) {
    const newState = !soloState[i];
    soloState[i] = newState;
    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { if (linkState[tIdx]) soloState[tIdx] = newState; });
    }
    TRACKS.forEach((_, idx) => updateVisualsForTrack(idx));
    updateGlobalSoloVisuals();
    updateAudioEngine();
}
function updateAudioEngine() {
    const anySolo = soloState.some(s => s);
    TRACKS.forEach((_, i) => {
        if (!gains[i]) return;
        let shouldPlay = false;
        if (anySolo) shouldPlay = soloState[i];
        else shouldPlay = !muteState[i];
        gains[i].gain.setTargetAtTime(shouldPlay ? volumeState[i] : 0, audioCtx.currentTime, 0.03);
    });
}

function play(offset) {
    initAudio();
    if (!duration || duration < 0.1) {
        duration = 0;
        buffers.forEach(b => { if (b && b.duration > duration) duration = b.duration; });
    }
    if (duration === 0) return;
    if (isNaN(offset)) offset = 0;
    if (offset >= duration) offset = 0;
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => play(offset));
        return;
    }
    
    const now = audioCtx.currentTime;
    startTime = now - offset; 
    
    sources = buffers.map((buffer, i) => {
        if (!buffer) return null;
        const s = audioCtx.createBufferSource();
        s.buffer = buffer;
        if (gains[i]) {
            s.connect(gains[i]);
            if (analysers[i]) analysers[i].connect(masterGain);
        } else s.connect(masterGain);
        s.start(now, offset);
        return s;
    });

    isPlaying = true; 
    playPauseBtn.innerText = "PAUSE"; 
    playPauseBtn.classList.add('active');
    
    if (isRecording) {
        if (recFormatSelect.value === 'mp4') {
             if (videoStreamDest) masterGain.connect(videoStreamDest);
        } else {
             if (recordNode) masterGain.connect(recordNode);
        }
    }

    cancelAnimationFrame(window.seekAnim);
    window.seekAnim = requestAnimationFrame(() => updateSeekUI());
}

function pauseAudio() {
    if (!isPlaying) return;
    pausedAt = audioCtx.currentTime - startTime;
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    isPlaying = false;
    playPauseBtn.innerText = "PLAY"; 
    playPauseBtn.classList.remove('active');
}

function stopAudio() {
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    isPlaying = false; 
    pausedAt = 0; 
    playPauseBtn.innerText = "PLAY"; 
    playPauseBtn.classList.remove('active');
    updateSeekUI(true); 
    if (isRecording) stopRecording();
}

function updateSeekUI(reset = false) {
    if (reset) { 
        seekBar.value = 0; 
        seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
        currentTimeLabel.innerText = "0:00"; 
        return; 
    }
    if (!isPlaying) return;

    let current = audioCtx.currentTime - startTime;
    
    if (current >= duration) {
        if (isRecording) stopRecording();
        isLooping ? (stopAudio(), play(0)) : stopAudio(); 
        return;
    }
    pausedAt = current;
    const currentPct = (current / duration) * 100;
    seekBar.value = currentPct;
    currentTimeLabel.innerText = formatTime(current);
    
    const redColor = `rgba(255, 59, 48, ${recShadowAlpha})`;
    let shadowGradient = '';
    if (isRecording) {
        const startPct = (recStartTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, #ff3b30 ${startPct}%, #ff3b30 ${currentPct}%, transparent ${currentPct}%, transparent 100%)`;
    } else if (showRecShadow) {
        const startPct = (recStartTime / duration) * 100, endPct = (recEndTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, ${redColor} ${startPct}%, ${redColor} ${endPct}%, transparent ${endPct}%, transparent 100%)`;
    }
    const progressGradient = `linear-gradient(to right, #e6e6e6 0%, #e6e6e6 ${currentPct}%, #222 ${currentPct}%, #222 100%)`;
    seekBar.style.backgroundImage = shadowGradient ? `${shadowGradient}, ${progressGradient}` : progressGradient;
    window.seekAnim = requestAnimationFrame(() => updateSeekUI());
}

function renderVisualizers() {
    if (!isPlaying) {
        requestAnimationFrame(renderVisualizers);
        return;
    }
    analysers.forEach((a, i) => {
        if (!a) return; 
        a.getByteFrequencyData(freqData[i]);
        const avg = freqData[i].reduce((p, c) => p + c) / freqData[i].length;
        const bars = document.querySelectorAll(`#vu-${i} .vu-bar`);
        bars.forEach((b, j) => b.className = `vu-bar ${j < (avg/20) ? (j<8?'active-low':j<11?'active-mid':'active-high') : ''}`);
    });
    
    if(masterAnalyser && isMasterVisible) {
        masterAnalyser.getByteFrequencyData(masterFreqData);
        const mAvg = masterFreqData.reduce((p, c) => p + c) / masterFreqData.length;
        const mBars = document.querySelectorAll(`#vu-master .vu-bar`);
        if (mBars.length > 0) {
            mBars.forEach((b, j) => b.className = `vu-bar ${j < (mAvg/15) ? (j<8?'active-low':j<11?'active-mid':'active-high') : ''}`);
            const peakLed = document.getElementById('peak-master');
            if (mAvg > 230) { peakLed.classList.add('clipping'); masterPeakHold = Date.now() + 1000; } 
            else if (Date.now() > masterPeakHold) { peakLed.classList.remove('clipping'); }
        }
    }
    requestAnimationFrame(renderVisualizers);
}

// UI LOGIC FOR FORMAT SELECTION
recFormatSelect.onchange = () => {
    const val = recFormatSelect.value;
    bitrateRow.style.display = 'none';
    videoBgRow.style.display = 'none';
    bitDepthRow.style.display = 'none';

    if (val === 'mp4') {
        videoBgRow.style.display = 'grid'; 
    } else if (val === 'mp3') {
        bitrateRow.style.display = 'grid'; 
    } else if (val === 'wav') {
        bitDepthRow.style.display = 'grid';
    }
};

recBgImageInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const img = new Image();
        img.onload = () => { videoBgImage = img; };
        img.src = URL.createObjectURL(file);
    }
};

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        const modal = document.getElementById('recSettingsModal');
        modal.classList.remove('fading-out'); 
        modal.style.display = 'flex';
        recFormatSelect.onchange();
    }
}

cancelRecSettingsBtn.onclick = () => { document.getElementById('recSettingsModal').style.display = 'none'; };

saveRecSettingsBtn.onclick = () => {
    const modal = document.getElementById('recSettingsModal');
    modal.classList.add('fading-out');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('fading-out');
        startRecording();
    }, 300);
};

function drawCenteredCrop(img, ctx, size) {
    if (!img) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#fff";
        ctx.font = "80px Courier New";
        ctx.fillText("Stem//OS", size/2 - 200, size/2);
        return;
    }
    const scale = Math.max(size / img.width, size / img.height);
    const x = (size / 2) - (img.width / 2) * scale;
    const y = (size / 2) - (img.height / 2) * scale;
    ctx.fillStyle = "#000"; 
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
}

// --- RECORDING LOGIC ---
async function startRecording() {
    if (!audioCtx) await initAudio();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    isRecording = true; 
    recStartTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
    recordBtn.classList.add('recording'); 
    seekBar.classList.add('recording');

    const format = recFormatSelect.value;

    if (format === 'mp4') {
        videoStreamDest = audioCtx.createMediaStreamDestination();
        masterGain.connect(videoStreamDest);
        drawCenteredCrop(videoBgImage, videoCtx, videoCanvas.width);

        const canvasStream = videoCanvas.captureStream(30);
        const audioTracks = videoStreamDest.stream.getAudioTracks();
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks
        ]);

        const options = {
            audioBitsPerSecond: 256000,
            videoBitsPerSecond: 2500000,
            mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
             options.mimeType = 'video/mp4'; 
             if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                 options.mimeType = 'video/webm;codecs=vp8,opus';
             }
        }

        try {
            mediaRecorder = new MediaRecorder(combinedStream, options);
        } catch (e) {
            mediaRecorder = new MediaRecorder(combinedStream);
        }
        
        videoChunks = [];
        mediaRecorder.ondataavailable = (e) => { 
            if (e.data.size > 0) videoChunks.push(e.data); 
        };
        mediaRecorder.start();

        const drawLoop = () => {
            if (!isRecording) return;
            drawCenteredCrop(videoBgImage, videoCtx, videoCanvas.width);
            requestAnimationFrame(drawLoop);
        };
        drawLoop();

    } else {
        recBuffersL = []; recBuffersR = []; recLength = 0;
        stopRecordingResolver = null;

        try {
            recordNode = new AudioWorkletNode(audioCtx, 'recorder-processor');
            
            recordNode.port.onmessage = (e) => {
                if (e.data.isFinal) {
                    if (e.data.l) {
                        recBuffersL.push(e.data.l);
                        recBuffersR.push(e.data.r);
                        recLength += e.data.l.length;
                    }
                    if (stopRecordingResolver) stopRecordingResolver();
                    return;
                }
                
                if (e.data.l && e.data.r) {
                    recBuffersL.push(e.data.l);
                    recBuffersR.push(e.data.r);
                    recLength += e.data.l.length;
                }
            };
            
            masterGain.connect(recordNode);
            recordNode.connect(audioCtx.destination); 
            recordNode.port.postMessage('start');
        } catch(e) {
            console.error("Failed to start AudioWorklet. Fallback?", e);
            alert("Recording error. Try reloading.");
            stopRecording();
        }
    }
}

async function stopRecording() {
    isRecording = false; 
    recordBtn.classList.remove('recording'); 
    seekBar.classList.remove('recording');
    recEndTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
    
    const format = recFormatSelect.value;
    const name = recFileNameInput.value || "stem_mix";

    if (format === 'mp4') {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.onstop = () => {
                const blob = new Blob(videoChunks, { type: mediaRecorder.mimeType });
                if (videoStreamDest) {
                    masterGain.disconnect(videoStreamDest);
                    videoStreamDest = null;
                }
                
                let ext = 'mp4';
                if (mediaRecorder.mimeType.includes('webm')) ext = 'webm';
                downloadBlob(blob, `${name}.${ext}`);
            };
        }
    } else {
        if (recordNode) {
            const stopPromise = new Promise(r => stopRecordingResolver = r);
            recordNode.port.postMessage('stop');
            await stopPromise;
            recordNode.disconnect();
            masterGain.disconnect(recordNode);
            recordNode = null;
        }

        const bitDepth = parseInt(recBitDepthSelect.value);
        const bitrate = parseInt(recBitrateSelect.value);

        if (format === 'mp3') await exportMp3(name, bitrate); 
        else await exportWav(name, bitDepth);
    }
    
    showRecShadow = true; recShadowAlpha = 1.0;
    if (recShadowTimeout) clearTimeout(recShadowTimeout);
    recShadowTimeout = setTimeout(() => {
        let fadeInterval = setInterval(() => {
            recShadowAlpha -= 0.02; if (!isPlaying) updateSeekUI(); 
            if (recShadowAlpha <= 0) { clearInterval(fadeInterval); showRecShadow = false; recShadowAlpha = 1.0; if (!isPlaying) updateSeekUI(); }
        }, 20);
    }, 8000);
}

// --- EXPORTERS ---
async function exportMp3(name, bitrate) {
    if (typeof lamejs === 'undefined') { alert("Encoder missing."); return; }
    
    encodingModal.style.display = 'flex';
    encodingBar.style.width = '0%';
    encodingPercent.innerText = '0%';

    const l = mergeBuffers(recBuffersL, recLength);
    const r = mergeBuffers(recBuffersR, recLength);
    
    const mp3 = new lamejs.Mp3Encoder(2, audioCtx.sampleRate, bitrate);
    const data = [];
    
    const lp = new Int16Array(l.length);
    const rp = new Int16Array(r.length);
    
    for(let i=0; i<l.length; i++) { 
        lp[i] = Math.max(-1, Math.min(1, l[i])) * 0x7FFF; 
        rp[i] = Math.max(-1, Math.min(1, r[i])) * 0x7FFF; 
    }
    
    const chunkSize = 1152 * 20; 
    for (let i = 0; i < lp.length; i += chunkSize) {
        const buf = mp3.encodeBuffer(lp.subarray(i, i+chunkSize), rp.subarray(i, i+chunkSize));
        if (buf.length > 0) data.push(buf);
        
        const p = Math.round((i/lp.length)*100);
        encodingBar.style.width = p+'%';
        encodingPercent.innerText = p+'%';
        await new Promise(r => setTimeout(r, 0));
    }
    
    data.push(mp3.flush());
    downloadBlob(new Blob(data, {type:'audio/mp3'}), name+'.mp3');
    encodingModal.style.display = 'none';
}

async function exportWav(name, bitDepth) {
    encodingModal.style.display = 'flex';
    encodingBar.style.width = '30%';
    encodingPercent.innerText = '30%';
    await new Promise(r => setTimeout(r, 10));

    const l = mergeBuffers(recBuffersL, recLength);
    const r = mergeBuffers(recBuffersR, recLength);
    
    const interleaved = interleave(l, r);
    
    let bytesPerSample = bitDepth / 8;
    const bufferLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + bufferLength);
    const view = new DataView(buffer);
    
    writeString(view, 0, 'RIFF'); 
    view.setUint32(4, 36 + bufferLength, true);
    writeString(view, 8, 'WAVE'); 
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); 
    
    const formatCode = (bitDepth === 32) ? 3 : 1; 
    view.setUint16(20, formatCode, true); 
    view.setUint16(22, 2, true);
    view.setUint32(24, audioCtx.sampleRate, true); 
    view.setUint32(28, audioCtx.sampleRate * 2 * bytesPerSample, true);
    view.setUint16(32, 2 * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    
    writeString(view, 36, 'data'); 
    view.setUint32(40, bufferLength, true);

    encodingBar.style.width = '60%';
    encodingPercent.innerText = '60%';
    await new Promise(r => setTimeout(r, 50));

    let offset = 44;
    if (bitDepth === 32) {
        for (let i = 0; i < interleaved.length; i++, offset += 4) {
            view.setFloat32(offset, interleaved[i], true);
        }
    } else if (bitDepth === 24) {
        for (let i = 0; i < interleaved.length; i++, offset += 3) {
            let s = Math.max(-1, Math.min(1, interleaved[i]));
            s = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
            view.setInt8(offset, (s & 0xFF));        
            view.setInt8(offset + 1, (s >> 8) & 0xFF); 
            view.setInt8(offset + 2, (s >> 16) & 0xFF); 
        }
    } else {
        for (let i = 0; i < interleaved.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, interleaved[i]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(offset, s, true);
        }
    }
    
    encodingBar.style.width = '100%';
    encodingPercent.innerText = '100%';
    await new Promise(r => setTimeout(r, 100));

    downloadBlob(new Blob([view], { type: 'audio/wav' }), `${name}.wav`);
    encodingModal.style.display = 'none';
}

function mergeBuffers(bufs, len) { const res = new Float32Array(len); let off = 0; bufs.forEach(b => { res.set(b, off); off += b.length; }); return res; }

function interleave(l, r) { 
    const res = new Float32Array(l.length + r.length); 
    for(let j=0; j < l.length; j++) { 
        res[j*2] = l[j]; 
        res[j*2+1] = r[j]; 
    } 
    return res; 
}

function writeString(v, o, s) { for(let i=0; i<s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); }
function downloadBlob(b, n) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); }
function formatTime(s) { return Math.floor(s/60) + ":" + Math.floor(s%60).toString().padStart(2,'0'); }

// Bindings
document.getElementById('importBtn').onclick = () => document.getElementById('importModal').style.display='flex';
document.getElementById('loadStemsBtn').onclick = processImport;
document.getElementById('recordBtn').onclick = toggleRecording;
document.getElementById('masterBtn').onclick = toggleMaster;
playPauseBtn.onclick = () => isPlaying ? pauseAudio() : play(pausedAt);
stopBtn.onclick = stopAudio;
clearBtn.onclick = clearProject;
seekBar.oninput = (e) => {
    const val = parseFloat(e.target.value);
    let newPos = (val / 100) * duration;
    if (newPos > duration) newPos = duration;
    pausedAt = newPos; updateSeekUI(); 
    if (newPos >= duration) {
        if (isPlaying) stopAudio(); 
        return;
    }
    if (isPlaying) { sources.forEach(s => s && s.stop()); play(newPos); }
};
document.addEventListener('mouseup', () => isMouseDown = false);
document.addEventListener('touchend', () => isMouseDown = false);
document.getElementById('importModal').onclick = (e) => { if(e.target.id === 'importModal') e.target.style.display = 'none'; };
document.getElementById('cancelModalBtn').onclick = () => document.getElementById('importModal').style.display = 'none';
document.getElementById('helpBtn').onclick = () => document.getElementById('helpModal').style.display='flex';
document.getElementById('closeHelpBtn').onclick = () => document.getElementById('helpModal').style.display='none';

document.getElementById('layoutBtn').onclick = () => {
    mixerBoard.classList.toggle('rack-view');
    setupMasterUI(); 
};

// Initial Setup
renderMixer([]);
recFormatSelect.onchange();