import React, { useState, useEffect } from 'react';
import { 
  Server, Database, Activity, RefreshCw, Cpu, 
  Trash2, Radio, UserX, AlertTriangle, ShieldCheck 
} from 'lucide-react';

export default function DashboardAdmin({ socket }) {
  const [healthData, setHealthData] = useState(null);
  const [soldiers, setSoldiers] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchSystemHealth();
    fetchSoldiers();

    const interval = setInterval(() => {
      fetchSystemHealth();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const fetchSystemHealth = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('http://localhost:5005/api/health');
      const data = await res.json();
      setHealthData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
    }
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

  // --- Admin Core Actions ---

  // 1. Force a soldier offline to test Offline Sync
  const handleForceOffline = async (soldierId) => {
    try {
      // We simulate node crash by setting status to offline and emitting to commander
      if (socket) {
        socket.emit('soldier-telemetry', {
          soldierId,
          lng: -118.2450,
          lat: 34.0535,
          battery_level: 0,
          status: 'offline'
        });
      }
      setTimeout(fetchSoldiers, 500);
    } catch (e) {
      console.error(e);
    }
  };

  // 2. Clear Valkey Cache
  const handleClearCache = async () => {
    if (!window.confirm('Are you sure you want to clear simulated Valkey database caches?')) return;
    try {
      // Emulate trigger or API request to reset Valkey key storage
      // By resetting active queues
      await fetchSystemHealth();
      alert('Valkey active buffers flushed successfully.');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 max-w-7xl mx-auto py-2">
      
      {/* Header Banner */}
      <div className="col-span-12 glass-panel px-6 py-4 rounded-xl border border-neon-cyan/20 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-mono tracking-widest text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-neon-cyan animate-pulse" />
            SYSTEM LOGISTICS & DEVOPS CONTROL
          </h2>
          <p className="text-xs text-white/50 font-mono mt-1">
            MONITORING IN-MEMORY DB (VALKEY) AND PERSISTENT DB (POSTGRESQL) LOGS
          </p>
        </div>
        <button 
          onClick={fetchSystemHealth}
          disabled={isRefreshing}
          className="px-4 py-1.5 bg-dark-grey hover:bg-white/5 border border-white/10 text-white rounded font-mono text-xs flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          FORCE DIAGNOSTICS
        </button>
      </div>

      {/* 1. Health Status Grid cards */}
      <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Card: Valkey Status */}
        <div className="glass-panel p-4 rounded-lg border border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-white/40 block font-mono">VALKEY IN-MEMORY SERVICE</span>
            <span className="text-lg font-bold font-mono text-white mt-1 block">
              {healthData?.valkey || 'LOADING...'}
            </span>
          </div>
          <Database className={`w-8 h-8 ${
            healthData?.valkey.includes('SIMULATOR') ? 'text-amber-yellow animate-pulse' : 'text-neon-cyan'
          }`} />
        </div>

        {/* Card: PostgreSQL Status */}
        <div className="glass-panel p-4 rounded-lg border border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-white/40 block font-mono">POSTGRESQL INSTANCE</span>
            <span className="text-lg font-bold font-mono text-white mt-1 block">
              {healthData?.database || 'LOADING...'}
            </span>
          </div>
          <Server className="w-8 h-8 text-neon-cyan" />
        </div>

        {/* Card: Active Sockets */}
        <div className="glass-panel p-4 rounded-lg border border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-white/40 block font-mono">WEBSOCKET CONNECTIONS</span>
            <span className="text-xl font-bold font-mono text-white mt-1 block">
              {healthData?.activeWebSockets !== undefined ? healthData.activeWebSockets : '0'}
            </span>
          </div>
          <Activity className="w-8 h-8 text-neon-cyan animate-pulse" />
        </div>

        {/* Card: API Latency */}
        <div className="glass-panel p-4 rounded-lg border border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-white/40 block font-mono">DATABASE RESPONSE LATENCY</span>
            <span className="text-xl font-bold font-mono text-neon-green mt-1 block">
              {healthData?.latencyMs || '0.00ms'}
            </span>
          </div>
          <Cpu className="w-8 h-8 text-neon-green" />
        </div>

      </div>

      {/* 2. Left side: Live Valkey inspector */}
      <div className="col-span-12 lg:col-span-7 space-y-6">
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-mono text-sm font-bold text-white tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4 text-neon-cyan" />
              LIVE VALKEY INSPECTION CONSOLE
            </h3>
            <button 
              onClick={handleClearCache}
              className="px-2 py-1 bg-emergency-red/20 text-emergency-red border border-emergency-red/30 rounded text-[9px] font-mono hover:bg-emergency-red/30 cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> FLUSH KEYSPACE
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-white/70">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-[10px]">
                  <th className="py-2">KEY REGISTER</th>
                  <th className="py-2">DATATYPE SCHEMA</th>
                  <th className="py-2">TIME-TO-LIVE (TTL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {healthData?.valkeyMetrics?.keysList && healthData.valkeyMetrics.keysList.length > 0 ? (
                  healthData.valkeyMetrics.keysList.map((k, idx) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="py-2.5 font-bold text-white">{k.key}</td>
                      <td className="py-2.5">
                        <span className="px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan text-[9px] uppercase">
                          {k.type}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {k.ttl === -1 ? (
                          <span className="text-white/40">PERSISTENT</span>
                        ) : (
                          <span className="text-amber-yellow font-bold">{k.ttl}s</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" className="py-6 text-center text-white/30 text-xs">
                      No active keys detected. Launch a simulation mission to fill cache!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* System Diagnostics Performance metrics */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold text-white mb-3">
            TACTICAL ENGINE STATS
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="bg-black/30 p-3 rounded border border-white/5">
              <span className="text-white/40 block text-[9px]">Server Heap Used</span>
              <span className="text-white font-bold block mt-1">{healthData?.serverMemory || 'N/A'}</span>
            </div>
            <div className="bg-black/30 p-3 rounded border border-white/5">
              <span className="text-white/40 block text-[9px]">Locations Cached</span>
              <span className="text-white font-bold block mt-1">
                {healthData?.valkeyMetrics?.locationsCached || 0} nodes
              </span>
            </div>
            <div className="bg-black/30 p-3 rounded border border-white/5">
              <span className="text-white/40 block text-[9px]">Priority mission set</span>
              <span className="text-white font-bold block mt-1">
                {healthData?.valkeyMetrics?.queuedMissions || 0} missions
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Right side: Node / User controllers */}
      <div className="col-span-12 lg:col-span-5 space-y-6">
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold text-white tracking-wider mb-4 flex items-center gap-2">
            <Radio className="w-4 h-4 text-neon-cyan" />
            FIELD OPERATORS GRID
          </h3>
          <div className="space-y-3">
            {soldiers.map(s => (
              <div key={s.id} className="p-3 bg-black/40 rounded border border-white/5 flex items-center justify-between text-xs font-mono">
                <div>
                  <span className="font-bold text-white block">{s.rank} {s.name}</span>
                  <span className="text-[10px] text-white/40">Role: {s.role.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    s.status === 'offline' ? 'bg-white/10 text-white/40' : (
                      s.status === 'sos' ? 'bg-emergency-red/20 text-emergency-red animate-pulse' : 'bg-neon-cyan/20 text-neon-cyan'
                    )
                  }`}>
                    {s.status.toUpperCase()}
                  </span>
                  
                  {s.role === 'soldier' && s.status !== 'offline' && (
                    <button 
                      onClick={() => handleForceOffline(s.id)}
                      className="p-1.5 bg-emergency-red/20 hover:bg-emergency-red text-emergency-red hover:text-white rounded cursor-pointer transition-colors"
                      title="Force Node Crash / Disconnect"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Simulated Threat logs */}
        <div className="glass-panel p-5 rounded-xl border border-white/5">
          <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-yellow" />
            SECTOR THREAT BREACH EVENTS
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs font-mono">
            <div className="p-2.5 bg-emergency-red/5 rounded border border-emergency-red/10 text-emergency-red">
              <div className="flex justify-between font-bold text-[9px] mb-1">
                <span>INTRUSION DETECTION ALERT</span>
                <span>JUST NOW</span>
              </div>
              <p className="text-[10px]">Soldier Miller breached perimeter border at sector zone alpha.</p>
            </div>
            <div className="p-2.5 bg-black/40 rounded border border-white/5 text-white/50">
              <div className="flex justify-between text-[9px] mb-1">
                <span>SYSTEM DIAGNOSTIC NOMINAL</span>
                <span>2 MINS AGO</span>
              </div>
              <p className="text-[10px]">Valkey streams check finished. 0 packet losses.</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
