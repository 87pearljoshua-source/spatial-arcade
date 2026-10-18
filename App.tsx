/**
 * Spatial Finger Tracker - Lightgun Phone Controller
 * The phone is ONLY a gun controller. The game is played and shown ONLY on the TV.
 *
 * Architecture:
 * PHONE CAMERA (Rear) -> OPTICAL FIXED SCREEN-BORDER DETECTION (320x240)
 * -> 4-CORNER SCREEN QUADRILATERAL -> HOMOGRAPHY / PROJECTIVE MAPPING
 * -> NORMALIZED AIM X/Y -> WSS TRANSPORT -> RECEIVER / FIRE TV
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Tv, 
  Settings, 
  RefreshCw, 
  Zap, 
  Home, 
  Crosshair, 
  Volume2, 
  VolumeX, 
  CheckCircle2, 
  XCircle, 
  Sliders, 
  Activity, 
  RotateCcw, 
  Play, 
  Square,
  BarChart2,
  X,
  Maximize,
  Minimize,
  Download
} from 'lucide-react';
import { 
  detectBorderQuad, 
  CV_WIDTH, 
  CV_HEIGHT, 
  type Point, 
  type QuadCorners, 
  type DetectionResult 
} from './cv/borderDetection';
import { 
  mapCameraToTv, 
  runHomographySelfTest, 
  type HomographyResult, 
  type SelfTestResult 
} from './cv/homography';
import { FireTvReceiver } from './components/FireTvReceiver';
import { ResolutionBenchmarkModal } from './components/ResolutionBenchmarkModal';
import type { TrackingStatus } from './types';

// Persistent storage keys
const STORAGE_KEY_RELAY_URL = 'sft_relay_url';
const STORAGE_KEY_ROOM_CODE = 'sft_room_code';
const STORAGE_KEY_AIM_OFFSET = 'sft_aim_offset';
const STORAGE_KEY_THRESHOLD = 'sft_threshold';
const STORAGE_KEY_SMOOTHING = 'sft_smoothing_alpha';
const STORAGE_KEY_SOUND = 'sft_sound_enabled';

export default function App() {
  // Fire TV Receiver Mode Check (URL ?mode=tv or /tv)
  const [isTvMode, setIsTvMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'tv' || window.location.pathname === '/tv';
  });

  // Screen orientation tracking
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);

  // Fullscreen state for Android immersive mode
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {}
  }, []);

  // Status Line: "NO TV" | "TRACKING" | "LOST"
  const [trackerState, setTrackerState] = useState<TrackingStatus>('NO TV');
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [cameraState, setCameraState] = useState<'off' | 'requesting' | 'on' | 'error'>('off');
  const [facingMode] = useState<'environment' | 'user'>('environment'); // Rear camera
  const [useSimulatedFeed, setUseSimulatedFeed] = useState<boolean>(false);

  // Requirement 5: Sound ON/OFF switch in Settings (default ON, saved in localStorage)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SOUND);
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_SOUND, String(soundEnabled)); } catch {}
  }, [soundEnabled]);

  // Option to show live camera feed in play background (default OFF, saved in localStorage)
  const [showCameraBg, setShowCameraBg] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sft_show_camera_bg');
      if (saved !== null) return saved === 'true';
    } catch {}
    return false;
  });

  useEffect(() => {
    try { localStorage.setItem('sft_show_camera_bg', String(showCameraBg)); } catch {}
  }, [showCameraBg]);

  // Calibration parameters (Adjustable ONLY inside Settings)
  const [calibrationMode, setCalibrationMode] = useState<'auto' | 'manual'>('auto');
  const [threshold, setThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_THRESHOLD);
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val >= 40 && val <= 240) return val;
      }
    } catch {}
    return 160;
  });
  const [showThresholdMask, setShowThresholdMask] = useState<boolean>(false);
  const [smoothingAlpha, setSmoothingAlpha] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SMOOTHING);
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val >= 0.05 && val <= 0.95) return val;
      }
    } catch {}
    return 0.5;
  });

  // Aim Offset (Adjustable ONLY inside Settings)
  const [aimOffset, setAimOffset] = useState<Point>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_AIM_OFFSET);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch {}
    return { x: 0, y: 0 };
  });
  const [isSettingAimPoint, setIsSettingAimPoint] = useState<boolean>(false);

  // Persist parameters
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_AIM_OFFSET, JSON.stringify(aimOffset)); } catch {}
  }, [aimOffset]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_THRESHOLD, String(threshold)); } catch {}
  }, [threshold]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_SMOOTHING, String(smoothingAlpha)); } catch {}
  }, [smoothingAlpha]);

  // WebSocket Settings
  const [relayUrl, setRelayUrl] = useState<string>(() => {
    const urlParam = new URLSearchParams(window.location.search).get('relay');
    if (urlParam && urlParam.trim()) {
      try { localStorage.setItem(STORAGE_KEY_RELAY_URL, urlParam.trim()); } catch {}
      return urlParam.trim();
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RELAY_URL);
      if (saved && saved.trim()) return saved.trim();
    } catch {}
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  });
  const [roomCode, setRoomCode] = useState<string>(() => {
    const urlParam = new URLSearchParams(window.location.search).get('room');
    if (urlParam && urlParam.trim()) {
      const code = urlParam.trim().toUpperCase().slice(0, 4);
      try { localStorage.setItem(STORAGE_KEY_ROOM_CODE, code); } catch {}
      return code;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ROOM_CODE);
      if (saved && saved.trim()) return saved.trim().toUpperCase().slice(0, 4);
    } catch {}
    return 'TV01';
  });

  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [processingTimeMs, setProcessingTimeMs] = useState<number>(0);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_RELAY_URL, relayUrl); } catch {}
  }, [relayUrl]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_ROOM_CODE, roomCode); } catch {}
  }, [roomCode]);

  // Requirement 3: AIM ASSIST switch in Settings (OFF by default)
  const [aimAssist, setAimAssist] = useState<boolean>(false);
  const aimAssistRef = useRef<boolean>(false);
  useEffect(() => {
    aimAssistRef.current = aimAssist;
  }, [aimAssist]);

  // Requirement 6: Follow messages from the TV
  // The TV sends {"type":"state","scene":"menu" or "play","ammo":9,"mag":30,"assist":false,"reloading":false,"hits":3,"shots":8}
  const [tvState, setTvState] = useState<{
    scene: 'menu' | 'play';
    ammo: number;
    mag: number;
    assist: boolean;
    reloading: boolean;
    hits: number;
    shots: number;
  }>({
    scene: 'play',
    ammo: 30,
    mag: 30,
    assist: false,
    reloading: false,
    hits: 0,
    shots: 0
  });
  const tvStateRef = useRef(tvState);
  useEffect(() => {
    tvStateRef.current = tvState;
  }, [tvState]);

  // Settings Modal / Debug view toggle
  const [showSettingsPanel, setShowSettingsPanel] = useState<boolean>(false);
  const showSettingsPanelRef = useRef<boolean>(false);
  useEffect(() => {
    showSettingsPanelRef.current = showSettingsPanel;
  }, [showSettingsPanel]);

  // Gamepad state & tracking
  const [gamepadStatus, setGamepadStatus] = useState<{ connected: boolean; name: string }>({
    connected: false,
    name: ''
  });
  const gamepadStatusRef = useRef(gamepadStatus);
  useEffect(() => {
    gamepadStatusRef.current = gamepadStatus;
  }, [gamepadStatus]);

  const prevGamepadButtonsRef = useRef<boolean[]>([]);
  const gamepadTriggerHeldSetRef = useRef<Set<number>>(new Set());
  const isTouchTriggerDownRef = useRef<boolean>(false);
  const isKeyTriggerDownRef = useRef<boolean>(false);
  const isTouchHomeHeldRef = useRef<boolean>(false);
  const isGamepadHomeHeldRef = useRef<boolean>(false);
  const pollGamepadRef = useRef<() => void>(() => {});

  // Web Bluetooth Blaster state
  const [blasterStatus, setBlasterStatus] = useState<string>('disconnected');

  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null);
  const [showSelfTestModal, setShowSelfTestModal] = useState<boolean>(false);
  const [showBenchmarkModal, setShowBenchmarkModal] = useState<boolean>(false);

  // Live coordinates (displayed ONLY in Settings)
  const [debugAimU, setDebugAimU] = useState<number>(0.5);
  const [debugAimV, setDebugAimV] = useState<number>(0.5);
  const [debugIsInside, setDebugIsInside] = useState<boolean>(true);

  // Manual Corners (Adjusted ONLY in Settings)
  const [manualCorners, setManualCorners] = useState<QuadCorners>({
    tl: { x: 0.15, y: 0.15 },
    tr: { x: 0.85, y: 0.15 },
    br: { x: 0.85, y: 0.85 },
    bl: { x: 0.15, y: 0.85 }
  });
  const [activeHandle, setActiveHandle] = useState<'tl' | 'tr' | 'br' | 'bl' | null>(null);

  // Independent pointer tracking: keep set of active finger pointer IDs
  const activePointersRef = useRef<Set<number>>(new Set());
  const triggerPointerIdRef = useRef<number | null>(null);
  const reloadPointerIdRef = useRef<number | null>(null);

  // Trigger state & Auto-repeat timers
  const isFiringRef = useRef<boolean>(false);
  const [isFiringState, setIsFiringState] = useState<boolean>(false);
  const fullAutoDelayTimerRef = useRef<number | null>(null);
  const fullAutoIntervalRef = useRef<number | null>(null);

  // Home Button 500 ms Hold state
  const homeHoldTimerRef = useRef<number | null>(null);
  const homeHoldAnimRef = useRef<number | null>(null);
  const homePointerIdRef = useRef<number | null>(null);
  const [homeProgress, setHomeProgress] = useState<number>(0);

  // DOM & CV References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const settingsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const settingsBoxRef = useRef<HTMLDivElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // High performance tracking state
  const trackerStateRef = useRef<TrackingStatus>('NO TV');
  const hasEverDetectedRef = useRef<boolean>(false);
  const lastGoodCornersRef = useRef<{ corners: QuadCorners; time: number } | null>(null);
  const smoothedCornersRef = useRef<QuadCorners | null>(null);
  const lastAimSendTimeRef = useRef<number>(0);
  const sentLostRef = useRef<boolean>(true);
  const msgSeqRef = useRef<number>(0);

  // Simulated TV feed refs
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const simAnimIdRef = useRef<number | null>(null);
  const simStreamRef = useRef<MediaStream | null>(null);

  // ==========================================
  // REQUIREMENT 5: AUDIO SYNTHESIS (Web Audio API)
  // ==========================================
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioCtxRef.current = new AudioCtx();
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  // 1. shot: 90 ms burst of white noise with fast exponential fade-out + 60 Hz sine thump lasting 70 ms
  const playShotSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Master gain about 0.25
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.25, now);
      masterGain.connect(ctx.destination);

      // Noise burst (90 ms)
      const noiseDuration = 0.09;
      const noiseFrames = Math.floor(ctx.sampleRate * noiseDuration);
      const noiseBuffer = ctx.createBuffer(1, noiseFrames, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseFrames; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(1.0, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);
      noiseSource.connect(noiseGain);
      noiseGain.connect(masterGain);
      noiseSource.start(now);
      noiseSource.stop(now + noiseDuration);

      // 60 Hz sine thump (70 ms)
      const thumpDuration = 0.07;
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now);
      oscGain.gain.setValueAtTime(1.0, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + thumpDuration);
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + thumpDuration);
    } catch {}
  }, [soundEnabled, getAudioContext]);

  // 2. dry click: 15 ms noise tick, no shot sound
  const playDryClickSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.25, now);
      masterGain.connect(ctx.destination);

      const tickDuration = 0.015;
      const frames = Math.floor(ctx.sampleRate * tickDuration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(3200, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + tickDuration);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      src.start(now);
      src.stop(now + tickDuration);
    } catch {}
  }, [soundEnabled, getAudioContext]);

  // 3. reload: short metallic clack (30 ms noise burst), second higher one when reloading finishes
  const playReloadClack = useCallback((higher = false) => {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.25, now);
      masterGain.connect(ctx.destination);

      const duration = 0.03;
      const frames = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(higher ? 3400 : 1800, now);
      filter.Q.setValueAtTime(4.0, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      src.start(now);
      src.stop(now + duration);
    } catch {}
  }, [soundEnabled, getAudioContext]);

  // Toggle Aim Assist
  const toggleAimAssist = useCallback((forcedVal?: boolean) => {
    setAimAssist(prev => {
      const next = typeof forcedVal === 'boolean' ? forcedVal : !prev;
      aimAssistRef.current = next;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'mode', assist: next }));
      }
      return next;
    });
  }, []);

  // Screen Wake Lock API (fails silently)
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    };

    requestWakeLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      try {
        wakeLock?.release();
      } catch {}
    };
  }, []);

  // Orientation tracking
  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // ==========================================
  // WEBSOCKET RELAY & PROTOCOL HANDLING
  // ==========================================
  const getFullWsUrl = useCallback((base: string, code: string) => {
    const cleanBase = base.trim().replace(/\/+$/, '');
    const cleanCode = code.trim().toUpperCase().slice(0, 4);
    const sep = cleanBase.includes('?') ? '&' : '?';
    return `${cleanBase}${sep}room=${encodeURIComponent(cleanCode)}&role=phone`;
  }, []);

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let pingTimer: any = null;
    let reconnectTimer: any = null;

    const connect = () => {
      if (!active) return;
      setConnectionStatus('reconnecting');
      try {
        const url = getFullWsUrl(relayUrl, roomCode);
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!active) return;
          setConnectionStatus('connected');

          if (ws && ws.readyState === WebSocket.OPEN) {
            // Send fire_up on reconnect
            ws.send(JSON.stringify({ type: 'fire_up' }));
            // Send current assist mode on (re)open
            ws.send(JSON.stringify({ type: 'mode', assist: aimAssistRef.current }));
          }

          // Ping every 2 seconds
          pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
            }
          }, 2000);
        };

        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong' && typeof data.t === 'number') {
              setRttMs(Date.now() - data.t);
            } else if (data.type === 'shot') {
              // Requirement 6: vibrate [20,40,50] ONLY if no finger is currently down. For hit:false, do nothing.
              const noFingerDown = activePointersRef.current.size === 0 && !isFiringRef.current;
              if (data.hit && noFingerDown) {
                try {
                  if ('vibrate' in navigator) {
                    navigator.vibrate([20, 40, 50]);
                  }
                } catch {}
              }
              if (typeof data.ammo === 'number') {
                setTvState(prev => ({ ...prev, ammo: data.ammo }));
              }
            } else if (data.type === 'lock') {
              // Requirement 6: vibrate navigator.vibrate(15) ONLY if no finger is currently down.
              const noFingerDown = activePointersRef.current.size === 0 && !isFiringRef.current;
              if (data.locked && noFingerDown) {
                try {
                  if ('vibrate' in navigator) {
                    navigator.vibrate(15);
                  }
                } catch {}
              }
            } else if (data.type === 'reload') {
              // Requirement 6: vibrate [30,60,30] and play the reload clack.
              try {
                if ('vibrate' in navigator) {
                  navigator.vibrate([30, 60, 30]);
                }
              } catch {}
              playReloadClack(false);
              setTvState(prev => ({ ...prev, reloading: true }));
            } else if (data.type === 'state') {
              // Requirement 6: The TV sends {"type":"state","scene":"menu" or "play","ammo":9,"mag":30,"assist":false,"reloading":false,"hits":3,"shots":8}
              const prevReloading = tvStateRef.current.reloading;
              const nextReloading = typeof data.reloading === 'boolean' ? data.reloading : prevReloading;

              // Sound transition: higher clack when reloading:true becomes reloading:false
              if (prevReloading && !nextReloading) {
                playReloadClack(true);
              }

              // Stop auto-repeat if ammo is 0 or reloading is true
              if ((typeof data.ammo === 'number' && data.ammo <= 0) || nextReloading) {
                if (fullAutoIntervalRef.current) {
                  clearInterval(fullAutoIntervalRef.current);
                  fullAutoIntervalRef.current = null;
                }
              }

              setTvState(prev => ({
                scene: data.scene === 'menu' ? 'menu' : 'play',
                ammo: typeof data.ammo === 'number' ? data.ammo : prev.ammo,
                mag: typeof data.mag === 'number' ? data.mag : prev.mag,
                assist: typeof data.assist === 'boolean' ? data.assist : prev.assist,
                reloading: nextReloading,
                hits: typeof data.hits === 'number' ? data.hits : prev.hits,
                shots: typeof data.shots === 'number' ? data.shots : prev.shots,
              }));

              // If TV assist differs from switch, update local switch
              if (typeof data.assist === 'boolean' && data.assist !== aimAssistRef.current) {
                setAimAssist(data.assist);
                aimAssistRef.current = data.assist;
              }
            } else if (data.type === 'hurt') {
              // Requirement 4: The TV may now send {"type":"hurt"} when the player is hit in Warehouse Run. Vibrate [60,40,60].
              try {
                if ('vibrate' in navigator) {
                  navigator.vibrate([60, 40, 60]);
                }
              } catch {}
            }
            // Ignore any message type not recognized
          } catch {}
        };

        ws.onclose = () => {
          if (!active) return;
          if (isFiringRef.current) {
            isFiringRef.current = false;
            setIsFiringState(false);
            if (fullAutoDelayTimerRef.current) clearTimeout(fullAutoDelayTimerRef.current);
            if (fullAutoIntervalRef.current) clearInterval(fullAutoIntervalRef.current);
          }
          setConnectionStatus('reconnecting');
          if (pingTimer) clearInterval(pingTimer);
          reconnectTimer = setTimeout(connect, 1000);
        };

        ws.onerror = () => {
          if (!active) return;
          if (isFiringRef.current) {
            isFiringRef.current = false;
            setIsFiringState(false);
            if (fullAutoDelayTimerRef.current) clearTimeout(fullAutoDelayTimerRef.current);
            if (fullAutoIntervalRef.current) clearInterval(fullAutoIntervalRef.current);
          }
          setConnectionStatus('reconnecting');
          try { ws?.close(); } catch {}
        };
      } catch {
        if (active) {
          setConnectionStatus('reconnecting');
          reconnectTimer = setTimeout(connect, 1000);
        }
      }
    };

    connect();

    return () => {
      active = false;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, [relayUrl, roomCode, getFullWsUrl, playReloadClack]);

  // ==========================================
  // UNIFIED TRIGGER, RELOAD & HOME ACTIONS
  // Supports touch, keyboard, and Bluetooth gamepad
  // ==========================================
  const startFiring = useCallback(() => {
    if (isFiringRef.current) return;
    isFiringRef.current = true;
    setIsFiringState(true);

    getAudioContext();

    // Send fire_down
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'fire_down' }));
    }

    // Instant local feedback (no waiting for the TV)
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(35);
      }
    } catch {}

    const currentTv = tvStateRef.current;
    if (currentTv.ammo === 0) {
      playDryClickSound();
    } else if (!currentTv.reloading) {
      playShotSound();
    }

    // Clear old timers
    if (fullAutoDelayTimerRef.current) clearTimeout(fullAutoDelayTimerRef.current);
    if (fullAutoIntervalRef.current) clearInterval(fullAutoIntervalRef.current);

    // Full-auto auto-repeat after 250ms every 110ms
    if (currentTv.ammo > 0 && !currentTv.reloading) {
      fullAutoDelayTimerRef.current = window.setTimeout(() => {
        fullAutoIntervalRef.current = window.setInterval(() => {
          if (!isFiringRef.current || tvStateRef.current.ammo <= 0 || tvStateRef.current.reloading) {
            if (fullAutoIntervalRef.current) {
              clearInterval(fullAutoIntervalRef.current);
              fullAutoIntervalRef.current = null;
            }
            return;
          }
          playShotSound();
          try {
            if ('vibrate' in navigator) {
              navigator.vibrate(35);
            }
          } catch {}
        }, 110);
      }, 250);
    }
  }, [getAudioContext, playDryClickSound, playShotSound]);

  const stopFiringIfAllReleased = useCallback(() => {
    const isAnyHeld =
      isTouchTriggerDownRef.current ||
      isKeyTriggerDownRef.current ||
      gamepadTriggerHeldSetRef.current.size > 0;

    if (isAnyHeld) return;

    if (fullAutoDelayTimerRef.current) {
      clearTimeout(fullAutoDelayTimerRef.current);
      fullAutoDelayTimerRef.current = null;
    }
    if (fullAutoIntervalRef.current) {
      clearInterval(fullAutoIntervalRef.current);
      fullAutoIntervalRef.current = null;
    }

    if (!isFiringRef.current) return;
    isFiringRef.current = false;
    setIsFiringState(false);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'fire_up' }));
    }
  }, []);

  const connectBlaster = useCallback(async () => {
    try {
      const nav = navigator as any;
      if (!nav.bluetooth) {
        setBlasterStatus('BLASTER NOT SUPPORTED IN THIS BROWSER');
        return;
      }
      setBlasterStatus('connecting...');
      const device = await nav.bluetooth.requestDevice({
        filters: [{ namePrefix: 'ARGUN' }],
        optionalServices: [0xFFF0]
      });
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService(0xFFF0);
      const characteristic = await service?.getCharacteristic(0xFFF3);
      await characteristic?.startNotifications();
      characteristic?.addEventListener('characteristicvaluechanged', (event: any) => {
        try {
          const value = event.target.value;
          const decoder = new TextDecoder('ascii');
          const text = decoder.decode(value).trim();
          if (text !== undefined) {
            startFiring();
            setTimeout(() => {
              stopFiringIfAllReleased();
            }, 120);
          }
        } catch {}
      });
      setBlasterStatus('connected');
      device.addEventListener('gattserverdisconnected', () => {
        setBlasterStatus('disconnected');
      });
    } catch (err: any) {
      setBlasterStatus('disconnected');
    }
  }, [startFiring, stopFiringIfAllReleased]);

  const handleTriggerDown = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      triggerPointerIdRef.current = pointerId;
      activePointersRef.current.add(pointerId);
    }
    isTouchTriggerDownRef.current = true;
    startFiring();
  }, [startFiring]);

  const handleTriggerUp = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      if (triggerPointerIdRef.current !== null && triggerPointerIdRef.current !== pointerId) {
        return;
      }
      triggerPointerIdRef.current = null;
      activePointersRef.current.delete(pointerId);
    }
    isTouchTriggerDownRef.current = false;
    stopFiringIfAllReleased();
  }, [stopFiringIfAllReleased]);

  const triggerReload = useCallback(() => {
    // In menu scene, RELOAD is dimmed and does nothing
    if (tvStateRef.current.scene === 'menu') return;

    getAudioContext();
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    } catch {}

    playReloadClack(false);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reload' }));
    }
  }, [getAudioContext, playReloadClack]);

  const handleReloadDown = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      reloadPointerIdRef.current = pointerId;
      activePointersRef.current.add(pointerId);
    }
    triggerReload();
  }, [triggerReload]);

  const handleReloadUp = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      reloadPointerIdRef.current = null;
      activePointersRef.current.delete(pointerId);
    }
  }, []);

  // Requirement 3: HOME button (Hold for 500 ms)
  const startHomeHold = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      homePointerIdRef.current = pointerId;
      activePointersRef.current.add(pointerId);
      isTouchHomeHeldRef.current = true;
    } else {
      isGamepadHomeHeldRef.current = true;
    }

    if (homeHoldTimerRef.current) return;

    getAudioContext();
    const startTime = performance.now();
    setHomeProgress(0);

    const updateProgress = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(100, (elapsed / 500) * 100);
      setHomeProgress(progress);
      if (elapsed < 500) {
        homeHoldAnimRef.current = requestAnimationFrame(updateProgress);
      }
    };
    homeHoldAnimRef.current = requestAnimationFrame(updateProgress);

    homeHoldTimerRef.current = window.setTimeout(() => {
      setHomeProgress(100);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'home' }));
      }
      try {
        if ('vibrate' in navigator) {
          navigator.vibrate(60);
        }
      } catch {}
      setTimeout(() => {
        setHomeProgress(0);
      }, 200);
    }, 500);
  }, [getAudioContext]);

  const cancelHomeHold = useCallback((pointerId?: number) => {
    if (pointerId !== undefined) {
      if (homePointerIdRef.current !== null && homePointerIdRef.current !== pointerId) {
        return;
      }
      activePointersRef.current.delete(pointerId);
      homePointerIdRef.current = null;
      isTouchHomeHeldRef.current = false;
    } else {
      isGamepadHomeHeldRef.current = false;
    }

    // If either touch or gamepad is still holding, don't cancel
    if (isTouchHomeHeldRef.current || isGamepadHomeHeldRef.current) {
      return;
    }

    if (homeHoldTimerRef.current) {
      clearTimeout(homeHoldTimerRef.current);
      homeHoldTimerRef.current = null;
    }
    if (homeHoldAnimRef.current) {
      cancelAnimationFrame(homeHoldAnimRef.current);
      homeHoldAnimRef.current = null;
    }
    setHomeProgress(0);
  }, []);

  // Global blur, visibility, and cancel listeners
  useEffect(() => {
    const handleBlurOrCancel = () => {
      isTouchTriggerDownRef.current = false;
      isKeyTriggerDownRef.current = false;
      isTouchHomeHeldRef.current = false;
      stopFiringIfAllReleased();
      cancelHomeHold();
      activePointersRef.current.clear();
    };

    window.addEventListener('blur', handleBlurOrCancel);
    window.addEventListener('pointercancel', handleBlurOrCancel);

    const handleVisibility = () => {
      if (document.hidden) {
        isTouchTriggerDownRef.current = false;
        isKeyTriggerDownRef.current = false;
        isTouchHomeHeldRef.current = false;
        stopFiringIfAllReleased();
        cancelHomeHold();
        activePointersRef.current.clear();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('blur', handleBlurOrCancel);
      window.removeEventListener('pointercancel', handleBlurOrCancel);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [stopFiringIfAllReleased, cancelHomeHold]);

  // Keyboard & Bluetooth Shutter controls (Volume Up / Media keys / Space / Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      
      const isTrig = (
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'AudioVolumeUp' ||
        e.key === 'VolumeUp' ||
        e.code === 'VolumeUp' ||
        e.key === 'PageUp' ||
        e.key === 'MediaPlayPause' ||
        e.key === '+' ||
        e.keyCode === 175 ||
        e.keyCode === 176 ||
        e.keyCode === 13
      );

      if (isTrig) {
        e.preventDefault();
        isKeyTriggerDownRef.current = true;
        startFiring();

        // Auto-release fallback for single-click Bluetooth camera shutters that only emit keydown
        setTimeout(() => {
          if (isKeyTriggerDownRef.current) {
            isKeyTriggerDownRef.current = false;
            stopFiringIfAllReleased();
          }
        }, 180);
      }

      if (e.key.toLowerCase() === 'r' && !e.repeat) {
        e.preventDefault();
        triggerReload();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const isTrig = (
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'AudioVolumeUp' ||
        e.key === 'VolumeUp' ||
        e.code === 'VolumeUp' ||
        e.key === 'PageUp' ||
        e.key === 'MediaPlayPause' ||
        e.key === '+' ||
        e.keyCode === 175 ||
        e.keyCode === 176 ||
        e.keyCode === 13
      );

      if (isTrig) {
        e.preventDefault();
        isKeyTriggerDownRef.current = false;
        stopFiringIfAllReleased();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startFiring, stopFiringIfAllReleased, triggerReload]);

  // ==========================================
  // BLUETOOTH GAMEPAD API INTEGRATION
  // ==========================================
  const pollGamepad = useCallback(() => {
    if (typeof navigator.getGamepads !== 'function') return;

    let gp: Gamepad | null = null;
    try {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const candidate = gamepads[i];
        if (candidate && candidate.connected) {
          gp = candidate;
          break;
        }
      }
    } catch {
      return;
    }

    // Handle gamepad presence
    if (!gp) {
      if (gamepadStatusRef.current.connected) {
        setGamepadStatus({ connected: false, name: '' });
        // If gamepad disconnects while trigger held, release trigger
        if (gamepadTriggerHeldSetRef.current.size > 0) {
          gamepadTriggerHeldSetRef.current.clear();
          stopFiringIfAllReleased();
        }
        if (isGamepadHomeHeldRef.current) {
          isGamepadHomeHeldRef.current = false;
          cancelHomeHold();
        }
        prevGamepadButtonsRef.current = [];
      }
      return;
    }

    const gpName = gp.id || 'Gamepad';
    if (!gamepadStatusRef.current.connected || gamepadStatusRef.current.name !== gpName) {
      setGamepadStatus({ connected: true, name: gpName });
    }

    // Work only on play screen, not while Settings is open
    if (showSettingsPanelRef.current) {
      if (gamepadTriggerHeldSetRef.current.size > 0) {
        gamepadTriggerHeldSetRef.current.clear();
        stopFiringIfAllReleased();
      }
      if (isGamepadHomeHeldRef.current) {
        isGamepadHomeHeldRef.current = false;
        cancelHomeHold();
      }
      const buttons = gp.buttons;
      const prev = prevGamepadButtonsRef.current;
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        prev[i] = !!(b && (b.pressed || b.value > 0.5));
      }
      return;
    }

    const buttons = gp.buttons;
    const prev = prevGamepadButtonsRef.current;

    const isBtnDown = (idx: number) => {
      const b = buttons[idx];
      return !!(b && (b.pressed || b.value > 0.5));
    };

    // 1. Trigger: button 7 (R2), button 5 (R1) or button 0 (A)
    const triggerButtons = [7, 5, 0];
    for (const btnIdx of triggerButtons) {
      const wasDown = !!prev[btnIdx];
      const isDown = isBtnDown(btnIdx);
      if (!wasDown && isDown) {
        gamepadTriggerHeldSetRef.current.add(btnIdx);
        startFiring();
      } else if (wasDown && !isDown) {
        gamepadTriggerHeldSetRef.current.delete(btnIdx);
        stopFiringIfAllReleased();
      }
      prev[btnIdx] = isDown;
    }

    // 2. Reload: button 2 (X), button 4 (L1) or button 6 (L2)
    const reloadButtons = [2, 4, 6];
    for (const btnIdx of reloadButtons) {
      const wasDown = !!prev[btnIdx];
      const isDown = isBtnDown(btnIdx);
      if (!wasDown && isDown) {
        triggerReload();
      }
      prev[btnIdx] = isDown;
    }

    // 3. Home: button 3 (Y) or button 9 (Start) held for 500 ms
    const homeButtons = [3, 9];
    const isAnyHomeDown = homeButtons.some(btnIdx => isBtnDown(btnIdx));
    const wasAnyHomeDown = homeButtons.some(btnIdx => !!prev[btnIdx]);

    if (!wasAnyHomeDown && isAnyHomeDown) {
      startHomeHold();
    } else if (wasAnyHomeDown && !isAnyHomeDown) {
      cancelHomeHold();
    }
    for (const btnIdx of homeButtons) {
      prev[btnIdx] = isBtnDown(btnIdx);
    }

    // 4. Menu choice: D-pad left (button 14) sends {"type":"menu_sel","v":0}. D-pad right (button 15) sends {"type":"menu_sel","v":1}
    const wasLeft = !!prev[14];
    const isLeft = isBtnDown(14);
    if (!wasLeft && isLeft) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'menu_sel', v: 0 }));
      }
    }
    prev[14] = isLeft;

    const wasRight = !!prev[15];
    const isRight = isBtnDown(15);
    if (!wasRight && isRight) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'menu_sel', v: 1 }));
      }
    }
    prev[15] = isRight;

    // Track other buttons
    for (let i = 0; i < buttons.length; i++) {
      if (prev[i] === undefined) {
        prev[i] = isBtnDown(i);
      }
    }
  }, [startFiring, stopFiringIfAllReleased, triggerReload, startHomeHold, cancelHomeHold]);

  // Keep pollGamepadRef updated
  useEffect(() => {
    pollGamepadRef.current = pollGamepad;
  }, [pollGamepad]);

  // Poll gamepad every 8 ms with setInterval
  useEffect(() => {
    const timer = setInterval(() => {
      pollGamepadRef.current();
    }, 8);
    return () => clearInterval(timer);
  }, []);

  // Listen to gamepad connection events
  useEffect(() => {
    const handleConnected = (e: GamepadEvent) => {
      setGamepadStatus({ connected: true, name: e.gamepad.id || 'Gamepad' });
    };

    const handleDisconnected = (e: GamepadEvent) => {
      setGamepadStatus({ connected: false, name: '' });
      if (gamepadTriggerHeldSetRef.current.size > 0) {
        gamepadTriggerHeldSetRef.current.clear();
        stopFiringIfAllReleased();
      }
      if (isGamepadHomeHeldRef.current) {
        isGamepadHomeHeldRef.current = false;
        cancelHomeHold();
      }
      prevGamepadButtonsRef.current = [];
    };

    window.addEventListener('gamepadconnected', handleConnected);
    window.addEventListener('gamepaddisconnected', handleDisconnected);
    return () => {
      window.removeEventListener('gamepadconnected', handleConnected);
      window.removeEventListener('gamepaddisconnected', handleDisconnected);
    };
  }, [stopFiringIfAllReleased, cancelHomeHold]);

  // ==========================================
  // CAMERA & COMPUTER VISION TRACKING LOOP
  // Runs continuously in the background
  // ==========================================
  useEffect(() => {
    let active = true;

    const requestCamera = async () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (simAnimIdRef.current) {
        cancelAnimationFrame(simAnimIdRef.current);
        simAnimIdRef.current = null;
      }
      if (simStreamRef.current) {
        simStreamRef.current.getTracks().forEach(t => t.stop());
        simStreamRef.current = null;
      }

      if (!isRunning) {
        setCameraState('off');
        setTrackerState('NO TV');
        return;
      }

      setCameraState('requesting');

      try {
        let stream: MediaStream | null = null;

        if (useSimulatedFeed) {
          if (!simCanvasRef.current) {
            simCanvasRef.current = document.createElement('canvas');
            simCanvasRef.current.width = 640;
            simCanvasRef.current.height = 480;
          }
          const canvas = simCanvasRef.current;
          const sCtx = canvas.getContext('2d');
          const startTime = performance.now();

          const renderSim = () => {
            if (!sCtx) return;
            const t = (performance.now() - startTime) / 1000;
            const swayX = Math.sin(t * 0.8) * 8;
            const swayY = Math.cos(t * 0.6) * 6;

            sCtx.fillStyle = '#090d16';
            sCtx.fillRect(0, 0, 640, 480);

            const tvW = 400;
            const tvH = 260;
            const tvX = 120 + swayX;
            const tvY = 100 + swayY;
            const borderThick = 15;

            sCtx.fillStyle = '#ffffff';
            sCtx.fillRect(tvX, tvY, tvW, tvH);

            const inX = tvX + borderThick;
            const inY = tvY + borderThick;
            const inW = tvW - borderThick * 2;
            const inH = tvH - borderThick * 2;
            sCtx.fillStyle = '#050811';
            sCtx.fillRect(inX, inY, inW, inH);

            const ballX = inX + inW / 2 + Math.sin(t * 2.2) * (inW * 0.35);
            const ballY = inY + inH / 2 + Math.cos(t * 1.7) * (inH * 0.3);
            sCtx.fillStyle = '#ef4444';
            sCtx.beginPath();
            sCtx.arc(ballX, ballY, 16, 0, Math.PI * 2);
            sCtx.fill();

            simAnimIdRef.current = requestAnimationFrame(renderSim);
          };
          simAnimIdRef.current = requestAnimationFrame(renderSim);

          stream = canvas.captureStream(30);
          simStreamRef.current = stream;
        } else {
          const constraints: MediaStreamConstraints = {
            audio: false,
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);

          // Android Chrome camera optimization: lock continuous autofocus and exposure
          try {
            const track = stream.getVideoTracks()[0];
            const capabilities = (track as any)?.getCapabilities?.();
            const adv: any = {};
            if (capabilities?.focusMode?.includes?.('continuous')) {
              adv.focusMode = 'continuous';
            }
            if (capabilities?.exposureMode?.includes?.('continuous')) {
              adv.exposureMode = 'continuous';
            }
            if (Object.keys(adv).length > 0) {
              await (track as any)?.applyConstraints?.({ advanced: [adv] });
            }
          } catch {}
        }

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!active) return;
            videoRef.current?.play().catch(() => {});
            setCameraState('on');
          };
        }
      } catch {
        if (active) {
          setCameraState('error');
          setTrackerState('NO TV');
        }
      }
    };

    requestCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (simAnimIdRef.current) {
        cancelAnimationFrame(simAnimIdRef.current);
        simAnimIdRef.current = null;
      }
      if (simStreamRef.current) {
        simStreamRef.current.getTracks().forEach(t => t.stop());
        simStreamRef.current = null;
      }
    };
  }, [isRunning, facingMode, useSimulatedFeed]);

  // Main CV Processing Loop (RAF)
  useEffect(() => {
    let animId: number;

    const processFrame = () => {
      const video = videoRef.current;

      if (!video || video.readyState < 2 || !isRunning) {
        animId = requestAnimationFrame(processFrame);
        return;
      }

      const tStart = performance.now();

      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
        offscreenCanvasRef.current.width = CV_WIDTH;
        offscreenCanvasRef.current.height = CV_HEIGHT;
      }
      const offCanvas = offscreenCanvasRef.current;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

      if (offCtx) {
        offCtx.drawImage(video, 0, 0, CV_WIDTH, CV_HEIGHT);
        const imgData = offCtx.getImageData(0, 0, CV_WIDTH, CV_HEIGHT);

        let currentCorners: QuadCorners | null = null;
        let isConfidenceGood = false;

        if (calibrationMode === 'auto') {
          const detResult: DetectionResult = detectBorderQuad(imgData.data, threshold);
          if (detResult.detected && detResult.corners) {
            hasEverDetectedRef.current = true;
            isConfidenceGood = true;

            // Exponential smoothing
            if (!smoothedCornersRef.current) {
              smoothedCornersRef.current = { ...detResult.corners };
            } else {
              const alpha = smoothingAlpha;
              const sc = smoothedCornersRef.current;
              const dc = detResult.corners;
              sc.tl = { x: sc.tl.x + alpha * (dc.tl.x - sc.tl.x), y: sc.tl.y + alpha * (dc.tl.y - sc.tl.y) };
              sc.tr = { x: sc.tr.x + alpha * (dc.tr.x - sc.tr.x), y: sc.tr.y + alpha * (dc.tr.y - sc.tr.y) };
              sc.br = { x: sc.br.x + alpha * (dc.br.x - sc.br.x), y: sc.br.y + alpha * (dc.br.y - sc.br.y) };
              sc.bl = { x: sc.bl.x + alpha * (dc.bl.x - sc.bl.x), y: sc.bl.y + alpha * (dc.bl.y - sc.bl.y) };
            }

            currentCorners = smoothedCornersRef.current;
            lastGoodCornersRef.current = { corners: currentCorners, time: performance.now() };
          } else {
            // Coasting fallback (500 ms)
            if (lastGoodCornersRef.current && (performance.now() - lastGoodCornersRef.current.time < 500)) {
              currentCorners = lastGoodCornersRef.current.corners;
            } else {
              currentCorners = null;
              smoothedCornersRef.current = null;
            }
          }
        } else {
          // Manual calibration
          currentCorners = manualCorners;
          isConfidenceGood = true;
        }

        // Tracking status evaluation
        let newStatus: TrackingStatus = 'NO TV';
        if (currentCorners) {
          newStatus = 'TRACKING';
        } else if (hasEverDetectedRef.current) {
          newStatus = 'LOST';
        }

        if (trackerStateRef.current !== newStatus) {
          trackerStateRef.current = newStatus;
          setTrackerState(newStatus);
        }

        const tCV = performance.now() - tStart;
        setProcessingTimeMs(tCV);

        // Projective homography mapping
        let u = 0.5;
        let v = 0.5;
        let onScreen = false;

        if (currentCorners) {
          const aimPoint: Point = { x: 0.5 + aimOffset.x, y: 0.5 + aimOffset.y };
          const mapRes: HomographyResult = mapCameraToTv(aimPoint, currentCorners);
          u = mapRes.clampedU;
          v = mapRes.clampedV;
          onScreen = mapRes.isInside;

          setDebugAimU(u);
          setDebugAimV(v);
          setDebugIsInside(onScreen);

          // Stream aim telemetry to TV up to 30 times/second
          const now = performance.now();
          if (now - lastAimSendTimeRef.current >= 33) {
            lastAimSendTimeRef.current = now;
            sentLostRef.current = false;

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              msgSeqRef.current += 1;
              wsRef.current.send(JSON.stringify({
                type: 'aim',
                x: Number(u.toFixed(4)),
                y: Number(v.toFixed(4)),
                seq: msgSeqRef.current,
                onScreen: onScreen,
                trackingTimeMs: Number(tCV.toFixed(1))
              }));
            }
          }
        } else {
          // Send lost packet once
          if (!sentLostRef.current) {
            sentLostRef.current = true;
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'lost' }));
            }
          }
        }

        // Draw debug overlay onto Settings canvas ONLY when Settings is open
        if (showSettingsPanel && settingsCanvasRef.current) {
          const canvas = settingsCanvasRef.current;
          canvas.width = CV_WIDTH;
          canvas.height = CV_HEIGHT;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            if (showThresholdMask) {
              const maskData = ctx.createImageData(CV_WIDTH, CV_HEIGHT);
              const src = imgData.data;
              const dst = maskData.data;
              for (let i = 0; i < src.length; i += 4) {
                const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
                const b = lum >= threshold ? 255 : 0;
                dst[i] = b;
                dst[i + 1] = b;
                dst[i + 2] = b;
                dst[i + 3] = 255;
              }
              ctx.putImageData(maskData, 0, 0);
            } else {
              ctx.drawImage(offCanvas, 0, 0);
            }

            // Draw detected quad border
            if (currentCorners) {
              ctx.strokeStyle = isConfidenceGood ? '#10b981' : '#f59e0b';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(currentCorners.tl.x * CV_WIDTH, currentCorners.tl.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.tr.x * CV_WIDTH, currentCorners.tr.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.br.x * CV_WIDTH, currentCorners.br.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.bl.x * CV_WIDTH, currentCorners.bl.y * CV_HEIGHT);
              ctx.closePath();
              ctx.stroke();

              // Draw high-visibility neon red aim crosshair reticle
              const aimPx = (0.5 + aimOffset.x) * CV_WIDTH;
              const aimPy = (0.5 + aimOffset.y) * CV_HEIGHT;

              // Circular ring
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(aimPx, aimPy, 10, 0, Math.PI * 2);
              ctx.stroke();

              // Crosshair lines/ticks
              ctx.beginPath();
              // Left & Right ticks
              ctx.moveTo(aimPx - 16, aimPy);
              ctx.lineTo(aimPx - 4, aimPy);
              ctx.moveTo(aimPx + 4, aimPy);
              ctx.lineTo(aimPx + 16, aimPy);
              // Top & Bottom ticks
              ctx.moveTo(aimPx, aimPy - 16);
              ctx.lineTo(aimPx, aimPy - 4);
              ctx.moveTo(aimPx, aimPy + 4);
              ctx.lineTo(aimPx, aimPy + 16);
              ctx.stroke();

              // Solid center dot
              ctx.fillStyle = '#ef4444';
              ctx.beginPath();
              ctx.arc(aimPx, aimPy, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        // Draw overlay onto Play background canvas if active
        if (showCameraBg && playCanvasRef.current) {
          const canvas = playCanvasRef.current;
          canvas.width = CV_WIDTH;
          canvas.height = CV_HEIGHT;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, CV_WIDTH, CV_HEIGHT);
            if (currentCorners) {
              // Draw detected quad border
              ctx.strokeStyle = isConfidenceGood ? '#10b981' : '#f59e0b';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(currentCorners.tl.x * CV_WIDTH, currentCorners.tl.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.tr.x * CV_WIDTH, currentCorners.tr.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.br.x * CV_WIDTH, currentCorners.br.y * CV_HEIGHT);
              ctx.lineTo(currentCorners.bl.x * CV_WIDTH, currentCorners.bl.y * CV_HEIGHT);
              ctx.closePath();
              ctx.stroke();

              // Draw high-visibility neon red aim crosshair reticle
              const aimPx = (0.5 + aimOffset.x) * CV_WIDTH;
              const aimPy = (0.5 + aimOffset.y) * CV_HEIGHT;

              // Circular ring
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(aimPx, aimPy, 10, 0, Math.PI * 2);
              ctx.stroke();

              // Crosshair lines/ticks
              ctx.beginPath();
              // Left & Right ticks
              ctx.moveTo(aimPx - 16, aimPy);
              ctx.lineTo(aimPx - 4, aimPy);
              ctx.moveTo(aimPx + 4, aimPy);
              ctx.lineTo(aimPx + 16, aimPy);
              // Top & Bottom ticks
              ctx.moveTo(aimPx, aimPy - 16);
              ctx.lineTo(aimPx, aimPy - 4);
              ctx.moveTo(aimPx, aimPy + 4);
              ctx.lineTo(aimPx, aimPy + 16);
              ctx.stroke();

              // Solid center dot
              ctx.fillStyle = '#ef4444';
              ctx.beginPath();
              ctx.arc(aimPx, aimPy, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Poll gamepad once per animation frame
      pollGamepadRef.current();

      animId = requestAnimationFrame(processFrame);
    };

    animId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animId);
  }, [isRunning, calibrationMode, threshold, smoothingAlpha, aimOffset, showSettingsPanel, showThresholdMask, manualCorners]);

  // Execute Homography Self-Test
  const executeSelfTest = () => {
    const res = runHomographySelfTest();
    setSelfTestResult(res);
    setShowSelfTestModal(true);
  };

  // Dragging manual calibration handles inside Settings
  const handlePointerDownHandle = (e: React.PointerEvent, cornerId: 'tl' | 'tr' | 'br' | 'bl') => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveHandle(cornerId);
  };

  const handlePointerUpHandle = (e: React.PointerEvent) => {
    e.stopPropagation();
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    setActiveHandle(null);
  };

  const handlePointerMoveSettings = (e: React.PointerEvent) => {
    if (!activeHandle || !settingsBoxRef.current) return;
    const rect = settingsBoxRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setManualCorners(prev => ({ ...prev, [activeHandle]: { x, y } }));
  };

  const handleSettingsTapAimPoint = (e: React.MouseEvent) => {
    if (!isSettingAimPoint || !settingsBoxRef.current) return;
    const rect = settingsBoxRef.current.getBoundingClientRect();
    const tapX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tapY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const ox = tapX - 0.5;
    const oy = tapY - 0.5;
    setAimOffset({ x: ox, y: oy });
    setIsSettingAimPoint(false);
  };

  // If Fire TV Receiver Mode is active, render the receiver component
  if (isTvMode) {
    return (
      <FireTvReceiver 
        onSwitchToTracker={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('mode');
          window.history.pushState({}, '', url.pathname + (url.search ? url.search : ''));
          setIsTvMode(false);
        }} 
      />
    );
  }

  // ==========================================
  // PLAY SCREEN: THREE BUTTONS, NOTHING ELSE
  // Landscape, nearly black background, no video preview shown
  // ==========================================
  return (
    <div 
      className="fixed inset-0 w-screen h-screen bg-black text-white flex flex-row overflow-hidden select-none touch-none"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
    >
      {/* Background camera video element (running strictly offscreen for CV tracking) */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="fixed -left-[9999px] -top-[9999px] w-1 h-1 opacity-0 pointer-events-none"
      />

      {/* Visual Tracking Warning Banner shown on Play Screen */}
      {trackerState !== 'TRACKING' && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none bg-rose-950/90 border border-rose-500/50 text-rose-200 px-4 py-1.5 rounded-full font-mono text-[10px] md:text-xs font-bold tracking-wider animate-pulse flex items-center gap-1.5 shadow-lg select-none">
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          <span>BORDER LOST - ALIGN CAMERA WITH TV BORDER</span>
        </div>
      )}

      {/* Requirement 6: Single Small Status Line (CONNECTED or RECONNECTING, and small dim AMMO 9/30) */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 font-mono text-[11px] pointer-events-none select-none tracking-wider bg-zinc-950/80 px-3 py-1 rounded-full border border-zinc-900/80 shadow-md">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
          <span className={connectionStatus === 'connected' ? 'text-zinc-300 font-semibold' : 'text-amber-400 font-bold'}>
            {connectionStatus === 'connected' ? 'CONNECTED' : 'RECONNECTING'}
          </span>
        </div>
        <span className="text-zinc-700">|</span>
        <span className="text-zinc-500 font-medium">
          {tvState.reloading ? 'RELOADING' : `AMMO ${tvState.ammo}/${tvState.mag}`}
        </span>
      </div>

      {/* LEFT SECTION (~40% width): HOME (Top-Left), RELOAD (Left-Middle), SETTINGS (Bottom-Left) */}
      <div className="w-[40%] h-full flex flex-col justify-between p-3 z-10 pointer-events-auto">
        
        {/* Requirement 3: HOME BUTTON (Top-Left, 500 ms hold with circular SVG progress ring) */}
        <div className="flex items-start">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
              startHomeHold(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
              cancelHomeHold(e.pointerId);
            }}
            onPointerCancel={(e) => {
              e.preventDefault();
              try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
              cancelHomeHold(e.pointerId);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-zinc-900/90 hover:bg-zinc-800 active:bg-zinc-800 border border-zinc-800 text-zinc-300 shadow-lg select-none cursor-pointer transition-colors"
            title="Press and hold 500ms to send Home"
          >
            {/* Circular progress ring */}
            <div className="relative w-8 h-8 flex items-center justify-center">
              <svg className="w-8 h-8 -rotate-90 pointer-events-none" viewBox="0 0 36 36">
                <circle 
                  cx="18" 
                  cy="18" 
                  r="14" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="3" 
                  className="text-zinc-800" 
                />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="88"
                  strokeDashoffset={88 * (1 - homeProgress / 100)}
                  strokeLinecap="round"
                  className="text-amber-400 transition-none"
                />
              </svg>
              <Home className="w-4 h-4 absolute text-zinc-300" />
            </div>
            <span className="font-mono text-xs font-bold tracking-wider text-zinc-300">HOME (HOLD)</span>
          </button>
        </div>

        {/* Requirement 3: RELOAD BUTTON (Large square button at left-middle) */}
        <div className="flex items-center justify-center my-auto">
          <button
            type="button"
            disabled={tvState.scene === 'menu'}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
              handleReloadDown(e.pointerId);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
              handleReloadUp(e.pointerId);
            }}
            onPointerCancel={(e) => {
              e.preventDefault();
              try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
              handleReloadUp(e.pointerId);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-32 h-32 md:w-36 md:h-36 rounded-3xl flex flex-col items-center justify-center gap-2 border-2 transition-all shadow-xl select-none ${
              tvState.scene === 'menu'
                ? 'opacity-30 cursor-not-allowed bg-zinc-950 border-zinc-800 text-zinc-600'
                : tvState.reloading
                ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200 scale-95 shadow-[0_0_25px_rgba(6,182,212,0.4)] cursor-pointer'
                : 'bg-zinc-900/90 hover:bg-zinc-800 active:scale-95 active:bg-cyan-950 border-cyan-700/60 text-cyan-300 cursor-pointer'
            }`}
            title="Reload weapon"
          >
            <RefreshCw className={`w-8 h-8 ${tvState.reloading ? 'animate-spin text-cyan-400' : 'text-cyan-400'}`} />
            <span className="font-mono font-black text-sm tracking-widest uppercase">
              {tvState.reloading ? 'RELOADING' : 'RELOAD'}
            </span>
          </button>
        </div>

        {/* Bottom-left controls: SETTINGS, BLASTER and Fullscreen button */}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => {
              getAudioContext();
              setShowSettingsPanel(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-900 border border-zinc-900 text-zinc-600 hover:text-zinc-300 text-xs font-mono transition-colors cursor-pointer select-none"
            title="Open Settings & Calibration"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="font-semibold tracking-wider">SETTINGS</span>
          </button>

          <button
            type="button"
            onClick={() => {
              getAudioContext();
              connectBlaster();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-900 border border-zinc-900 text-zinc-600 hover:text-zinc-300 text-xs font-mono transition-colors cursor-pointer select-none"
            title="Connect XIT AR Blaster (ARGUNGAME)"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-semibold tracking-wider">
              {blasterStatus === 'connected' ? 'BLASTER (CONN)' : blasterStatus === 'connecting...' ? 'CONNECTING' : 'BLASTER'}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center justify-center p-1.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-900 border border-zinc-900 text-zinc-600 hover:text-zinc-300 text-xs font-mono transition-colors cursor-pointer select-none"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (Immersive Android Mode)'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* RIGHT SECTION (~60% width): TRIGGER BUTTON (Full height) */}
      <div className="w-[60%] h-full p-3 z-10 flex items-center justify-center pointer-events-auto">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
            handleTriggerDown(e.pointerId);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
            handleTriggerUp(e.pointerId);
          }}
          onPointerCancel={(e) => {
            e.preventDefault();
            try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
            handleTriggerUp(e.pointerId);
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={`w-full h-full rounded-3xl flex flex-col items-center justify-center gap-3 border-4 select-none touch-none cursor-pointer transition-all shadow-2xl ${
            isFiringState
              ? 'bg-gradient-to-tr from-rose-950 via-red-900 to-rose-900 border-red-500 scale-[0.99] shadow-[0_0_40px_rgba(239,68,68,0.5)]'
              : 'bg-zinc-950/90 hover:bg-zinc-900/90 active:bg-rose-950/80 border-zinc-800 hover:border-red-600/60 shadow-lg'
          }`}
          title={tvState.scene === 'menu' ? 'START' : 'TRIGGER'}
        >
          <Zap className={`w-14 h-14 md:w-16 md:h-16 ${isFiringState ? 'text-red-400 fill-red-400 scale-110' : 'text-zinc-500'}`} />
          <span className={`font-mono font-black text-3xl md:text-5xl tracking-widest uppercase drop-shadow-md ${
            isFiringState ? 'text-white' : 'text-zinc-200'
          }`}>
            {tvState.scene === 'menu' ? 'START' : 'TRIGGER'}
          </span>
          <span className="font-mono text-[10px] md:text-xs text-zinc-500 tracking-wider">
            {tvState.scene === 'menu' ? 'TAP TO BEGIN' : 'HOLD FOR FULL AUTO'}
          </span>
        </button>
      </div>

      {/* ==========================================
          SETTINGS, DEBUG VIEW & CALIBRATION MODAL
          (Camera feed, aim coordinates, offset, sliders exist ONLY here)
          ========================================== */}
      {showSettingsPanel && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col p-4 overflow-y-auto font-mono text-xs">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-400" />
              <h2 className="text-base font-bold text-white tracking-wider">CONTROLLER SETTINGS & CALIBRATION</h2>
            </div>
            <button
              onClick={() => setShowSettingsPanel(false)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            {/* Left Column: Camera Preview & Draggable Aim Calibration */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="font-bold">CAMERA / DEBUG VIEW</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  debugIsInside ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                }`}>
                  {debugIsInside ? 'ON SCREEN' : 'OFF SCREEN'}
                </span>
              </div>

              {/* Debug Canvas Container */}
              <div 
                ref={settingsBoxRef}
                onClick={handleSettingsTapAimPoint}
                onPointerMove={handlePointerMoveSettings}
                className="relative w-full aspect-[4/3] bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center cursor-crosshair"
              >
                <canvas 
                  ref={settingsCanvasRef} 
                  className="w-full h-full object-contain pointer-events-none" 
                />

                {/* Banner when setting aim point */}
                {isSettingAimPoint && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none z-30">
                    <span className="bg-amber-500 text-black px-3 py-1 rounded font-bold animate-bounce">
                      TAP WHERE SIGHTS POINT
                    </span>
                  </div>
                )}

                {/* Manual Calibration Draggable Handles */}
                {calibrationMode === 'manual' && (
                  <div className="absolute inset-0 pointer-events-auto">
                    {(['tl', 'tr', 'br', 'bl'] as const).map(id => {
                      const pt = manualCorners[id];
                      return (
                        <div
                          key={id}
                          style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                          onPointerDown={(e) => handlePointerDownHandle(e, id)}
                          onPointerUp={handlePointerUpHandle}
                          className="absolute w-8 h-8 -ml-4 -mt-4 flex items-center justify-center cursor-move touch-none"
                        >
                          <div className="w-5 h-5 rounded-full bg-blue-500 border border-white flex items-center justify-center text-[8px] font-bold text-white">
                            {id.toUpperCase()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Aim Coordinates & Offset Controls */}
              <div className="grid grid-cols-2 gap-2 bg-zinc-900 p-2.5 rounded-xl border border-zinc-800">
                <div>
                  <span className="text-[10px] text-zinc-500 block">TV X / Y</span>
                  <span className="text-sm font-bold text-cyan-400">{debugAimU.toFixed(3)}, {debugAimV.toFixed(3)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">SIGHT OFFSET</span>
                  <span className="text-sm font-bold text-amber-400">[{aimOffset.x.toFixed(2)}, {aimOffset.y.toFixed(2)}]</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsSettingAimPoint(!isSettingAimPoint)}
                  className={`flex-1 py-2 rounded-xl font-bold border transition-colors cursor-pointer ${
                    isSettingAimPoint ? 'bg-amber-500 text-black border-amber-400' : 'bg-zinc-900 hover:bg-zinc-800 text-amber-300 border-zinc-800'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5 inline mr-1" />
                  <span>{isSettingAimPoint ? 'TAP CAMERA PREVIEW' : 'SET AIM POINT'}</span>
                </button>
                {(aimOffset.x !== 0 || aimOffset.y !== 0) && (
                  <button
                    onClick={() => setAimOffset({ x: 0, y: 0 })}
                    className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Right Column: Controls, Toggles & Network Settings */}
            <div className="flex flex-col gap-3">
              {/* Requirement 5: SOUND on/off switch */}
              <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2">
                  {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
                  <div>
                    <span className="font-bold text-white block">SOUND SYNTHESIS</span>
                    <span className="text-[10px] text-zinc-500">Instant recoil shot, dry click & reload audio</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    soundEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      soundEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Requirement 3: AIM ASSIST switch */}
              <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <div>
                    <span className="font-bold text-white block">AIM ASSIST</span>
                    <span className="text-[10px] text-zinc-500">Transmits mode to TV receiver (OFF by default)</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAimAssist()}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    aimAssist ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      aimAssist ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Optional: SHOW PLAY SCREEN CAMERA BACKGROUND switch */}
              <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2">
                  <Tv className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="font-bold text-white block">PLAY SCREEN FEED</span>
                    <span className="text-[10px] text-zinc-500">Show low-opacity camera background on main play screen</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCameraBg(!showCameraBg)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    showCameraBg ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      showCameraBg ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Border Detection Mode & Sliders */}
              <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-bold">DETECTION MODE</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCalibrationMode('auto')}
                      className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                        calibrationMode === 'auto' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      BORDER
                    </button>
                    <button
                      onClick={() => setCalibrationMode('manual')}
                      className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                        calibrationMode === 'manual' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-zinc-400 text-[10px]">
                    <span>EXPOSURE THRESHOLD</span>
                    <span className="text-cyan-400 font-bold">{threshold}</span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="240"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-zinc-400 text-[10px]">
                    <span>SMOOTHING ALPHA</span>
                    <span className="text-indigo-400 font-bold">α = {smoothingAlpha.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.95"
                    step="0.05"
                    value={smoothingAlpha}
                    onChange={(e) => setSmoothingAlpha(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <label className="flex items-center justify-between text-zinc-300 text-[10px] pt-1 border-t border-zinc-800 cursor-pointer">
                  <span>Show Threshold Mask Overlay</span>
                  <input
                    type="checkbox"
                    checked={showThresholdMask}
                    onChange={(e) => setShowThresholdMask(e.target.checked)}
                    className="accent-cyan-500 rounded cursor-pointer"
                  />
                </label>
              </div>

              {/* Relay & Network Settings */}
              <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col gap-2">
                <span className="text-zinc-400 font-bold">WEBSOCKET RELAY</span>
                <input
                  type="text"
                  value={relayUrl}
                  onChange={(e) => setRelayUrl(e.target.value)}
                  placeholder="wss://.../ws"
                  className="bg-black border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 4))}
                    placeholder="TV01"
                    className="w-24 bg-black border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-400 font-bold text-center tracking-widest"
                  />
                  <div className="flex-1 flex items-center justify-between px-2 bg-black rounded-lg border border-zinc-800 text-[10px] text-zinc-400">
                    <span>RTT: <strong className="text-cyan-400">{rttMs !== null ? `${rttMs}ms` : 'N/A'}</strong></span>
                    <span>CV: <strong className="text-emerald-400">{processingTimeMs.toFixed(1)}ms</strong></span>
                  </div>
                </div>
              </div>

              {/* Blaster connection section */}
              <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <div>
                    <span className="font-bold text-white block">XIT AR BLASTER (ARGUNGAME)</span>
                    <span className="text-[10px] text-zinc-500">STATUS: {blasterStatus}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    getAudioContext();
                    connectBlaster();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs font-mono cursor-pointer transition-colors"
                >
                  BLASTER
                </button>
              </div>

              {/* Gamepad status line */}
              <div className="text-[11px] font-mono text-zinc-400">
                GAMEPAD: {gamepadStatus.connected ? `connected (${gamepadStatus.name})` : 'not connected'}
              </div>

              {/* Codebase Zip Download */}
              <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="font-bold text-white block">DOWNLOAD CODEBASE (.ZIP)</span>
                    <span className="text-[10px] text-zinc-500">Download complete project source files in a zip archive</span>
                  </div>
                </div>
                <a
                  href="/project.zip"
                  download="spatial-finger-tracker.zip"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs font-mono transition-colors flex items-center gap-1.5 no-underline cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  ZIP
                </a>
              </div>

              {/* Tools & Switch to TV mode */}
              <div className="flex gap-2 mt-auto">
                <button
                  onClick={executeSelfTest}
                  className="flex-1 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-indigo-300 cursor-pointer font-bold"
                >
                  <Activity className="w-3.5 h-3.5 inline mr-1" />
                  Self-Test
                </button>
                <button
                  onClick={() => setShowBenchmarkModal(true)}
                  className="flex-1 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer font-bold"
                >
                  <BarChart2 className="w-3.5 h-3.5 inline mr-1" />
                  Benchmark
                </button>
                <button
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('mode', 'tv');
                    window.history.pushState({}, '', url.pathname + (url.search ? url.search : ''));
                    setIsTvMode(true);
                  }}
                  className="flex-1 py-2 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 cursor-pointer font-bold"
                >
                  <Tv className="w-3.5 h-3.5 inline mr-1" />
                  TV Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Homography Self-Test Modal */}
      {showSelfTestModal && selfTestResult && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-4 flex flex-col gap-3 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <span className="font-bold text-white">HOMOGRAPHY SELF-TEST</span>
              <button onClick={() => setShowSelfTestModal(false)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className={`p-2 rounded font-bold ${selfTestResult.passed ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
              STATUS: {selfTestResult.passed ? 'ALL TESTS PASSED' : 'TEST FAILED'}
            </div>
            <div className="bg-black p-2 rounded text-[10px] text-zinc-400 flex flex-col gap-1 max-h-40 overflow-y-auto">
              {selfTestResult.logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Resolution Benchmark Modal */}
      {showBenchmarkModal && (
        <ResolutionBenchmarkModal 
          isOpen={showBenchmarkModal}
          onClose={() => setShowBenchmarkModal(false)}
          videoRef={videoRef}
          onSelectResolution={() => {}}
          currentResolution={320}
        />
      )}
    </div>
  );
}
