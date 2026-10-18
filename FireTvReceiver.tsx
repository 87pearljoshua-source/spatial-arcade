import { useEffect, useRef, useState, useCallback } from 'react';
import { Tv, Crosshair, Target, Zap, Wifi, AlertCircle, RefreshCw, Volume2, VolumeX, Shield, Play, Pause } from 'lucide-react';

interface RelayMessage {
  type?: string;
  x?: number;
  y?: number;
  seq?: number;
  trackingTimeMs?: number;
  onScreen?: boolean;
  t?: number;
  clientTimestamp?: number;
  peers?: { trackers: number; receivers: number };
  [key: string]: any;
}

interface FireTvReceiverProps {
  onSwitchToTracker?: () => void;
}

export function FireTvReceiver({ onSwitchToTracker }: FireTvReceiverProps) {
  // Session pairing
  const [sessionId, setSessionId] = useState<string>(() => {
    const urlParam = new URLSearchParams(window.location.search).get('session') || new URLSearchParams(window.location.search).get('room');
    if (urlParam && urlParam.trim()) return urlParam.trim().toUpperCase().slice(0, 4);
    try {
      const saved = localStorage.getItem('sft_room_code');
      if (saved && saved.trim()) return saved.trim().toUpperCase().slice(0, 4);
    } catch {}
    return 'TV01';
  });
  const [customRelayUrl, setCustomRelayUrl] = useState<string>(() => {
    const urlParam = new URLSearchParams(window.location.search).get('relay');
    if (urlParam && urlParam.trim()) return urlParam.trim();
    try {
      const saved = localStorage.getItem('sft_relay_url');
      if (saved && saved.trim()) return saved.trim();
    } catch {}
    return '';
  });

  useEffect(() => {
    try {
      localStorage.setItem('sft_room_code', sessionId);
    } catch {}
  }, [sessionId]);
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');
  const [peerCount, setPeerCount] = useState<{ trackers: number; receivers: number }>({ trackers: 0, receivers: 0 });

  // Aiming reticle & trigger state
  const [aim, setAim] = useState<{ x: number; y: number; onScreen: boolean }>({ x: 0.5, y: 0.5, onScreen: false });
  const [lastSeq, setLastSeq] = useState<number>(0);
  const [droppedPackets, setDroppedPackets] = useState<number>(0);
  const [messagesPerSec, setMessagesPerSec] = useState<number>(0);

  // Latencies
  const [trackingLatencyMs, setTrackingLatencyMs] = useState<number>(0);
  const [networkRttMs, setNetworkRttMs] = useState<number>(0);
  const [renderLatencyMs, setRenderLatencyMs] = useState<number>(0);

  // Game state
  const MAG_SIZE = 30;
  const [score, setScore] = useState<number>(0);
  const [hits, setHits] = useState<number>(0);
  const [shotsFired, setShotsFired] = useState<number>(0);
  const [ammo, setAmmo] = useState<number>(30);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [assist, setAssist] = useState<boolean>(false);

  const [targetPos, setTargetPos] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [hitEffect, setHitEffect] = useState<{ active: boolean; x: number; y: number; hit: boolean }>({ active: false, x: 0.5, y: 0.5, hit: false });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [dynamicContent, setDynamicContent] = useState<boolean>(true); // Shows interior game animations inside static border
  const [showValidationGrid, setShowValidationGrid] = useState<boolean>(false);
  const showValidationGridRef = useRef<boolean>(false);
  useEffect(() => {
    showValidationGridRef.current = showValidationGrid;
  }, [showValidationGrid]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const msgCounterRef = useRef<number>(0);
  const lastSeqRef = useRef<number>(0);
  const pingIntervalRef = useRef<any>(null);

  // Mutable refs to prevent stale closures
  const aimRef = useRef(aim);
  useEffect(() => { aimRef.current = aim; }, [aim]);
  const ammoRef = useRef(30);
  const isReloadingRef = useRef(false);
  const assistRef = useRef(false);
  const hitsRef = useRef(0);
  const shotsFiredRef = useRef(0);
  const targetPosRef = useRef({ x: 0.5, y: 0.5 });
  const isFiringRef = useRef(false);
  const firingTimerRef = useRef<any>(null);
  const wasLockedRef = useRef(false);
  const sceneRef = useRef<'menu' | 'play'>('play');

  // Sound synthesis
  const playSound = useCallback((type: 'hit' | 'miss' | 'trigger' | 'reload') => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'hit') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(1040, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'miss') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'reload') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.25);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch {
      // Audio autoplay policy
    }
  }, [soundEnabled]);

  // Execute a single shot
  const executeShot = useCallback(() => {
    if (isReloadingRef.current || ammoRef.current <= 0) {
      if (ammoRef.current <= 0 && !isReloadingRef.current) {
        playSound('miss');
      }
      return;
    }

    ammoRef.current -= 1;
    const currentAmmo = ammoRef.current;
    setAmmo(currentAmmo);

    shotsFiredRef.current += 1;
    setShotsFired(shotsFiredRef.current);

    let aimX = aimRef.current.x;
    let aimY = aimRef.current.y;

    // Magnetism if Aim Assist is ON
    if (assistRef.current) {
      const distToTarget = Math.hypot(aimX - targetPosRef.current.x, aimY - targetPosRef.current.y);
      if (distToTarget < 0.16) {
        aimX = targetPosRef.current.x;
        aimY = targetPosRef.current.y;
      }
    }

    const isHit = Math.hypot(aimX - targetPosRef.current.x, aimY - targetPosRef.current.y) < 0.1;

    setHitEffect({
      active: true,
      x: aimX,
      y: aimY,
      hit: isHit
    });

    if (isHit) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      setScore(s => s + 100);
      playSound('hit');
      // Relocate target
      const nextTarget = {
        x: 0.18 + Math.random() * 0.64,
        y: 0.18 + Math.random() * 0.64
      };
      targetPosRef.current = nextTarget;
      setTargetPos(nextTarget);
    } else {
      playSound('miss');
    }

    // Send shot to phone: {"type":"shot","hit":isHit,"ammo":currentAmmo}
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'shot',
        hit: isHit,
        ammo: currentAmmo
      }));

      // Broadcast state update
      wsRef.current.send(JSON.stringify({
        type: 'state',
        scene: sceneRef.current,
        ammo: currentAmmo,
        mag: MAG_SIZE,
        assist: assistRef.current,
        reloading: isReloadingRef.current,
        hits: hitsRef.current,
        shots: shotsFiredRef.current
      }));
    }

    setTimeout(() => {
      setHitEffect(prev => ({ ...prev, active: false }));
    }, 250);
  }, [playSound]);

  // Handle full auto firing down/up
  const handleFireDown = useCallback(() => {
    if (isFiringRef.current) return;
    isFiringRef.current = true;
    executeShot();

    if (firingTimerRef.current) clearInterval(firingTimerRef.current);
    firingTimerRef.current = setInterval(() => {
      if (!isFiringRef.current) {
        clearInterval(firingTimerRef.current);
        return;
      }
      if (ammoRef.current <= 0 || isReloadingRef.current) {
        clearInterval(firingTimerRef.current);
        return;
      }
      executeShot();
    }, 110);
  }, [executeShot]);

  const handleFireUp = useCallback(() => {
    isFiringRef.current = false;
    if (firingTimerRef.current) {
      clearInterval(firingTimerRef.current);
      firingTimerRef.current = null;
    }
  }, []);

  // Handle weapon reload
  const handleReload = useCallback(() => {
    if (isReloadingRef.current) return;
    isReloadingRef.current = true;
    setIsReloading(true);
    handleFireUp();
    playSound('reload');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reload' }));
      wsRef.current.send(JSON.stringify({
        type: 'state',
        scene: sceneRef.current,
        ammo: ammoRef.current,
        mag: MAG_SIZE,
        assist: assistRef.current,
        reloading: true,
        hits: hitsRef.current,
        shots: shotsFiredRef.current
      }));
    }

    setTimeout(() => {
      ammoRef.current = MAG_SIZE;
      setAmmo(MAG_SIZE);
      isReloadingRef.current = false;
      setIsReloading(false);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'state',
          scene: sceneRef.current,
          ammo: MAG_SIZE,
          mag: MAG_SIZE,
          assist: assistRef.current,
          reloading: false,
          hits: hitsRef.current,
          shots: shotsFiredRef.current
        }));
      }
    }, 1000);
  }, [handleFireUp, playSound]);

  // WebSocket Connection Lifecycle
  useEffect(() => {
    let active = true;
    setConnectionStatus('CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const defaultRelay = `${protocol}//${window.location.host}/ws`;
    const targetUrl = customRelayUrl.trim() || defaultRelay;

    const fullUrl = `${targetUrl}?session=${encodeURIComponent(sessionId)}&role=receiver`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(fullUrl);
      wsRef.current = ws;
    } catch (err) {
      setConnectionStatus('ERROR');
      return;
    }

    ws.onopen = () => {
      if (!active) return;
      setConnectionStatus('CONNECTED');
      // Send explicit versioned join packet
      const joinMsg: RelayMessage = {
        v: 1,
        type: 'join',
        sessionId,
        role: 'receiver'
      };
      ws.send(JSON.stringify(joinMsg));

      // Send initial game state to room
      ws.send(JSON.stringify({
        type: 'state',
        ammo: ammoRef.current,
        mag: MAG_SIZE,
        assist: assistRef.current,
        reloading: isReloadingRef.current,
        hits: hitsRef.current,
        shots: shotsFiredRef.current
      }));

      // Periodic ping for network RTT measurement
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const pingMsg: RelayMessage = {
            v: 1,
            type: 'ping',
            sessionId,
            seq: Date.now(),
            timestamp: performance.now()
          };
          ws.send(JSON.stringify(pingMsg));
        }
      }, 1000);
    };

    ws.onmessage = (event) => {
      if (!active) return;
      const tRenderStart = performance.now();
      msgCounterRef.current++;

      try {
        const msg = JSON.parse(event.data) as RelayMessage;

        if (msg.type === 'status' && msg.peers) {
          setPeerCount(msg.peers);
        } else if (msg.type === 'pong' && msg.clientTimestamp) {
          const rtt = performance.now() - msg.clientTimestamp;
          setNetworkRttMs(rtt);
        } else if (msg.type === 'aim') {
          // Packet sequence check
          if (msg.seq !== undefined) {
            if (lastSeqRef.current > 0 && msg.seq > lastSeqRef.current + 1) {
              setDroppedPackets(d => d + (msg.seq! - lastSeqRef.current - 1));
            }
            lastSeqRef.current = msg.seq;
            setLastSeq(msg.seq);
          }

          if (msg.x !== undefined && msg.y !== undefined) {
            setAim({ x: msg.x, y: msg.y, onScreen: !!msg.onScreen });

            // Check target lock for tactile feedback tick
            const dist = Math.hypot(msg.x - targetPosRef.current.x, msg.y - targetPosRef.current.y);
            const isLocked = dist < (assistRef.current ? 0.12 : 0.07);
            if (isLocked && !wasLockedRef.current) {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'lock', locked: true }));
              }
            }
            wasLockedRef.current = isLocked;

            if (showValidationGridRef.current && msg.onScreen) {
              const cols = ['A', 'B', 'C', 'D', 'E'];
              let closestPt = null;
              let minDist = Infinity;
              for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                  const gx = 0.1 + c * 0.2;
                  const gy = 0.1 + r * 0.2;
                  const d = Math.hypot(msg.x - gx, msg.y - gy);
                  if (d < minDist) {
                    minDist = d;
                    closestPt = { id: `${cols[c]}${r + 1}`, x: gx, y: gy };
                  }
                }
              }
              if (closestPt && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  v: 1,
                  type: 'grid_error',
                  sessionId,
                  pointId: closestPt.id,
                  targetX: closestPt.x,
                  targetY: closestPt.y,
                  aimX: msg.x,
                  aimY: msg.y,
                  error: minDist
                }));
              }
            }
          }
          if (msg.trackingTimeMs !== undefined) {
            setTrackingLatencyMs(msg.trackingTimeMs);
          }

          // Measure render dispatch latency
          setRenderLatencyMs(performance.now() - tRenderStart);
        } else if (msg.type === 'trigger') {
          executeShot();
        } else if (msg.type === 'fire_down') {
          handleFireDown();
        } else if (msg.type === 'fire_up') {
          handleFireUp();
        } else if (msg.type === 'reload') {
          handleReload();
        } else if (msg.type === 'mode') {
          if (typeof msg.assist === 'boolean') {
            assistRef.current = msg.assist;
            setAssist(msg.assist);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'state',
                scene: sceneRef.current,
                ammo: ammoRef.current,
                mag: MAG_SIZE,
                assist: msg.assist,
                reloading: isReloadingRef.current,
                hits: hitsRef.current,
                shots: shotsFiredRef.current
              }));
            }
          }
        } else if (msg.type === 'home') {
          playSound('trigger');
          hitsRef.current = 0;
          shotsFiredRef.current = 0;
          setHits(0);
          setShotsFired(0);
          setScore(0);
          const newTarget = { x: 0.5, y: 0.5 };
          targetPosRef.current = newTarget;
          setTargetPos(newTarget);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'state',
              scene: sceneRef.current,
              ammo: ammoRef.current,
              mag: MAG_SIZE,
              assist: assistRef.current,
              reloading: isReloadingRef.current,
              hits: 0,
              shots: 0
            }));
          }
        } else if (msg.type === 'menu_sel') {
          playSound('trigger');
        }
      } catch (err) {
        // malformed packet
      }
    };

    ws.onclose = () => {
      if (!active) return;
      setConnectionStatus('DISCONNECTED');
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };

    ws.onerror = () => {
      if (!active) return;
      setConnectionStatus('ERROR');
    };

    // Calculate throughput messages/sec
    const rateInterval = setInterval(() => {
      setMessagesPerSec(msgCounterRef.current);
      msgCounterRef.current = 0;
    }, 1000);

    return () => {
      active = false;
      clearInterval(rateInterval);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [sessionId, customRelayUrl, executeShot, handleFireDown, handleFireUp, handleReload]);

  const trackerUrl = `${window.location.origin}/?session=${encodeURIComponent(sessionId)}`;

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-between select-none overflow-hidden font-mono">
      {/* 
        SINDEN OPTICAL REFERENCE BORDER ARCHITECTURE:
        Permanent, thick, fixed high-contrast white border around the playable screen area.
        Outside is pitch-black.
        Crucial requirement: This border NEVER changes, even when game content inside changes.
      */}
      <div className="relative w-full h-full flex flex-col p-4 sm:p-8 bg-black">
        {/* The Fixed Optical Reference Border Frame */}
        <div 
          className="relative flex-1 w-full max-w-6xl mx-auto rounded-none overflow-hidden"
          style={{
            // 24px thick solid white optical border
            border: '24px solid #FFFFFF',
            boxShadow: '0 0 40px rgba(255, 255, 255, 0.4), inset 0 0 20px rgba(0,0,0,0.8)',
            backgroundColor: '#05070f'
          }}
        >
          {/* PLAYABLE GAME & TEST VIEWPORT */}
          <div className="relative w-full h-full overflow-hidden">
            {/* Dynamic changing game interior (Proves optical border tracking is immune to interior game changes) */}
            {dynamicContent && (
              <div className="absolute inset-0 pointer-events-none opacity-30">
                {/* Moving grid background */}
                <div 
                  className="w-full h-full"
                  style={{
                    backgroundImage: 'linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                    animation: 'pulse 4s infinite'
                  }}
                />
                {/* Animated light pulses inside playable screen to stress-test border isolation */}
                <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-amber-500/20 rounded-full blur-2xl animate-ping" />
                <div className="absolute bottom-1/3 right-1/4 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl animate-pulse" />
              </div>
            )}

            {/* Test Target */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out z-10"
              style={{
                left: `${targetPos.x * 100}%`,
                top: `${targetPos.y * 100}%`,
              }}
            >
              <div className="relative flex items-center justify-center w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-rose-500 bg-rose-500/20 animate-pulse" />
                <div className="absolute inset-3 rounded-full border-2 border-amber-400 bg-amber-400/20" />
                <div className="w-4 h-4 rounded-full bg-yellow-300 shadow-[0_0_12px_#fde047]" />
                <div className="absolute -top-6 text-[10px] tracking-wider text-rose-300 font-bold bg-black/60 px-1 rounded">
                  TARGET
                </div>
              </div>
            </div>

            {/* Validation Grid overlay (5x5 grid of test points) */}
            {showValidationGrid && (
              <div className="absolute inset-0 pointer-events-none z-10">
                {/* Draw the 5x5 grid points */}
                {(() => {
                  const points = [];
                  const cols = ['A', 'B', 'C', 'D', 'E'];
                  for (let r = 0; r < 5; r++) {
                    for (let c = 0; c < 5; c++) {
                      points.push({
                        id: `${cols[c]}${r + 1}`,
                        x: 0.1 + c * 0.2,
                        y: 0.1 + r * 0.2
                      });
                    }
                  }
                  return points.map(pt => {
                    const isClosest = aim.onScreen && Math.hypot(aim.x - pt.x, aim.y - pt.y) < 0.1; // highlight within range
                    return (
                      <div
                        key={pt.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                        style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                      >
                        {/* Dot */}
                        <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
                          isClosest 
                            ? 'bg-amber-500 border-amber-300 ring-2 ring-amber-400 scale-125' 
                            : 'bg-slate-800/80 border-slate-600'
                        } transition-all duration-100`}>
                          <div className={`w-1 h-1 rounded-full ${isClosest ? 'bg-white' : 'bg-slate-400'}`} />
                        </div>
                        {/* Label */}
                        <span className={`text-[8px] font-bold font-mono px-1 rounded mt-1 ${
                          isClosest ? 'bg-amber-500 text-slate-950 scale-110' : 'bg-slate-950/70 text-slate-400'
                        } transition-all`}>
                          {pt.id}
                        </span>
                      </div>
                    );
                  });
                })()}

                {/* Draw line from closest point to aim */}
                {aim.onScreen && (() => {
                  const cols = ['A', 'B', 'C', 'D', 'E'];
                  let closest = null;
                  let minDist = Infinity;
                  for (let r = 0; r < 5; r++) {
                    for (let c = 0; c < 5; c++) {
                      const gx = 0.1 + c * 0.2;
                      const gy = 0.1 + r * 0.2;
                      const d = Math.hypot(aim.x - gx, aim.y - gy);
                      if (d < minDist) {
                        minDist = d;
                        closest = { id: `${cols[c]}${r + 1}`, x: gx, y: gy };
                      }
                    }
                  }
                  if (closest && minDist < 0.3) {
                    return (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        <line
                          x1={`${closest.x * 100}%`}
                          y1={`${closest.y * 100}%`}
                          x2={`${aim.x * 100}%`}
                          y2={`${aim.y * 100}%`}
                          stroke="#f59e0b"
                          strokeWidth="2"
                          strokeDasharray="4,4"
                          className="animate-pulse"
                        />
                      </svg>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Validation Grid Details Panel */}
            {showValidationGrid && aim.onScreen && (() => {
              const cols = ['A', 'B', 'C', 'D', 'E'];
              let closest = null;
              let minDist = Infinity;
              for (let r = 0; r < 5; r++) {
                for (let c = 0; r < 5 && c < 5; c++) {
                  const gx = 0.1 + c * 0.2;
                  const gy = 0.1 + r * 0.2;
                  const d = Math.hypot(aim.x - gx, aim.y - gy);
                  if (d < minDist) {
                    minDist = d;
                    closest = { id: `${cols[c]}${r + 1}`, x: gx, y: gy };
                  }
                }
              }
              if (closest) {
                return (
                  <div className="absolute top-4 right-4 bg-amber-950/90 border border-amber-500/40 p-3 rounded text-xs space-y-1 z-20 text-amber-300">
                    <div className="font-bold">GRID ACCURACY VERIFICATION</div>
                    <div>Closest Point: <span className="text-white font-bold">{closest.id}</span></div>
                    <div>Target Coords: <span className="text-slate-300">[{closest.x.toFixed(2)}, {closest.y.toFixed(2)}]</span></div>
                    <div>Phone Aim: <span className="text-slate-300">[{aim.x.toFixed(3)}, {aim.y.toFixed(3)}]</span></div>
                    <div>Mapping Error: <span className="text-white font-bold">{(minDist * 100).toFixed(2)}%</span></div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Aiming Reticle (Direct optical tracking feedback received from phone) */}
            {aim.onScreen && (
              <div
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-30 transition-transform duration-75"
                style={{
                  left: `${aim.x * 100}%`,
                  top: `${aim.y * 100}%`
                }}
              >
                <div className="relative flex items-center justify-center w-14 h-14">
                  {/* Outer circle */}
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-400 shadow-[0_0_15px_#34d399]" />
                  {/* Crosshair lines */}
                  <div className="absolute w-full h-[2px] bg-emerald-400" />
                  <div className="absolute h-full w-[2px] bg-emerald-400" />
                  {/* Center dot */}
                  <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
                  <div className="absolute -bottom-5 text-[9px] text-emerald-300 bg-black/70 px-1 rounded">
                    X:{(aim.x).toFixed(2)} Y:{(aim.y).toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Hit / Shot Impact Burst */}
            {hitEffect.active && (
              <div
                className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40"
                style={{
                  left: `${hitEffect.x * 100}%`,
                  top: `${hitEffect.y * 100}%`
                }}
              >
                <div className={`w-24 h-24 rounded-full animate-ping flex items-center justify-center ${
                  hitEffect.hit ? 'bg-amber-400/50 border-4 border-yellow-300' : 'bg-rose-600/40 border-2 border-rose-500'
                }`} />
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full font-black text-sm px-2 py-0.5 rounded shadow ${
                  hitEffect.hit ? 'bg-yellow-400 text-black' : 'bg-rose-600 text-white'
                }`}>
                  {hitEffect.hit ? 'DIRECT HIT! +100' : 'MISS!'}
                </div>
              </div>
            )}

            {/* Game Stats Overlay */}
            <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur border border-slate-700/60 p-3 rounded text-xs space-y-1 z-20">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <Target className="w-4 h-4" />
                <span>SCORE: {score}</span>
              </div>
              <div className="text-slate-400">AMMO: <span className={`font-bold ${ammo <= 5 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}>{ammo}/{MAG_SIZE}</span> {isReloading && <span className="text-amber-400 font-bold animate-pulse">(RELOAD)</span>}</div>
              <div className="text-slate-400">Shots Fired: <span className="text-white font-bold">{shotsFired}</span></div>
              <div className="text-slate-400">Accuracy: <span className="text-white font-bold">{shotsFired > 0 ? `${Math.round((hits / shotsFired) * 100)}%` : '0%'}</span></div>
              <div className="text-slate-400">Aim Assist: <span className={assist ? 'text-emerald-400 font-bold' : 'text-slate-500'}>{assist ? 'ON' : 'OFF'}</span></div>
            </div>

            {/* Test Trigger Button (Allows testing receiver directly from Fire TV remote) */}
            <div className="absolute bottom-4 right-4 z-20 flex gap-2">
              <button
                onClick={handleReload}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded border border-cyan-500/40 flex items-center gap-1.5 shadow-lg cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                RELOAD
              </button>
              <button
                onClick={() => executeShot()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded border border-rose-400 flex items-center gap-2 shadow-lg cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-white" />
                TEST TRIGGER (FIRE)
              </button>
            </div>
          </div>
        </div>

        {/* RECEIVER TELEMETRY & DIAGNOSTICS BAR */}
        <div className="w-full max-w-6xl mx-auto mt-3 bg-slate-900/90 border border-slate-800 rounded p-3 text-xs flex flex-wrap items-center justify-between gap-3">
          {/* Status & Session */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-full ${
                connectionStatus === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' :
                connectionStatus === 'CONNECTING' ? 'bg-amber-500 animate-spin' :
                connectionStatus === 'ERROR' ? 'bg-rose-600' : 'bg-slate-600'
              }`} />
              <span className="font-bold text-white tracking-wider">{connectionStatus}</span>
            </div>

            <div className="h-4 w-[1px] bg-slate-700" />

            <div className="flex items-center gap-1 text-slate-300">
              <span className="text-slate-400">SESSION:</span>
              <span className="font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                {sessionId}
              </span>
            </div>

            <div className="text-[11px] text-slate-400">
              Trackers: <span className="text-emerald-400 font-bold">{peerCount.trackers}</span> | Receivers: <span className="text-cyan-400 font-bold">{peerCount.receivers}</span>
            </div>
          </div>

          {/* Measured Transport Latency & Packet Stats */}
          <div className="flex items-center gap-4 text-[11px] text-slate-300">
            <div>
              <span className="text-slate-500">NET RTT:</span>{' '}
              <span className={`font-bold ${networkRttMs > 80 ? 'text-rose-400' : networkRttMs > 40 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {networkRttMs ? `${networkRttMs.toFixed(1)} ms` : '--'}
              </span>
            </div>

            <div>
              <span className="text-slate-500">PHONE TRACKING:</span>{' '}
              <span className="font-bold text-cyan-400">
                {trackingLatencyMs ? `${trackingLatencyMs.toFixed(1)} ms` : '--'}
              </span>
            </div>

            <div>
              <span className="text-slate-500">RENDER:</span>{' '}
              <span className="font-bold text-slate-200">
                {renderLatencyMs ? `${renderLatencyMs.toFixed(1)} ms` : '--'}
              </span>
            </div>

            <div>
              <span className="text-slate-500">PKT/SEC:</span>{' '}
              <span className="font-bold text-white">{messagesPerSec}</span>
            </div>

            <div>
              <span className="text-slate-500">SEQ:</span>{' '}
              <span className="font-bold text-slate-400">#{lastSeq}</span>
            </div>

            {droppedPackets > 0 && (
              <div className="text-rose-400 font-bold">
                LOST: {droppedPackets}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDynamicContent(!dynamicContent)}
              className={`px-2 py-1 text-[11px] rounded border ${dynamicContent ? 'bg-cyan-950 text-cyan-300 border-cyan-700' : 'bg-slate-800 text-slate-400 border-slate-700'} cursor-pointer`}
              title="Toggle animated game scenery to test border resilience"
            >
              Interior FX: {dynamicContent ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={() => setShowValidationGrid(!showValidationGrid)}
              className={`px-2 py-1 text-[11px] rounded border ${showValidationGrid ? 'bg-amber-950 text-amber-300 border-amber-700 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'} cursor-pointer`}
              title="Toggle 5x5 test validation grid to verify coordinate mapping accuracy"
            >
              Grid Overlay: {showValidationGrid ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1 text-slate-400 hover:text-white rounded border border-slate-700 cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
            </button>

            {onSwitchToTracker && (
              <button
                onClick={onSwitchToTracker}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-600 text-[11px] font-bold cursor-pointer"
              >
                Phone Tracker View
              </button>
            )}
          </div>
        </div>

        {/* Pairing guidance message for TV user */}
        <div className="w-full max-w-6xl mx-auto mt-1 flex justify-between items-center text-[10px] text-slate-500">
          <div>
            Aim phone camera at this screen. White reference border must remain inside phone camera frame.
          </div>
          <div>
            Pair phone tracker: <span className="text-slate-300 select-all font-mono">{trackerUrl}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
