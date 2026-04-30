document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app-content');
    const canvas = document.getElementById('box-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!app || !canvas || !ctx) {
        return;
    }
    const layoutHost = canvas.parentElement || document.querySelector('.container');
    const initialWidth = layoutHost ? layoutHost.clientWidth : canvas.clientWidth;
    const initialHeight = layoutHost ? layoutHost.clientHeight : canvas.clientHeight;

    // Exercise type definitions
    const exerciseTypes = {
        box: {
            name: 'Box Breathing',
            description: 'Equal phases for balance and calm',
            getPhases: (phaseTime) => [
                { name: 'Inhale', duration: phaseTime, color: '#f97316' },
                { name: 'Hold', duration: phaseTime, color: '#fbbf24' },
                { name: 'Exhale', duration: phaseTime, color: '#38bdf8' },
                { name: 'Wait', duration: phaseTime, color: '#22c55e' }
            ],
            hasPhaseTimeSlider: true,
            phaseTimeRange: { min: 3, max: 6, step: 1, default: 4 },
            phaseTimeLabel: 'Phase Time'
        },
        fourSevenEight: {
            name: '4-7-8 Breathing',
            description: 'Relaxation and sleep aid',
            getPhases: () => [
                { name: 'Inhale', duration: 4, color: '#f97316' },
                { name: 'Hold', duration: 7, color: '#fbbf24' },
                { name: 'Exhale', duration: 8, color: '#38bdf8' }
            ],
            hasPhaseTimeSlider: false
        },
        longExhale: {
            name: 'Long Exhale',
            description: 'Extended exhale for relaxation',
            getPhases: (_, exhaleDuration) => [
                { name: 'Inhale', duration: 4, color: '#f97316' },
                { name: 'Exhale', duration: exhaleDuration, color: '#38bdf8' }
            ],
            hasPhaseTimeSlider: true,
            phaseTimeRange: { min: 6, max: 8, step: 1, default: 6 },
            phaseTimeLabel: 'Exhale Time',
            phaseTimeUnit: 'seconds'
        },
        coherent: {
            name: 'Coherent Breathing',
            description: 'Equal inhale and exhale for HRV',
            getPhases: (phaseTime) => [
                { name: 'Inhale', duration: phaseTime, color: '#f97316' },
                { name: 'Exhale', duration: phaseTime, color: '#38bdf8' }
            ],
            hasPhaseTimeSlider: true,
            phaseTimeRange: { min: 4.5, max: 6, step: 0.5, default: 5 },
            phaseTimeLabel: 'Breath Time'
        }
    };

    const state = {
        isPlaying: false,
        count: 0,
        countdown: 4,
        totalTime: 0,
        soundEnabled: false,
        countdownEnabled: false,
        timeLimit: '',
        sessionComplete: false,
        timeLimitReached: false,
        phaseTime: 4,
        exhaleDuration: 6,
        exerciseType: 'box',
        pulseStartTime: null,
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
        viewportWidth: initialWidth,
        viewportHeight: initialHeight,
        prefersReducedMotion: false,
        hasStarted: false,
        startTime: null,
        targetRounds: 0,
        completedRounds: 0,
        readyToEndAfterExhale: false
    };

    // Settings persistence
    const STORAGE_KEY = 'breathingExercisesSettings';

    function saveSettings() {
        try {
            const settings = {
                soundEnabled: state.soundEnabled,
                countdownEnabled: state.countdownEnabled,
                exerciseType: state.exerciseType,
                phaseTime: state.phaseTime,
                exhaleDuration: state.exhaleDuration
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const settings = JSON.parse(saved);
                if (typeof settings.soundEnabled === 'boolean') {
                    state.soundEnabled = settings.soundEnabled;
                }
                if (typeof settings.countdownEnabled === 'boolean') {
                    state.countdownEnabled = settings.countdownEnabled;
                }
                if (settings.exerciseType && exerciseTypes[settings.exerciseType]) {
                    state.exerciseType = settings.exerciseType;
                }
                if (typeof settings.phaseTime === 'number') {
                    state.phaseTime = settings.phaseTime;
                }
                if (typeof settings.exhaleDuration === 'number') {
                    state.exhaleDuration = settings.exhaleDuration;
                }
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    // Load settings on startup
    loadSettings();

    function getCurrentPhases() {
        const exercise = exerciseTypes[state.exerciseType];
        if (state.exerciseType === 'longExhale') {
            return exercise.getPhases(state.phaseTime, state.exhaleDuration);
        }
        return exercise.getPhases(state.phaseTime);
    }

    function getTotalCycleTime() {
        return getCurrentPhases().reduce((sum, phase) => sum + phase.duration, 0);
    }

    let wakeLock = null;
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const offlineNotification = document.getElementById('offline-notification');
    let hideTimeout = null;

    function updateOnlineStatus() {
        if (offlineNotification) {
            if (navigator.onLine) {
                offlineNotification.style.display = 'none';
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
            } else {
                offlineNotification.style.display = 'block';
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                }
                hideTimeout = setTimeout(() => {
                    offlineNotification.style.display = 'none';
                    hideTimeout = null;
                }, 5000);
            }
        }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    const icons = {
        play: `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
        pause: `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`,
        volume2: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        volumeX: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
        rotateCcw: `<svg class="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
        clock: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        hash: `<svg class="icon" viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`
    };

    function toggleCountdown() {
        state.countdownEnabled = !state.countdownEnabled;
        saveSettings();
        render();
    }

    function getInstruction(count) {
        const phases = getCurrentPhases();
        if (count >= 0 && count < phases.length) {
            return phases[count].name;
        }
        return '';
    }

    function getPhaseColor(count) {
        const phases = getCurrentPhases();
        if (count >= 0 && count < phases.length) {
            return phases[count].color;
        }
        return '#f97316';
    }

    const phaseColors = ['#f97316', '#fbbf24', '#38bdf8', '#22c55e'];

    function hexToRgba(hex, alpha) {
        const normalized = hex.replace('#', '');
        const bigint = parseInt(normalized, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    let cachedGradient = null;
    let cachedGradientKey = '';

    function invalidateGradient() {
        cachedGradient = null;
        cachedGradientKey = '';
    }

    function resizeCanvas() {
        const currentSizingElement = layoutHost || document.body;
        if (!currentSizingElement) {
            return;
        }

        const rect = currentSizingElement.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);

        state.viewportWidth = width;
        state.viewportHeight = height;
        state.devicePixelRatio = pixelRatio;

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * pixelRatio);
        canvas.height = Math.floor(height * pixelRatio);

        if (ctx) {
            ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        invalidateGradient();

        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, showTrail: false, phase: state.count });
        }
    }

    window.addEventListener('resize', resizeCanvas, { passive: true });

    function updateMotionPreference(event) {
        state.prefersReducedMotion = event.matches;
        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, showTrail: false, phase: state.count });
        }
    }

    const motionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    if (motionQuery) {
        state.prefersReducedMotion = motionQuery.matches;
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', updateMotionPreference);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(updateMotionPreference);
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function playTone({ isCompletionBell = false } = {}) {
        if (!state.soundEnabled || !audioContext) return;
        try {
            const gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);

            if (isCompletionBell) {
                const now = audioContext.currentTime;
                const bellNotes = [880, 1174.66];

                gainNode.gain.setValueAtTime(0.0001, now);
                gainNode.gain.exponentialRampToValueAtTime(0.45, now + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

                bellNotes.forEach((frequency, index) => {
                    const oscillator = audioContext.createOscillator();
                    oscillator.type = index === 0 ? 'sine' : 'triangle';
                    oscillator.frequency.setValueAtTime(frequency, now);
                    oscillator.connect(gainNode);
                    oscillator.start(now);
                    oscillator.stop(now + 1.2);
                });
            } else {
                const oscillator = audioContext.createOscillator();
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(528, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.01);
                gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);
                oscillator.connect(gainNode);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.3);
            }
        } catch (e) {
            console.error('Error playing tone:', e);
        }
    }

    let animationFrameId;

    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake lock is active');
            } catch (err) {
                console.error('Failed to acquire wake lock:', err);
            }
        } else {
            console.log('Wake Lock API not supported');
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release()
                .then(() => {
                    wakeLock = null;
                    console.log('Wake lock released');
                })
                .catch(err => {
                    console.error('Failed to release wake lock:', err);
                });
        }
    }

    function togglePlay() {
        // Read time limit directly from input before DOM is rebuilt
        const timeLimitInput = document.getElementById('time-limit');
        if (timeLimitInput) {
            state.timeLimit = timeLimitInput.value.replace(/[^0-9]/g, '');
        }
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed');
                });
            }
            state.hasStarted = true;
            state.totalTime = 0;
            const phases = getCurrentPhases();
            state.countdown = Math.ceil(phases[0].duration);
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.readyToEndAfterExhale = false;
            state.completedRounds = 0;
            // For 4-7-8, treat timeLimit as rounds instead of minutes
            if (state.exerciseType === 'fourSevenEight' && state.timeLimit) {
                state.targetRounds = parseInt(state.timeLimit) || 0;
            } else {
                state.targetRounds = 0;
            }
            state.pulseStartTime = performance.now();
            state.startTime = performance.now();
            playTone();
            animate();
            requestWakeLock();
        } else {
            cancelAnimationFrame(animationFrameId);
            state.totalTime = 0;
            const phases = getCurrentPhases();
            state.countdown = Math.ceil(phases[0].duration);
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.readyToEndAfterExhale = false;
            state.hasStarted = false;
            state.targetRounds = 0;
            state.completedRounds = 0;
            invalidateGradient();
            drawScene({ progress: 0, showTrail: false, phase: state.count });
            state.pulseStartTime = null;
            state.startTime = null;
            releaseWakeLock();
        }
        render();
    }

    function resetToStart() {
        state.isPlaying = false;
        state.totalTime = 0;
        const phases = getCurrentPhases();
        state.countdown = Math.ceil(phases[0].duration);
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimit = '';
        state.timeLimitReached = false;
        state.readyToEndAfterExhale = false;
        state.pulseStartTime = null;
        state.hasStarted = false;
        state.startTime = null;
        state.targetRounds = 0;
        state.completedRounds = 0;
        cancelAnimationFrame(animationFrameId);
        invalidateGradient();
        drawScene({ progress: 0, showTrail: false, phase: state.count });
        releaseWakeLock();
        render();
    }

    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        saveSettings();
        render();
    }

    function handleTimeLimitChange(e) {
        state.timeLimit = e.target.value.replace(/[^0-9]/g, '');
    }

    function setExerciseType(type) {
        state.exerciseType = type;
        const exercise = exerciseTypes[type];
        if (exercise.hasPhaseTimeSlider) {
            state.phaseTime = exercise.phaseTimeRange.default;
        }
        if (type === 'longExhale') {
            state.exhaleDuration = exercise.phaseTimeRange.default;
        }
        saveSettings();
        render();
    }

    function startWithPreset(minutes) {
        state.timeLimit = minutes.toString();
        state.targetRounds = 0;
        state.completedRounds = 0;
        state.isPlaying = true;
        state.totalTime = 0;
        const phases = getCurrentPhases();
        state.countdown = Math.ceil(phases[0].duration);
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimitReached = false;
        state.readyToEndAfterExhale = false;
        state.pulseStartTime = performance.now();
        state.hasStarted = true;
        state.startTime = performance.now();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed');
            });
        }
        playTone();
        animate();
        requestWakeLock();
        render();
    }

    function startWithRounds(rounds) {
        state.targetRounds = rounds;
        state.completedRounds = 0;
        state.timeLimit = '';
        state.isPlaying = true;
        state.totalTime = 0;
        const phases = getCurrentPhases();
        state.countdown = Math.ceil(phases[0].duration);
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimitReached = false;
        state.readyToEndAfterExhale = false;
        state.pulseStartTime = performance.now();
        state.hasStarted = true;
        state.startTime = performance.now();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed');
            });
        }
        playTone();
        animate();
        requestWakeLock();
        render();
    }

    function drawScene({ progress = 0, phase = state.count, showTrail = state.isPlaying, timestamp = performance.now() } = {}) {
        if (!ctx) return;

        const width = state.viewportWidth || canvas.clientWidth || canvas.width;
        const height = state.viewportHeight || canvas.clientHeight || canvas.height;
        if (!width || !height) {
            return;
        }

        const scale = state.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        ctx.clearRect(0, 0, width, height);

        if (!state.hasStarted && !state.sessionComplete) {
            invalidateGradient();
            ctx.restore();
            return;
        }

        const clampedProgress = Math.max(0, Math.min(1, progress));
        const easedProgress = 0.5 - (Math.cos(Math.PI * clampedProgress) / 2);
        const baseSize = Math.min(width, height) * 0.6;
        const topMargin = 20;
        const sizeWithoutBreath = Math.min(baseSize, height - topMargin * 2);
        const verticalOffset = Math.min(height * 0.18, 110);
        const preferredTop = height / 2 + verticalOffset - sizeWithoutBreath / 2;
        const top = Math.max(topMargin, Math.min(preferredTop, height - sizeWithoutBreath - topMargin));
        const left = (width - sizeWithoutBreath) / 2;

        const now = timestamp;
        const allowMotion = !state.prefersReducedMotion;

        // Get current phase info
        const phases = getCurrentPhases();
        const currentPhaseName = phases[phase]?.name || 'Inhale';

        let breathInfluence = 0;
        if (currentPhaseName === 'Inhale') {
            breathInfluence = easedProgress;
        } else if (currentPhaseName === 'Exhale') {
            breathInfluence = 1 - easedProgress;
        } else if (allowMotion) {
            // Hold or Wait phases
            breathInfluence = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(now / 350));
        } else {
            breathInfluence = 0.3;
        }

        let pulseBoost = 0;
        if (allowMotion && state.pulseStartTime !== null) {
            const pulseElapsed = (now - state.pulseStartTime) / 1000;
            if (pulseElapsed < 0.6) {
                pulseBoost = Math.sin((pulseElapsed / 0.6) * Math.PI);
            }
        }

        const size = sizeWithoutBreath * (1 + 0.08 * breathInfluence + 0.03 * pulseBoost);
        const adjustedLeft = left + (sizeWithoutBreath - size) / 2;
        const adjustedTop = top + (sizeWithoutBreath - size) / 2;

        let accentColor = getPhaseColor(phase);
        if (state.sessionComplete) {
            accentColor = '#4ade80';
        }

        const gradientKey = `${Math.round(size * 100)}-${accentColor}-${Math.round(adjustedLeft)}-${Math.round(adjustedTop)}`;
        if (!cachedGradient || cachedGradientKey !== gradientKey) {
            cachedGradient = ctx.createRadialGradient(
                adjustedLeft + size / 2,
                adjustedTop + size / 2,
                size * 0.2,
                adjustedLeft + size / 2,
                adjustedTop + size / 2,
                size
            );
            cachedGradient.addColorStop(0, hexToRgba(accentColor, 0.18));
            cachedGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            cachedGradientKey = gradientKey;
        }
        ctx.fillStyle = cachedGradient;
        ctx.fillRect(0, 0, width, height);

        ctx.restore();
    }

    function updateCanvasVisibility() {
        const shouldShow = state.isPlaying || state.sessionComplete;
        canvas.classList.toggle('is-visible', shouldShow);
    }

    function animate() {
        if (!state.isPlaying) return;

        const now = performance.now();
        const phases = getCurrentPhases();
        const totalCycleTime = getTotalCycleTime();
        const exhaleIndex = phases.findIndex(p => p.name === 'Exhale');

        // Calculate absolute timing
        const totalElapsed = (now - state.startTime) / 1000;
        const newTotalTime = Math.floor(totalElapsed);

        // Find current phase based on cycle position
        const cycleElapsed = totalElapsed % totalCycleTime;

        let accumulatedTime = 0;
        let newCount = 0;
        let phaseStartTime = 0;

        for (let i = 0; i < phases.length; i++) {
            if (cycleElapsed >= accumulatedTime && cycleElapsed < accumulatedTime + phases[i].duration) {
                newCount = i;
                phaseStartTime = accumulatedTime;
                break;
            }
            accumulatedTime += phases[i].duration;
        }

        const currentPhaseDuration = phases[newCount].duration;
        const phaseElapsed = cycleElapsed - phaseStartTime;
        const progress = phaseElapsed / currentPhaseDuration;
        const remaining = currentPhaseDuration - phaseElapsed;
        const hasHalfSecond = currentPhaseDuration % 1 !== 0;
        let newCountdown;
        if (hasHalfSecond && remaining > Math.floor(currentPhaseDuration)) {
            newCountdown = currentPhaseDuration;
        } else {
            newCountdown = Math.ceil(remaining);
        }

        let needsRender = false;

        if (newTotalTime !== state.totalTime) {
            state.totalTime = newTotalTime;
            needsRender = true;
        }

        const previousCount = state.count;
        state.count = newCount;

        const isPhaseTransition = state.count !== previousCount;
        const exhaleJustCompleted = isPhaseTransition && exhaleIndex >= 0 && previousCount === exhaleIndex;

        const isFinalTimedTransition = exhaleJustCompleted && state.readyToEndAfterExhale;

        if (isPhaseTransition) {
            state.pulseStartTime = now;
            playTone({ isCompletionBell: isFinalTimedTransition });
            needsRender = true;
        }

        // Track completed rounds for 4-7-8 mode
        // A round is complete when we transition from last phase (exhale) back to first phase (inhale)
        if (isPhaseTransition && previousCount === phases.length - 1 && newCount === 0) {
            state.completedRounds++;
            needsRender = true;

            // For 4-7-8 with target rounds, check if we've completed all rounds.
            // Mark it to end on this exhale completion transition.
            if (state.exerciseType === 'fourSevenEight' && state.targetRounds > 0 && state.completedRounds >= state.targetRounds) {
                state.readyToEndAfterExhale = true;
            }
        }

        const parsedLimit = Number.parseInt(state.timeLimit, 10);
        const timeLimitSeconds = Number.isFinite(parsedLimit) ? parsedLimit * 60 : 0;
        if (state.timeLimit && !state.timeLimitReached && totalElapsed >= timeLimitSeconds) {
            state.timeLimitReached = true;
            state.readyToEndAfterExhale = true;
            needsRender = true;
        }

        // All exercise endings are aligned to exhale completion.
        if (exhaleJustCompleted && state.readyToEndAfterExhale) {
            state.sessionComplete = true;
            state.isPlaying = false;
            state.hasStarted = false;
            state.readyToEndAfterExhale = false;
            cancelAnimationFrame(animationFrameId);
            releaseWakeLock();
            drawScene({ progress: 1, showTrail: false, phase: exhaleIndex >= 0 ? exhaleIndex : previousCount });
            needsRender = true;
        }

        if (newCountdown !== state.countdown) {
            state.countdown = newCountdown;
            needsRender = true;
        }

        drawScene({ progress, timestamp: now });

        if (needsRender) {
            render();
        }

        if (state.isPlaying) {
            animationFrameId = requestAnimationFrame(animate);
        }
    }


    function render() {
        const exercise = exerciseTypes[state.exerciseType];
        const phases = getCurrentPhases();

        let html = `
            <h1>${exercise.name}</h1>
        `;

        if (state.isPlaying) {
            // Timer display - show rounds for 4-7-8, time for others
            if (state.exerciseType === 'fourSevenEight' && state.targetRounds > 0) {
                html += `<div class="timer">Round ${state.completedRounds + 1} of ${state.targetRounds}</div>`;
            } else {
                html += `<div class="timer">Total Time: ${formatTime(state.totalTime)}</div>`;
            }

            html += `
                <div class="countdown">${state.countdownEnabled ? state.countdown : '&nbsp;'}</div>
                <div class="instruction">${getInstruction(state.count)}</div>
            `;
        } else if (state.sessionComplete) {
            html += `
                <div class="session-complete-container">
                    <div class="session-complete">
                        Session Complete! 🎉
                    </div>
                    <button id="reset-button" class="glass-button reset-button session-complete-reset">
                        ${icons.rotateCcw}
                        Reset
                    </button>
                </div>
            `;
        } else {
            html += `<div class="exercise-selector">`;
            Object.entries(exerciseTypes).forEach(([key, ex]) => {
                html += `
                    <button class="exercise-button ${state.exerciseType === key ? 'active' : ''}" data-exercise="${key}">
                        ${ex.name}
                    </button>
                `;
            });
            html += `</div>`;

            html += `<p class="exercise-description">${exercise.description}</p>`;

            html += `
                <div class="controls">
                    <div class="toggle-group">
                        <input type="checkbox" id="sound-toggle" ${state.soundEnabled ? 'checked' : ''}>
                        <label for="sound-toggle">
                            ${state.soundEnabled ? icons.volume2 : icons.volumeX}
                            Sound ${state.soundEnabled ? 'On' : 'Off'}
                        </label>
                    </div>
                    <div class="toggle-group">
                        <input type="checkbox" id="countdown-toggle" ${state.countdownEnabled ? 'checked' : ''}>
                        <label for="countdown-toggle">
                            ${icons.clock}
                            Countdown ${state.countdownEnabled ? 'On' : 'Off'}
                        </label>
                    </div>
                </div>

                <div class="time-limit-input-group floating-label-input">
                    <input
                        type="text"
                        id="time-limit"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        value="${state.timeLimit}"
                        placeholder="${state.exerciseType === 'fourSevenEight' ? 'Rounds' : 'Time limit (minutes)'}"
                    />
                    <label for="time-limit">${state.exerciseType === 'fourSevenEight' ? 'Rounds (optional)' : 'Minutes (optional)'}</label>
                </div>
            `;
        }

        html += `
            <div class="button-container ${state.sessionComplete ? 'session-complete-actions' : ''}">
                ${!state.sessionComplete ? `
                    <button id="play-pause-button" class="glass-button play-pause-button ${state.isPlaying ? 'pause' : 'play'}">
                        ${state.isPlaying ? icons.pause : icons.play}
                        ${state.isPlaying ? 'Pause' : 'Start'}
                    </button>
                ` : ''}
                ${!state.isPlaying && !state.sessionComplete ? `
                    <button id="reset-button" class="glass-button reset-button">
                        ${icons.rotateCcw}
                        Reset
                    </button>
                ` : ''}
            </div>
        `;

        if (!state.isPlaying && !state.sessionComplete && exercise.hasPhaseTimeSlider) {
            const range = exercise.phaseTimeRange;
            const currentValue = state.exerciseType === 'longExhale' ? state.exhaleDuration : state.phaseTime;
            html += `
                <div class="phase-time-slider-group">
                    <label for="phase-time-slider">${exercise.phaseTimeLabel} (seconds): <span id="phase-time-value">${currentValue}</span></label>
                    <input type="range" id="phase-time-slider" min="${range.min}" max="${range.max}" step="${range.step}" value="${currentValue}">
                </div>
            `;
        }

        if (!state.isPlaying && !state.sessionComplete) {
            html += `<div class="quick-start-presets"><div class="preset-label">Quick Start:</div>`;
            const presets = [];

            if (state.exerciseType === 'fourSevenEight') {
                // Round-based presets for 4-7-8
                presets.push(
                    { label: '4 rounds', rounds: 4 },
                    { label: '6 rounds', rounds: 6 },
                    { label: '8 rounds', rounds: 8 }
                );
            } else {
                // Minutes-based presets for other exercises
                presets.push(
                    { label: '2 min', minutes: 2 },
                    { label: '5 min', minutes: 5 },
                    { label: '10 min', minutes: 10 }
                );
            }

            presets.forEach((preset) => {
                if (state.exerciseType === 'fourSevenEight') {
                    html += `<button class="preset-button" data-rounds="${preset.rounds}">${icons.hash} ${preset.label}</button>`;
                } else {
                    html += `<button class="preset-button" data-minutes="${preset.minutes}">${icons.clock} ${preset.label}</button>`;
                }
            });
            html += `</div>`;
        }

        app.innerHTML = html;
        updateCanvasVisibility();

        const playPauseButton = document.getElementById('play-pause-button');
        if (playPauseButton) {
            playPauseButton.addEventListener('click', togglePlay);
        }

        const resetButton = document.getElementById('reset-button');
        if (resetButton) {
            resetButton.addEventListener('click', resetToStart);
        }

        if (!state.isPlaying && !state.sessionComplete) {
            document.getElementById('sound-toggle').addEventListener('change', toggleSound);
            document.getElementById('countdown-toggle').addEventListener('change', toggleCountdown);
            document.getElementById('time-limit').addEventListener('input', handleTimeLimitChange);

            // Exercise selector buttons
            document.querySelectorAll('.exercise-button').forEach(btn => {
                btn.addEventListener('click', () => {
                    setExerciseType(btn.dataset.exercise);
                });
            });

            // Phase time slider
            const phaseTimeSlider = document.getElementById('phase-time-slider');
            if (phaseTimeSlider) {
                phaseTimeSlider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    if (state.exerciseType === 'longExhale') {
                        state.exhaleDuration = value;
                    } else {
                        state.phaseTime = value;
                    }
                    document.getElementById('phase-time-value').textContent = value;
                    saveSettings();
                });
            }

            // Quick start preset buttons
            document.querySelectorAll('.preset-button').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (state.exerciseType === 'fourSevenEight') {
                        const rounds = parseInt(btn.dataset.rounds, 10);
                        if (Number.isFinite(rounds) && rounds > 0) {
                            startWithRounds(rounds);
                        }
                    } else {
                        const minutes = parseInt(btn.dataset.minutes, 10);
                        if (Number.isFinite(minutes) && minutes > 0) {
                            startWithPreset(minutes);
                        }
                    }
                });
            });
        }
    }

    resizeCanvas();
    render();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js').then(
                registration => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                },
                err => {
                    console.log('ServiceWorker registration failed: ', err);
                }
            );
        });
    }
});