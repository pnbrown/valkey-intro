import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, Send, Radio, MapPin, Activity, FileText, 
  AlertTriangle, Users, CheckCircle, Server, Zap, CloudRain, 
  Flame, Play, Pause, RotateCcw, ShieldCheck, Lock, AlertCircle
} from 'lucide-react';
import TacticalMap from './TacticalMap';
import { encryptMessage, decryptMessage } from '../utils/crypto';

export default function DashboardCommander({ user, socket }) {
  const [soldiers, setSoldiers] = useState([]);
  const [missions, setMissions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [sosEvents, setSosEvents] = useState({}); // Key: soldierId, Value: sos data
  const [activeMissions, setActiveMissions] = useState([]);
  
  // Tactical Decision Support System (TDSS) State
  const [activeSosNode, setActiveSosNode] = useState(null);

  // Chat States (AES Encrypted Comms)
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  // Simulation Events Toggles
  const [simEvents, setSimEvents] = useState({
    gpsLoss: false,
    jamming: false,
    heavyRain: false,
    wildfire: false,
    flood: false,
    massCasualty: false
  });

  // Replay System States
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [replayEvents, setReplayEvents] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const replayTimer = useRef(null);

  // Form State for creating missions
  const [newMission, setNewMission] = useState({
    title: '',
    description: '',
    priority: 3,
    sector: 'Sector Grid Echo',
    assignedTo: ''
  });

  const chatEndRef = useRef(null);

  // --- Initial Telemetry Fetching ---
  useEffect(() => {
    fetchSoldiers();
    fetchMissions();
    fetchAlerts();

    // Listen to real-time events over socket
    if (socket) {
      socket.on('soldier-position-update', (data) => {
        setSoldiers(prev => prev.map(s => s.id === data.soldierId ? {
          ...s,
          last_location: { lng: data.lng, lat: data.lat },
          battery_level: data.battery_level,
          status: data.status
        } : s));

        // Log coordinate sweep to event feed
        addFeedEvent(`Node telemetry updated: Soldier #${data.soldierId} (Bat: ${data.battery_level}%)`);
      });

      socket.on('sos-broadcast', (data) => {
        setSosEvents(prev => ({ ...prev, [data.soldierId]: data }));
        setActiveSosNode(data);
        
        setSoldiers(prev => prev.map(s => s.id === parseInt(data.soldierId, 10) ? { ...s, status: 'sos' } : s));
        addFeedEvent(`🚨 CRITICAL: SOS Signal received from Soldier #${data.soldierId}. TDSS responding!`);
        fetchAlerts();
      });

      socket.on('sos-resolved-broadcast', (data) => {
        setSosEvents(prev => {
          const next = { ...prev };
          delete next[data.soldierId];
          return next;
        });
        if (activeSosNode && activeSosNode.soldierId === data.soldierId) {
          setActiveSosNode(null);
        }
        setSoldiers(prev => prev.map(s => s.id === parseInt(data.soldierId, 10) ? { ...s, status: 'active' } : s));
        addFeedEvent(`✅ Emergency status cleared for Soldier #${data.soldierId}.`);
      });

      socket.on('threat-broadcast', (data) => {
        setAlerts(prev => [data, ...prev]);
        addFeedEvent(`⚠️ THREAT WARNING: [${data.type}] - ${data.detail}`);
      });

      socket.on('mission-broadcast', (data) => {
        fetchMissions();
        addFeedEvent(`📋 Mission Updated: "${data.mission.title}" assigned.`);
      });

      socket.on('mission-completed-broadcast', (data) => {
        fetchMissions();
        addFeedEvent(`🏆 Mission #${data.missionId} Completed. AI summary logged.`);
      });

      socket.on('secure-chat-broadcast', (data) => {
        // Decrypt text client-side
        const decrypted = decryptMessage(data.encryptedText);
        setChatMessages(prev => [...prev, {
          sender: data.sender,
          text: decrypted,
          encryptedText: data.encryptedText, // save to demonstrate encrypted state
          timestamp: data.timestamp
        }]);
      });

      socket.on('simulation-broadcast', (data) => {
        setSimEvents(prev => ({ ...prev, [data.eventType]: data.active }));
        addFeedEvent(`📡 Simulation Event Triggered: ${data.eventType.toUpperCase()} -> ${data.active ? 'ACTIVE' : 'OFFLINE'}`);
      });
    }

    return () => {
      if (socket) {
        socket.off('soldier-position-update');
        socket.off('sos-broadcast');
        socket.off('sos-resolved-broadcast');
        socket.off('threat-broadcast');
        socket.off('mission-broadcast');
        socket.off('secure-chat-broadcast');
        socket.off('simulation-broadcast');
      }
    };
  }, [socket, activeSosNode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const [feedEvents, setFeedEvents] = useState([
    'System initialization successful.',
    'Tactical secure socket handshakes ready.',
    'Training simulation environment armed.'
  ]);

  const addFeedEvent = (msg) => {
    setFeedEvents(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15)]);
  };

  const fetchSoldiers = async () => {
    try {
      const res = await fetch('http://localhost:5005/api/soldiers');
      const data = await res.json();
      setSoldiers(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMissions = async () => {
    try {
      const res = await fetch('http://localhost:5005/api/missions');
      const data = await res.json();
      setMissions(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('http://localhost:5005/api/health');
      const data = await res.json();
      // Load alerts or generic system notifications
      setAlerts(data.valkeyMetrics?.keysList || []);
    } catch (e) {
      console.error(e);
    }
  };

  // --- Handlers ---
  
  // 1. Create Mission (Sorted Set priority assignment)
  const handleCreateMission = async (e) => {
    e.preventDefault();
    if (!newMission.title || !newMission.assignedTo) return;

    try {
      const res = await fetch('http://localhost:5005/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMission)
      });
      if (res.ok) {
        setNewMission({
          title: '',
          description: '',
          priority: 3,
          sector: 'Sector Grid Echo',
          assignedTo: ''
        });
        addFeedEvent('Mission launched and pushed to Valkey Sorted Set.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 2. Resolve Active SOS alert
  const handleResolveSos = (soldierId) => {
    if (socket) {
      socket.emit('sos-resolve', { soldierId });
    }
  };

  // 3. Encrypted Chat Message (AES-256)
  const handleSendSecureChat = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    // Encrypt cleartext client-side using AES
    const ciphertext = encryptMessage(newMessage);

    socket.emit('chat-message', {
      sender: `HQ (${user.rank} ${user.name.split(' ').pop()})`,
      encryptedText: ciphertext,
      timestamp: new Date().toLocaleTimeString(),
      recipientRole: 'all'
    });

    setNewMessage('');
  };

  // 4. Toggle Simulation Environmental Override (e.g. Electronic warfare Jamming)
  const handleToggleSimulation = (eventType) => {
    const nextState = !simEvents[eventType];
    setSimEvents(prev => ({ ...prev, [eventType]: nextState }));
    if (socket) {
      socket.emit('simulation-event-trigger', { eventType, active: nextState });
    }
  };

  // 5. Mission Event Replay System (Valkey Streams)
  const handleActivateReplay = async () => {
    if (isReplayMode) {
      setIsReplayMode(false);
      setReplayPlaying(false);
      clearInterval(replayTimer.current);
      fetchSoldiers();
      return;
    }

    try {
      const res = await fetch('http://localhost:5005/api/replay');
      const events = await res.json();
      if (events.length === 0) {
        alert('No event history found in Valkey Streams. Perform tracking movements or trigger alerts first!');
        return;
      }
      setReplayEvents(events);
      setReplayIndex(0);
      setIsReplayMode(true);
      addFeedEvent(`Entering Mission Replay mode. Streams buffer loaded: ${events.length} events.`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStepReplay = (index) => {
    if (index < 0 || index >= replayEvents.length) return;
    setReplayIndex(index);
    const event = replayEvents[index];

    // Simulate event on the map/telemetry list
    if (event.type === 'soldier-moved') {
      const { soldierId, lng, lat, battery_level, status } = event.payload;
      setSoldiers(prev => prev.map(s => s.id === soldierId ? {
        ...s,
        last_location: { lng, lat },
        battery_level,
        status
      } : s));
    } else if (event.type === 'sos-activated') {
      const { soldierId, lat, lng } = event.payload;
      setSosEvents(prev => ({
        ...prev,
        [soldierId]: { soldierId, lat, lng, reason: 'Replay trigger state', timestamp: new Date() }
      }));
      setSoldiers(prev => prev.map(s => s.id === parseInt(soldierId, 10) ? { ...s, status: 'sos' } : s));
    } else if (event.type === 'sos-resolved') {
      const { soldierId } = event.payload;
      setSosEvents(prev => {
        const next = { ...prev };
        delete next[soldierId];
        return next;
      });
      setSoldiers(prev => prev.map(s => s.id === parseInt(soldierId, 10) ? { ...s, status: 'active' } : s));
    }
  };

  const handlePlayReplay = () => {
    if (replayPlaying) {
      setReplayPlaying(false);
      clearInterval(replayTimer.current);
    } else {
      setReplayPlaying(true);
      replayTimer.current = setInterval(() => {
        setReplayIndex(prev => {
          const next = prev + 1;
          if (next >= replayEvents.length) {
            setReplayPlaying(false);
            clearInterval(replayTimer.current);
            return prev;
          }
          handleStepReplay(next);
          return next;
        });
      }, 1000);
    }
  };

  const handleResetReplay = () => {
    setReplayPlaying(false);
    clearInterval(replayTimer.current);
    setReplayIndex(0);
    handleStepReplay(0);
  };

  const handleManualMapClick = (lng, lat) => {
    // Commander simulated click relocation tool
    // We relocate the first soldier for testing geofences
    const firstSoldier = soldiers.find(s => s.role === 'soldier' && s.status !== 'offline');
    if (firstSoldier && socket) {
      addFeedEvent(`Manual relocator: Relocated ${firstSoldier.name} coordinates.`);
      socket.emit('soldier-telemetry', {
        soldierId: firstSoldier.id,
        lng,
        lat,
        battery_level: firstSoldier.battery_level,
        status: firstSoldier.status
      });
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 max-w-7xl mx-auto py-2">
      
      {/* 1. Header Banner */}
      <div className="col-span-12 glass-panel px-6 py-4 rounded-xl border border-neon-cyan/20 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-widest text-white flex items-center gap-2">
            <Radio className="w-6 h-6 text-neon-cyan animate-pulse" />
            SENTINELOPS COMMAND HQ
          </h2>
          <p className="text-xs text-white/50 font-mono mt-1">
            SECTOR: LOG-LA-01 | EXERCISE STATUS: ACTIVE | AUTH: {user.rank} {user.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleActivateReplay}
            className={`px-4 py-1.5 rounded font-mono text-xs flex items-center gap-2 transition-all cursor-pointer ${
              isReplayMode 
                ? 'bg-amber-yellow text-black border border-amber-yellow glow-cyan'
                : 'bg-dark-grey text-white border border-white/10 hover:border-neon-cyan'
            }`}
          >
            <Activity className="w-4 h-4" />
            {isReplayMode ? 'EXIT REPLAY MODE' : 'MISSION STREAM REPLAY'}
          </button>
          <div className="glass-panel px-4 py-1.5 rounded border border-emerald-500/20 text-emerald-400 font-mono text-xs flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            SECURE LINK ESTABLISHED
          </div>
        </div>
      </div>

      {/* Replay Deck Controls */}
      {isReplayMode && (
        <div className="col-span-12 glass-panel-cyan p-4 rounded-xl border border-amber-yellow/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-amber-yellow font-mono text-xs">
            <Zap className="w-4 h-4 animate-bounce" />
            REPLAY PANEL (VALKEY EVENTS STREAM)
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleResetReplay} className="p-2 rounded bg-dark-grey hover:bg-white/10 text-white cursor-pointer" title="Reset">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={handlePlayReplay} className="px-4 py-1 rounded bg-amber-yellow text-black hover:opacity-90 font-mono text-xs flex items-center gap-1 cursor-pointer">
              {replayPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {replayPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <div className="text-xs text-white/70 font-mono">
              Step {replayIndex + 1} of {replayEvents.length} | Type:{' '}
              <span className="text-neon-cyan font-bold">{replayEvents[replayIndex]?.type || 'N/A'}</span>
            </div>
          </div>
          <input 
            type="range" 
            min="0" 
            max={replayEvents.length - 1} 
            value={replayIndex}
            onChange={(e) => handleStepReplay(parseInt(e.target.value, 10))}
            className="w-1/3 accent-amber-yellow cursor-pointer"
          />
        </div>
      )}

      {/* 2. Tactical Map Grid Center */}
      <div className="col-span-12 lg:col-span-8 space-y-6">
        <div className="glass-panel p-4 rounded-xl border border-white/5 relative">
          <TacticalMap 
            soldiers={soldiers}
            restrictedZones={[
              { name: 'Prohibited Sector Red (Zone Alpha)', centerLng: -118.2450, centerLat: 34.0535, radiusMeters: 150 },
              { name: 'Minefield Danger (Zone Delta)', centerLng: -118.2415, centerLat: 34.0505, radiusMeters: 100 }
            ]}
            threats={alerts.filter(a => a.type && a.type.toLowerCase().includes('intrusion'))}
            onMapClick={handleManualMapClick}
            sosEvents={sosEvents}
            simulationEvents={simEvents}
          />
        </div>

        {/* Tactical Decision Support System (TDSS) Alerts (Wow Feature) */}
        {activeSosNode && (
          <div className="glass-panel-red p-5 rounded-xl border border-emergency-red/40 animate-pulse">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emergency-red/20 rounded-lg text-emergency-red">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-mono text-sm font-bold text-white tracking-widest uppercase">
                      CRITICAL SOS TELEMETRY DETECTED
                    </h3>
                    <p className="text-xs text-white/70 mt-1 font-mono">
                      NODE: SOLDIER #{activeSosNode.soldierId} | COORDS: {activeSosNode.lat.toFixed(4)}, {activeSosNode.lng.toFixed(4)}
                    </p>
                  </div>
                  <button 
                    onClick={() => handleResolveSos(activeSosNode.soldierId)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-mono cursor-pointer"
                  >
                    MARK ENEMY NEUTRALIZED / SOLVED
                  </button>
                </div>

                <div className="mt-3 p-3 bg-black/40 rounded border border-white/5">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                    <div>
                      <span className="text-white/40 block text-[9px]">EMERGENCY REASON</span>
                      <span className="text-white font-bold">{activeSosNode.reason}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[9px]">AI ACTION STRATEGY</span>
                      <span className="text-neon-green font-bold flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 fill-current" /> Auto Recommended
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[9px]">OPTIMAL RESPONDER</span>
                      <span className="text-white font-bold">{activeSosNode.tdss?.name || 'Searching...'}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[9px]">ESTIMATED INTERCEPT TIME</span>
                      <span className="text-amber-yellow font-bold">{activeSosNode.tdss?.etaMinutes || 'N/A'} Minutes ETA</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-white/50">
                    <span className="text-neon-cyan font-bold">HQ Route Vector:</span> Vector overlay is drawn on Tactical HUD mapping {activeSosNode.tdss?.distanceMeters || '0'} meters route trajectory.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Environmental Controller (Low-Connectivity Simulation Panel) */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold tracking-wider text-white mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-cyan" />
            SIMULATION CONTROL MATRIX
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <button 
              onClick={() => handleToggleSimulation('gpsLoss')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.gpsLoss 
                  ? 'bg-emergency-red/20 text-emergency-red border-emergency-red' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <Lock className="w-5 h-5" />
              GPS Signal Loss
            </button>
            <button 
              onClick={() => handleToggleSimulation('jamming')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.jamming 
                  ? 'bg-emergency-red/20 text-emergency-red border-emergency-red' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <Radio className="w-5 h-5 animate-pulse" />
              Comm Jam
            </button>
            <button 
              onClick={() => handleToggleSimulation('heavyRain')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.heavyRain 
                  ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <CloudRain className="w-5 h-5" />
              Heavy Rain
            </button>
            <button 
              onClick={() => handleToggleSimulation('wildfire')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.wildfire 
                  ? 'bg-amber-yellow/20 text-amber-yellow border-amber-yellow' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <Flame className="w-5 h-5 animate-bounce" />
              Wildfire
            </button>
            <button 
              onClick={() => handleToggleSimulation('flood')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.flood 
                  ? 'bg-blue-600/20 text-blue-400 border-blue-600' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <Activity className="w-5 h-5" />
              Flood Alert
            </button>
            <button 
              onClick={() => handleToggleSimulation('massCasualty')}
              className={`p-3 rounded-lg border font-mono text-xs transition-all flex flex-col items-center gap-2 cursor-pointer ${
                simEvents.massCasualty 
                  ? 'bg-emergency-red/20 text-emergency-red border-emergency-red' 
                  : 'bg-dark-grey text-white/60 border-white/5 hover:border-white/20'
              }`}
            >
              <ShieldAlert className="w-5 h-5" />
              Mass Casualty
            </button>
          </div>
        </div>
      </div>

      {/* 3. Right Columns (Telemetry List, Mission Dispatch, Encrypted Chat) */}
      <div className="col-span-12 lg:col-span-4 space-y-6">
        
        {/* Soldier Node Telemetry list */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold tracking-wider text-white mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-cyan" />
            NODE STATUS PANELS
          </h3>
          <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
            {soldiers.map(soldier => {
              const risk = soldier.status === 'sos' ? 95 : (soldier.battery_level < 30 ? 65 : 20);
              return (
                <div key={soldier.id} className="p-3 bg-black/40 rounded border border-white/5 flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="font-bold text-white block">{soldier.rank} {soldier.name}</span>
                    <span className="text-[10px] text-white/50">ID: #{soldier.id}</span>
                  </div>
                  <div className="text-right">
                    <span className={`block font-bold ${
                      soldier.status === 'sos' ? 'text-emergency-red animate-pulse' : 'text-neon-cyan'
                    }`}>
                      {soldier.status.toUpperCase()}
                    </span>
                    <span className="text-[10px] text-white/40 block">Risk: {risk}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mission Assigning Control (Sorted Sets) */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold tracking-wider text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-neon-cyan" />
            DISPATCH SIMULATION MISSION
          </h3>
          <form onSubmit={handleCreateMission} className="space-y-3">
            <div>
              <input 
                type="text" 
                placeholder="Mission Objective Title"
                value={newMission.title}
                onChange={e => setNewMission({ ...newMission, title: e.target.value })}
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-neon-cyan"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <select 
                  value={newMission.priority}
                  onChange={e => setNewMission({ ...newMission, priority: parseInt(e.target.value, 10) })}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-2 text-xs font-mono text-white/80 focus:outline-none"
                >
                  <option value={1}>1: Emergency Rescue</option>
                  <option value={2}>2: Threat Probe</option>
                  <option value={3}>3: Patrol Route</option>
                  <option value={4}>4: Training</option>
                </select>
              </div>
              <div>
                <select 
                  value={newMission.assignedTo}
                  onChange={e => setNewMission({ ...newMission, assignedTo: e.target.value })}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-2 text-xs font-mono text-white/80 focus:outline-none"
                  required
                >
                  <option value="">Assign Node...</option>
                  {soldiers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.rank})</option>
                  ))}
                </select>
              </div>
            </div>
            <button 
              type="submit"
              className="w-full bg-neon-cyan text-black hover:opacity-90 font-bold py-2 rounded text-xs font-mono cursor-pointer transition-all uppercase tracking-wider"
            >
              LAUNCH EXERCISE PATH
            </button>
          </form>
        </div>

        {/* Secure Cryptographic Radio Chat Channel */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col h-72">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <h3 className="font-mono text-xs font-bold text-white flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-neon-cyan" />
              SECURE SECTOR CHANNEL
            </h3>
            <span className="text-[8px] bg-neon-cyan/20 text-neon-cyan px-1.5 py-0.5 rounded font-mono font-bold tracking-widest uppercase">
              AES-256 Enabled
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-2 font-mono text-[11px] leading-tight">
            {chatMessages.length === 0 ? (
              <div className="text-white/30 text-center py-10">No logs on encrypted net.</div>
            ) : (
              chatMessages.map((msg, i) => (
                <div key={i} className="bg-black/20 p-2 rounded border border-white/5 space-y-1">
                  <div className="flex justify-between text-[9px] text-white/50">
                    <span className="font-bold text-neon-cyan">{msg.sender}</span>
                    <span>{msg.timestamp}</span>
                  </div>
                  <p className="text-white text-xs">{msg.text}</p>
                  
                  {/* Demonstrate cryptographic proof panel */}
                  <details className="mt-1">
                    <summary className="text-[8px] text-white/30 cursor-pointer hover:text-white/60">
                      Show Web Network Ciphertext Frame
                    </summary>
                    <div className="bg-black/80 text-[8px] text-emergency-red/80 p-1 mt-1 font-mono break-all select-all">
                      Payload: {msg.encryptedText}
                    </div>
                  </details>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendSecureChat} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Broadcasting cleartext..."
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              className="flex-1 bg-black/40 border border-white/10 rounded px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-neon-cyan"
            />
            <button 
              type="submit"
              className="bg-neon-cyan text-black px-3 rounded flex items-center justify-center hover:opacity-90 cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Live Command Logger Feed */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-xs font-bold tracking-wider text-white mb-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-neon-cyan" />
            HQ EVENT TELEMETRY LOGS
          </h3>
          <div className="space-y-1 font-mono text-[9px] text-white/50 max-h-32 overflow-y-auto">
            {feedEvents.map((evt, idx) => (
              <div key={idx} className="border-l border-neon-cyan/20 pl-2 py-0.5 leading-normal">
                {evt}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
