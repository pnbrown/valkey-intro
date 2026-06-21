import React, { useRef, useEffect, useState } from 'react';
import { Target, ShieldAlert, Navigation, Zap } from 'lucide-react';

export default function TacticalMap({ 
  soldiers = [], 
  restrictedZones = [], 
  threats = [], 
  onMapClick, 
  sosEvents = {},
  simulationEvents = {}
}) {
  const canvasRef = useRef(null);
  const [hoveredSoldier, setHoveredSoldier] = useState(null);

  // Center coordinate mapping parameters for simulated canvas
  // Focus bounds centered around the exercise coordinates in Los Angeles (34.05, -118.24)
  const mapCenter = { lat: 34.0522, lng: -118.2437 };
  const zoomFactor = 160000; // pixels per degree

  const getCanvasCoords = (lng, lat, width, height) => {
    const x = width / 2 + (lng - mapCenter.lng) * zoomFactor;
    const y = height / 2 - (lat - mapCenter.lat) * zoomFactor;
    return { x, y };
  };

  const getMapCoords = (x, y, width, height) => {
    const lng = mapCenter.lng + (x - width / 2) / zoomFactor;
    const lat = mapCenter.lat - (y - height / 2) / zoomFactor;
    return { lng, lat };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const render = () => {
      const width = canvas.width = canvas.parentElement.clientWidth;
      const height = canvas.height = canvas.parentElement.clientHeight || 500;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw Grid Lines & Concentric Radar Rings
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let x = 0; x < width; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const centerX = width / 2;
      const centerY = height / 2;
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
      for (let r = 80; r < Math.max(width, height); r += 80) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // 2. Draw Radar Sweep Animation
      const sweepAngle = (Date.now() / 1500) % (2 * Math.PI);
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) / 2);
      gradient.addColorStop(0, 'rgba(0, 240, 255, 0.01)');
      gradient.addColorStop(1, 'rgba(0, 240, 255, 0.08)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(width, height) / 2, sweepAngle - 0.2, sweepAngle);
      ctx.lineTo(centerX, centerY);
      ctx.closePath();
      ctx.fill();

      // 3. Draw Restricted Geofence Zones (Alpha & Delta)
      restrictedZones.forEach(zone => {
        const { x, y } = getCanvasCoords(zone.centerLng, zone.centerLat, width, height);
        const radius = (zone.radiusMeters / 111300) * zoomFactor; // convert meters to degree pixel representation

        // Pulse border
        const pulse = 1 + Math.sin(Date.now() / 300) * 0.05;
        
        ctx.beginPath();
        ctx.arc(x, y, radius * pulse, 0, 2 * Math.PI);
        ctx.fillStyle = zone.name.includes('Red') ? 'rgba(255, 42, 46, 0.05)' : 'rgba(255, 165, 0, 0.05)';
        ctx.fill();
        ctx.strokeStyle = zone.name.includes('Red') ? 'rgba(255, 42, 46, 0.4)' : 'rgba(255, 165, 0, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Zone Label
        ctx.fillStyle = zone.name.includes('Red') ? '#ff2a2e' : '#ffa500';
        ctx.font = '9px var(--font-mono)';
        ctx.fillText(zone.name.toUpperCase(), x - radius, y - radius - 5);
      });

      // 4. Draw Active Threats/Hazards (Wildfire, Jammer, etc.)
      threats.forEach(threat => {
        if (!threat.location) return;
        const { x, y } = getCanvasCoords(threat.location.lng, threat.location.lat, width, height);
        
        // Draw hazard icon base
        ctx.fillStyle = 'rgba(255, 42, 46, 0.2)';
        ctx.beginPath();
        ctx.arc(x, y, 20 + Math.sin(Date.now() / 150) * 4, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#ff2a2e';
        ctx.font = '10px var(--font-mono)';
        ctx.fillText(`🚨 ${threat.type.toUpperCase()}`, x - 25, y - 28);
      });

      // 5. Draw Simulation Environmental events (Flood, Wildfire overlay)
      if (simulationEvents.wildfire) {
        ctx.fillStyle = 'rgba(255, 165, 0, 0.07)';
        ctx.fillRect(50, 50, 220, 180);
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.2)';
        ctx.strokeRect(50, 50, 220, 180);
        ctx.fillStyle = '#ffa500';
        ctx.fillText('🔥 WILDFIRE DANGER BLOCK A', 60, 70);
      }

      if (simulationEvents.flood) {
        ctx.fillStyle = 'rgba(0, 150, 255, 0.07)';
        ctx.fillRect(width - 300, height - 200, 250, 150);
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.2)';
        ctx.strokeRect(width - 300, height - 200, 250, 150);
        ctx.fillStyle = '#00f0ff';
        ctx.fillText('🌧️ SECTOR FLOOD WARNING ZONE', width - 290, height - 180);
      }

      // 6. Draw AI TDSS Rescue Vectors
      Object.keys(sosEvents).forEach(soldierId => {
        const sos = sosEvents[soldierId];
        if (sos && sos.tdss && sos.tdss.success) {
          const helperId = sos.tdss.soldierId;
          const helper = soldiers.find(s => s.id === helperId);
          const victim = soldiers.find(s => s.id === parseInt(soldierId, 10));

          if (helper && victim && helper.last_location && victim.last_location) {
            const hCoords = getCanvasCoords(helper.last_location.lng, helper.last_location.lat, width, height);
            const vCoords = getCanvasCoords(victim.last_location.lng, victim.last_location.lat, width, height);

            // Draw route connection line
            ctx.beginPath();
            ctx.moveTo(hCoords.x, hCoords.y);
            ctx.lineTo(vCoords.x, vCoords.y);
            ctx.strokeStyle = '#39ff14'; // neon green routing line
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]); // dashed vector
            ctx.stroke();
            ctx.setLineDash([]); // restore solid lines

            // Draw vector text mid-point
            const midX = (hCoords.x + vCoords.x) / 2;
            const midY = (hCoords.y + vCoords.y) / 2;
            ctx.fillStyle = '#39ff14';
            ctx.font = '9px var(--font-mono)';
            ctx.fillText(`AI REC ROUTE: ${sos.tdss.etaMinutes} MIN ETA (${sos.tdss.distanceMeters}m)`, midX + 10, midY);
          }
        }
      });

      // 7. Draw Soldier Node Indicators
      soldiers.forEach(soldier => {
        if (!soldier.last_location) return;

        const { x, y } = getCanvasCoords(soldier.last_location.lng, soldier.last_location.lat, width, height);
        const isSOS = soldier.status === 'sos' || !!sosEvents[soldier.id];

        // Pulsing radar glow if SOS
        if (isSOS) {
          const radiusPulse = 15 + Math.sin(Date.now() / 100) * 10;
          ctx.fillStyle = 'rgba(255, 42, 46, 0.3)';
          ctx.beginPath();
          ctx.arc(x, y, radiusPulse, 0, 2 * Math.PI);
          ctx.fill();

          ctx.strokeStyle = '#ff2a2e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, radiusPulse + 5, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          // Normal unit aura
          ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, 2 * Math.PI);
          ctx.fill();
        }

        // Draw dot
        ctx.fillStyle = isSOS ? '#ff2a2e' : '#00f0ff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fill();

        // Direction cursor styling (pointing arrow)
        ctx.strokeStyle = isSOS ? '#ff2a2e' : '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        // Draw directional sweep pointing north-east
        ctx.lineTo(x + 8, y - 8);
        ctx.stroke();

        // Node Title Tag
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px var(--font-mono)';
        const unitName = `${soldier.rank} ${soldier.name.split(' ').pop()}`;
        ctx.fillText(unitName, x + 10, y + 4);

        // Subtext: status & battery
        ctx.font = '8px var(--font-mono)';
        ctx.fillStyle = soldier.battery_level < 30 ? '#ff2a2e' : 'rgba(255,255,255,0.6)';
        ctx.fillText(`BAT: ${soldier.battery_level}% | ${soldier.status.toUpperCase()}`, x + 10, y + 14);

        // Collision box for hovering info card
        const isMouseClose = hoveredSoldier && hoveredSoldier.id === soldier.id;
        if (isMouseClose) {
          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 8, y - 8, 16, 16);
        }
      });

      // 8. Compass Overlay
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width - 50, 50);
      ctx.lineTo(width - 50, 20);
      ctx.lineTo(width - 55, 30);
      ctx.moveTo(width - 50, 20);
      ctx.lineTo(width - 45, 30);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px var(--font-mono)';
      ctx.fillText('N', width - 53, 15);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [soldiers, restrictedZones, threats, sosEvents, simulationEvents, hoveredSoldier]);

  // Click coordinate relocator (for training control simulation)
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !onMapClick) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const mapCoords = getMapCoords(x, y, width, height);

    // Call callback to let parent update state
    onMapClick(mapCoords.lng, mapCoords.lat);
  };

  return (
    <div className="relative w-full h-[500px] bg-navy-dark rounded-lg overflow-hidden border border-white/5 shadow-2xl scanlines">
      {/* HUD Info bar */}
      <div className="absolute top-3 left-3 z-10 glass-panel px-3 py-1.5 rounded flex items-center gap-2 border border-neon-cyan/20">
        <Target className="w-4 h-4 text-neon-cyan animate-pulse" />
        <span className="text-xs font-mono text-neon-cyan tracking-wider">TACTICAL MAP SIMULATOR V4.0</span>
      </div>

      {simulationEvents.jamming && (
        <div className="absolute top-3 right-3 z-10 bg-emergency-red/80 px-3 py-1 rounded animate-pulse shadow-lg flex items-center gap-1.5 border border-emergency-red">
          <ShieldAlert className="w-4 h-4 text-white" />
          <span className="text-[10px] font-mono text-white font-bold tracking-widest">ELECTRONIC JAMMING ACTIVE</span>
        </div>
      )}

      {/* Canvas */}
      <canvas 
        ref={canvasRef} 
        onClick={handleCanvasClick}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Coordinate Legends overlay */}
      <div className="absolute bottom-2 left-3 z-10 font-mono text-[9px] text-white/40 select-none">
        GRID REF: 34°03'N / 118°14'W | MAP DATA: LOCAL EXERCISE AREA
      </div>

      <div className="absolute bottom-2 right-3 z-10 flex gap-4 text-[9px] font-mono text-white/50">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-neon-cyan"></span> Active Node
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emergency-red animate-ping"></span> SOS Alert
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 border border-dashed border-neon-green"></span> Rescue Vector
        </div>
      </div>
    </div>
  );
}
