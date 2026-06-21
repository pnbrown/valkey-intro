import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, Send, Navigation, Lock, ShieldCheck, 
  RefreshCw, Wifi, WifiOff, MapPin, Zap, CheckCircle 
} from 'lucide-react';
import { encryptMessage, decryptMessage } from '../utils/crypto';
import { queueOfflineAction, getOfflineQueue, processOfflineSync } from '../utils/offlineSync';

export default function DashboardSoldier({ user, socket }) {
  const [coords, setCoords] = useState({ lat: 34.0535, lng: -118.2450 });
  const [battery, setBattery] = useState(user.battery_level || 88);
  const [status, setStatus] = useState(user.status || 'active');
  const [activeMissions, setActiveMissions] = useState([]);
  const [completedSummary, setCompletedSummary] = useState('');

  // Connectivity Emulation States
  const [isConnected, setIsConnected] = useState(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState('CONNECTED');

  // Encryption Chat states
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  const telemetryInterval = useRef(null);
  const chatEndRef = useRef(null);

  // Sync state variables
  useEffect(() => {
    fetchAssignedMissions();
    setOfflineQueueCount(getOfflineQueue().length);

    // Initial GPS location simulation
    // Center of Sector (Los Angeles)
    const baseLng = -118.2450 + (Math.random() - 0.5) * 0.003;
    const baseLat = 34.0535 + (Math.random() - 0.5) * 0.003;
    setCoords({ lat: baseLat, lng: baseLng });

    if (socket) {
      socket.on('mission-broadcast', (data) => {
        if (data.mission.assigned_to === user.id) {
          fetchAssignedMissions();
        }
      });

      socket.on('mission-completed-broadcast', (data) => {
        // Look up if it matches our assigned mission
        fetchAssignedMissions();
        if (data.summary) {
          setCompletedSummary(data.summary);
        }
      });

      socket.on('secure-chat-broadcast', (data) => {
        const decrypted = decryptMessage(data.encryptedText);
        setChatMessages(prev => [...prev, {
          sender: data.sender,
          text: decrypted,
          encryptedText: data.encryptedText,
          timestamp: data.timestamp
        }]);
      });

      socket.on('simulation-broadcast', (data) => {
        if (data.eventType === 'gpsLoss') {
          // Force GPS simulated disconnect
          addLog(`🛰️ Satellite Override: GPS Signal Loss triggered by command.`);
        } else if (data.eventType === 'jamming') {
          // Force Comm Jamming
          setIsConnected(!data.active);
          setSyncStatus(data.active ? 'SIGNAL JAMMED' : 'CONNECTED');
          addLog(`📡 EMP Alert: Comms Jammer ${data.active ? 'ENGAGED' : 'DEACTIVATED'}.`);
        }
      });
    }

    // Telemetry Update Interval
    telemetryInterval.current = setInterval(() => {
      // Simulate minor soldier movements
      setCoords(prev => {
        const lngShift = (Math.random() - 0.5) * 0.00015;
        const latShift = (Math.random() - 0.5) * 0.00015;
        const next = { lat: prev.lat + latShift, lng: prev.lng + lngShift };

        // Automatically send telemetry if connected
        if (isConnected && socket) {
          socket.emit('soldier-telemetry', {
            soldierId: user.id,
            lng: next.lng,
            lat: next.lat,
            battery_level: battery,
            status: status
          });
        } else {
          // Queue telemetry in LocalStorage offline buffer
          queueOfflineAction('soldier-telemetry', {
            soldierId: user.id,
            lng: next.lng,
            lat: next.lat,
            battery_level: battery,
            status: status
          });
          setOfflineQueueCount(getOfflineQueue().length);
        }

        return next;
      });

      // Battery slow discharge
      setBattery(prev => Math.max(1, prev - 1));
    }, 4000);

    return () => {
      clearInterval(telemetryInterval.current);
      if (socket) {
        socket.off('mission-broadcast');
        socket.off('mission-completed-broadcast');
        socket.off('secure-chat-broadcast');
        socket.off('simulation-broadcast');
      }
    };
  }, [socket, isConnected, battery, status]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const [logs, setLogs] = useState([
    'Tactical Node HUD initialized.',
    'Geofence monitors verified.',
    'AES cryptographic channel key synchronized.'
  ]);

  const addLog = (msg) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 10)]);
  };

  const fetchAssignedMissions = async () => {
    try {
      const res = await fetch(`http://localhost:5005/api/missions`);
      const allMissions = await res.json();
      // Filter for this soldier's assigned missions
      const myMissions = allMissions.filter(m => m.assigned_to === user.id);
      setActiveMissions(myMissions);
    } catch (e) {
      console.error(e);
    }
  };

  // --- Actions ---

  // 1. Critical SOS Button Trigger
  const handleTriggerSos = () => {
    const nextStatus = status === 'sos' ? 'active' : 'sos';
    setStatus(nextStatus);

    const payload = {
      soldierId: user.id,
      lat: coords.lat,
      lng: coords.lng,
      reason: 'Biometric stress threshold breached or operator triggered.'
    };

    if (nextStatus === 'sos') {
      addLog('🚨 CRITICAL: SOS Signal pushed to central command!');
      if (isConnected && socket) {
        socket.emit('sos-trigger', payload);
      } else {
        queueOfflineAction('sos-trigger', payload);
        setOfflineQueueCount(getOfflineQueue().length);
        addLog('💾 Network offline. SOS Alert queued in offline memory.');
      }
    } else {
      addLog('Emergency SOS resolved. Restoring normal status.');
      if (socket) {
        socket.emit('sos-resolve', { soldierId: user.id });
      }
    }
  };

  // 2. Encrypted Radio Message Dispatch
  const handleSendChat = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const cipherText = encryptMessage(newMessage);
    const payload = {
      sender: `${user.rank} ${user.name.split(' ').pop()}`,
      encryptedText: cipherText,
      timestamp: new Date().toLocaleTimeString(),
      recipientRole: 'all'
    };

    if (isConnected && socket) {
      socket.emit('chat-message', payload);
    } else {
      queueOfflineAction('chat-message', payload);
      setOfflineQueueCount(getOfflineQueue().length);
      addLog('💾 Message stored in offline cache.');
    }

    setNewMessage('');
  };

  // 3. Simulated Connection Toggler (simulate electronic jamming / low network)
  const toggleConnection = () => {
    if (!isConnected) {
      setIsConnected(true);
      setSyncStatus('SYNCING...');
      addLog('📡 Connection recovered. Draining LocalStorage sync queue...');
      
      // Drain queue
      processOfflineSync(socket, (current, total, item) => {
        addLog(`Syncing event ${current}/${total}: [${item.type}]`);
        setOfflineQueueCount(total - current);
      }).then(() => {
        setSyncStatus('CONNECTED');
        setOfflineQueueCount(0);
        addLog('✅ All offline logs synchronized with Valkey.');
      });
    } else {
      setIsConnected(false);
      setSyncStatus('OFFLINE MODE');
      addLog('⚠️ Connection terminated. Switched to Offline-First Queue.');
    }
  };

  const handleCompleteMissionLocal = (missionId) => {
    if (socket && isConnected) {
      socket.emit('mission-complete', { missionId });
    } else {
      addLog('⚠️ Cannot finalize mission while offline. Establish link first.');
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 max-w-5xl mx-auto py-2">
      
      {/* HUD Info Header */}
      <div className="col-span-12 glass-panel px-6 py-4 rounded-xl border border-white/5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-mono tracking-widest text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-neon-cyan animate-pulse" />
            FIELD OPERATOR HUD: {user.rank.toUpperCase()} {user.name.toUpperCase()}
          </h2>
          <p className="text-xs text-white/50 font-mono mt-1">
            STATUS: {status.toUpperCase()} | GPS COORDS: {coords.lat.toFixed(6)}°N, {coords.lng.toFixed(6)}°W
          </p>
        </div>

        {/* Connectivity Quality Indicator */}
        <div className="flex items-center gap-3">
          <button 
            onClick={toggleConnection}
            className={`px-3 py-1.5 rounded font-mono text-xs flex items-center gap-2 border cursor-pointer transition-all ${
              isConnected 
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20 hover:border-emerald-400' 
                : 'bg-amber-950/40 text-amber-500 border-amber-500/20 hover:border-amber-400'
            }`}
          >
            {isConnected ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-amber-500" />}
            {syncStatus} (TOGGLE DISCONNECT)
          </button>
          
          <div className="glass-panel px-3 py-1.5 rounded border border-white/10 text-xs font-mono">
            🔋 Battery: <span className={battery < 30 ? 'text-emergency-red font-bold animate-pulse' : 'text-neon-cyan'}>{battery}%</span>
          </div>
        </div>
      </div>

      {/* Offline Sync State Overlay Warning */}
      {offlineQueueCount > 0 && (
        <div className="col-span-12 bg-amber-yellow/20 p-3 rounded-lg border border-amber-yellow/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-yellow font-mono text-xs">
            <RefreshCw className="w-4 h-4 animate-spin" />
            OFFLINE QUEUE ACTIVE: {offlineQueueCount} ACTIONS PENDING SYNCHRONIZATION
          </div>
          <span className="text-[10px] font-mono text-amber-yellow/80">
            Will automatically flush coordinates and reports when radio link resumes.
          </span>
        </div>
      )}

      {/* 1. Giant Glowing SOS Button (Center of Soldier Operations) */}
      <div className="col-span-12 md:col-span-5 flex flex-col items-center justify-center p-6 glass-panel rounded-xl border border-white/5 min-h-[350px]">
        <div className="text-center mb-6">
          <h3 className="font-mono text-sm font-bold text-white tracking-widest uppercase">
            TACTICAL ALARM PANEL
          </h3>
          <p className="text-[10px] text-white/50 font-mono mt-1">
            IN CASE OF INJURY OR AMBUSH PRESS BUTTON TO BROADCAST ALERT TO HQ
          </p>
        </div>

        <button 
          onClick={handleTriggerSos}
          className={`w-48 h-48 rounded-full flex flex-col items-center justify-center gap-3 transition-all duration-300 transform active:scale-95 cursor-pointer relative ${
            status === 'sos'
              ? 'bg-emergency-red text-white border-4 border-white animate-pulse glow-red'
              : 'bg-dark-grey text-emergency-red border-4 border-emergency-red/40 hover:border-emergency-red hover:bg-emergency-red/10 shadow-xl'
          }`}
        >
          <ShieldAlert className={`w-16 h-16 ${status === 'sos' ? 'text-white' : 'text-emergency-red'}`} />
          <span className="font-mono font-black text-lg tracking-widest">
            {status === 'sos' ? 'SOS ACTIVE' : 'TRIGGER SOS'}
          </span>
        </button>

        <div className="mt-6 text-[10px] font-mono text-white/40 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> SECURE SATELLITE DISPATCH
        </div>
      </div>

      {/* 2. Mission list, encrypted radio, and simulation logger */}
      <div className="col-span-12 md:col-span-7 space-y-6">
        
        {/* Mission Objectives Deck */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold text-white tracking-widest mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-neon-cyan" />
            ASSIGNED MISSION DETAILS
          </h3>
          {activeMissions.length === 0 ? (
            <div className="text-center py-8 text-white/30 font-mono text-xs">
              No active training assignments dispatched from command.
            </div>
          ) : (
            activeMissions.map(m => (
              <div key={m.id} className="p-4 bg-black/40 rounded border border-white/5 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-mono text-xs font-bold text-white uppercase">{m.title}</h4>
                    <p className="text-[10px] text-white/50 mt-1">{m.description}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono ${
                    m.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neon-cyan/20 text-neon-cyan'
                  }`}>
                    {m.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-mono pt-2 border-t border-white/5">
                  <span className="text-white/40">SECTOR: {m.sector}</span>
                  {m.status !== 'completed' && (
                    <button 
                      onClick={() => handleCompleteMissionLocal(m.id)}
                      className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[9px] cursor-pointer"
                    >
                      COMPLETE MISSION
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* AI Generated Mission Summary Debrief */}
          {completedSummary && (
            <div className="mt-3 p-3 bg-neon-cyan/5 rounded border border-neon-cyan/20 font-mono text-[10px] text-neon-cyan whitespace-pre-line">
              <div className="font-bold flex items-center gap-1 mb-1">
                <Zap className="w-3.5 h-3.5 fill-current" /> AI TIE MISSION BRIEFING SUMMARY LOG
              </div>
              {completedSummary}
            </div>
          )}
        </div>

        {/* Secure AES Radio room */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col h-64">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <h3 className="font-mono text-xs font-bold text-white flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-neon-cyan" />
              SECURE CHAT: OPERATOR RADIO
            </h3>
            <span className="text-[8px] bg-neon-cyan/20 text-neon-cyan px-1.5 py-0.5 rounded font-mono font-bold tracking-widest uppercase">
              AES-256 Enabled
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-2 font-mono text-[11px] leading-tight">
            {chatMessages.map((msg, i) => (
              <div key={i} className="bg-black/20 p-2 rounded border border-white/5">
                <div className="flex justify-between text-[9px] text-white/50 mb-0.5">
                  <span className="font-bold text-neon-cyan">{msg.sender}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <p className="text-white text-xs">{msg.text}</p>
                <details className="mt-1">
                  <summary className="text-[8px] text-white/30 cursor-pointer">
                    Show Encrypted Frame Payload
                  </summary>
                  <div className="bg-black/85 text-[8px] text-emergency-red/80 p-1 mt-1 break-all select-all">
                    {msg.encryptedText}
                  </div>
                </details>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendChat} className="flex gap-2">
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

        {/* Soldier Activity logs */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-xs font-bold text-white mb-2">
            NODE HUB EVENT METRICS
          </h3>
          <div className="space-y-1 font-mono text-[9px] text-white/50 max-h-24 overflow-y-auto">
            {logs.map((log, idx) => (
              <div key={idx} className="border-l border-white/10 pl-2 py-0.5 leading-normal">
                {log}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
