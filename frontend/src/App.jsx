import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { 
  ShieldAlert, ShieldCheck, Users, Radio, 
  Terminal, Lock, LogOut, Info, Server, Navigation 
} from 'lucide-react';

import DashboardCommander from './components/DashboardCommander';
import DashboardSoldier from './components/DashboardSoldier';
import DashboardAdmin from './components/DashboardAdmin';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('sentinel_auth_token') || null);
  const [role, setRole] = useState(null);
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // Login Form States
  const [selectedRole, setSelectedRole] = useState('commander');
  const [username, setUsername] = useState('Col. Vance Rutherford');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Quick Select Accounts for Evaluation
  const quickAccounts = [
    { name: 'Col. Vance Rutherford', role: 'commander', label: 'Commander (Col. Rutherford)' },
    { name: 'Sgt. Marcus Miller', role: 'soldier', label: 'Soldier (Sgt. Miller)' },
    { name: 'Cpl. Sarah Jenkins', role: 'soldier', label: 'Soldier (Cpl. Jenkins)' },
    { name: 'Pvt. Daniel Chen', role: 'soldier', label: 'Soldier (Pvt. Chen)' },
    { name: 'SysAdmin Prime', role: 'admin', label: 'System Admin (Prime)' }
  ];

  // Auto-fill account credentials on click
  const handleQuickSelect = (acc) => {
    setUsername(acc.name);
    setSelectedRole(acc.role);
    setErrorMsg('');
  };

  // Connect WebSockets
  useEffect(() => {
    if (token && user) {
      const socketUrl = 'http://localhost:5005';
      const newSocket = io(socketUrl);

      newSocket.on('connect', () => {
        setSocketConnected(true);
        console.log('[Socket] Connected to backend telemetry server.');
      });

      newSocket.on('disconnect', () => {
        setSocketConnected(false);
        console.warn('[Socket] Disconnected from server.');
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [token, user]);

  // Handle Login submission
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setErrorMsg('Please supply operator credentials.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('http://localhost:5005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: username, role: selectedRole })
      });
      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('sentinel_auth_token', data.token);
        setToken(data.token);
        setUser(data.user);
        setRole(data.user.role);
      } else {
        setErrorMsg(data.error || 'Authentication failure.');
      }
    } catch (err) {
      setErrorMsg('Central server offline. Running with Simulated mock login.');
      // Offline fallback login for rapid evaluation
      const mockAcc = quickAccounts.find(q => q.name.toLowerCase() === username.toLowerCase());
      const fallbackUser = {
        id: mockAcc ? (mockAcc.name.includes('Rutherford') ? 1 : (mockAcc.name.includes('Miller') ? 2 : 3)) : 99,
        name: username,
        role: selectedRole,
        rank: selectedRole === 'commander' ? 'Colonel' : (selectedRole === 'admin' ? 'SysOps' : 'Private'),
        status: 'active',
        battery_level: 92
      };
      setUser(fallbackUser);
      setToken('mock-jwt-token-sentinel-fallback');
      setRole(selectedRole);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('sentinel_auth_token');
    setToken(null);
    setUser(null);
    setRole(null);
    if (socket) {
      socket.disconnect();
    }
  };

  return (
    <div className="min-h-screen bg-matte-black text-slate-100 font-sans tracking-wide relative tactical-grid">
      
      {/* Visual Header / Status bar when logged in */}
      {user && (
        <header className="border-b border-white/5 bg-navy-dark/95 z-50 sticky top-0 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-5 h-5 text-neon-cyan animate-pulse" />
            <h1 className="font-mono text-sm font-black tracking-widest text-white">
              SENTINELOPS // COMMS SYSTEM
            </h1>
            <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold ${
              socketConnected 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
            }`}>
              {socketConnected ? 'LINK ACTIVE' : 'LOCAL MOCK LINK'}
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-white/60">
              OPERATOR: <span className="text-white font-bold">{user.rank} {user.name}</span>
            </span>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-1 bg-emergency-red/20 text-emergency-red border border-emergency-red/30 px-2.5 py-1 rounded hover:bg-emergency-red/30 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              DISCONNECT
            </button>
          </div>
        </header>
      )}

      <main className="p-4 md:p-6">
        {!user ? (
          /* Login Portal Interface */
          <div className="max-w-md mx-auto my-12 glass-panel p-6 rounded-xl border border-neon-cyan/20 relative overflow-hidden scanlines">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-neon-cyan/5 rounded-full blur-2xl"></div>
            
            <div className="text-center mb-6">
              <div className="inline-flex p-3 bg-neon-cyan/10 rounded-lg text-neon-cyan mb-3">
                <Terminal className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold font-mono tracking-widest text-white">
                SENTINELOPS
              </h2>
              <p className="text-xs text-white/50 font-mono mt-1 uppercase tracking-widest">
                Defense Command & Disaster Response Simulator
              </p>
            </div>

            {errorMsg && (
              <div className="mb-4 bg-emergency-red/10 border border-emergency-red/30 p-3 rounded text-xs font-mono text-emergency-red flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-white/40 block mb-1.5 font-bold uppercase tracking-wider">
                  Operator Signature (Name)
                </label>
                <input 
                  type="text" 
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-neon-cyan"
                  placeholder="Enter full name"
                  required
                />
              </div>

              <div>
                <label className="text-white/40 block mb-1.5 font-bold uppercase tracking-wider">
                  Tactical Operational Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['commander', 'soldier', 'admin'].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRole(r)}
                      className={`py-2 rounded font-bold uppercase transition-all cursor-pointer border ${
                        selectedRole === r 
                          ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan' 
                          : 'bg-black/40 text-white/50 border-white/5 hover:border-white/20'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                type="submit"
                disabled={isLoading}
                className="w-full bg-neon-cyan text-black hover:opacity-95 py-2.5 rounded font-bold transition-all cursor-pointer uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {isLoading ? 'ESTABLISHING SECURE CONNECTION...' : 'AUTHORIZE ACCESS'}
              </button>
            </form>

            {/* Quick selectors deck for easy demonstration */}
            <div className="mt-6 pt-5 border-t border-white/5">
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-widest mb-3 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Quick Access Sandbox Selectors
              </h4>
              <div className="space-y-1.5">
                {quickAccounts.map((acc, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickSelect(acc)}
                    className="w-full text-left bg-black/30 hover:bg-black/60 border border-white/5 hover:border-neon-cyan/20 p-2 rounded text-[11px] font-mono text-white/80 transition-all flex justify-between items-center cursor-pointer"
                  >
                    <span>{acc.label}</span>
                    <span className="text-[9px] opacity-40 uppercase">{acc.role}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>
        ) : (
          /* Role Dashboard router */
          <div className="fade-in">
            {role === 'commander' && <DashboardCommander user={user} socket={socket} />}
            {role === 'soldier' && <DashboardSoldier user={user} socket={socket} />}
            {role === 'admin' && <DashboardAdmin socket={socket} />}
          </div>
        )}
      </main>
    </div>
  );
}
