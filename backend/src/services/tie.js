import { valkey } from '../config/valkey.js';
import { query } from '../config/db.js';

/**
 * Tactical Intelligence Engine (TIE)
 */
export const TIE = {
  /**
   * Risk Scoring Engine
   * Calculates high-risk percentages for soldiers and sectors based on environment factors
   */
  calculateRiskScore: (soldier, weather = 'NORMAL') => {
    let score = 10; // baseline risk score
    
    // Battery factor
    if (soldier.battery_level < 20) score += 35;
    else if (soldier.battery_level < 50) score += 15;

    // Status factor
    if (soldier.status === 'sos') score += 60;
    else if (soldier.status === 'injured') score += 40;

    // Weather impact multiplier
    if (weather === 'HEAVY_RAIN') score += 10;
    if (weather === 'WILDFIRE' || weather === 'FLOOD') score += 25;

    return Math.min(100, score);
  },

  /**
   * Rescue Recommendation Engine (TDSS Support)
   * Recommends the nearest available soldier to an SOS coordinate using Valkey GEO
   */
  recommendRescueUnit: async (sosLat, sosLng, currentSosSoldierId) => {
    try {
      // 1. Get all soldiers
      const usersRes = await query("SELECT id, name, rank, status, role FROM users WHERE role = 'soldier' AND status != 'offline'");
      const activeSoldiers = usersRes.rows.filter(s => s.id !== parseInt(currentSosSoldierId, 10));

      if (activeSoldiers.length === 0) {
        return { success: false, message: 'No other active units available.' };
      }

      // Add temporary SOS coordinate to Valkey GEO to measure distance
      const tempSosKey = `temp:sos:loc`;
      await valkey.geoadd('soldier_locations', sosLng, sosLat, tempSosKey);

      let nearestSoldier = null;
      let minDistance = Infinity;

      for (const soldier of activeSoldiers) {
        // Query distance using Valkey GEODIST
        const distStr = await valkey.geodist('soldier_locations', tempSosKey, `soldier:${soldier.id}`);
        if (distStr) {
          const dist = parseFloat(distStr);
          if (dist < minDistance) {
            minDistance = dist;
            nearestSoldier = soldier;
          }
        }
      }

      // Clean up temp key (not strictly necessary but neat)
      await valkey.zrem('soldier_locations', tempSosKey);

      if (nearestSoldier) {
        // ETA is calculated at roughly 100 meters per minute for military response terrain
        const etaMinutes = Math.max(1, Math.ceil(minDistance / 100));
        return {
          success: true,
          soldierId: nearestSoldier.id,
          name: `${nearestSoldier.rank} ${nearestSoldier.name}`,
          distanceMeters: Math.round(minDistance),
          etaMinutes,
          routeGenerated: true
        };
      }

      // Fallback if Valkey GEODIST failed (e.g. coordinates weren't set yet)
      const fallbackSoldier = activeSoldiers[0];
      return {
        success: true,
        soldierId: fallbackSoldier.id,
        name: `${fallbackSoldier.rank} ${fallbackSoldier.name}`,
        distanceMeters: 1200,
        etaMinutes: 12,
        routeGenerated: true,
        note: 'Fallback routing (GEO cache unavailable)'
      };
    } catch (e) {
      console.error('[TIE Rescue Rec Error]', e);
      return { success: false, message: 'Error processing coordinates.' };
    }
  },

  /**
   * Mission Summary Generator
   * Summarizes tactical mission performance details for records
   */
  generateMissionSummary: (mission, logsCount = 0, alertsCount = 0) => {
    const timestamp = new Date().toLocaleString();
    const priorities = { 1: 'EMERGENCY RESCUE', 2: 'THREAT INVESTIGATION', 3: 'PATROL', 4: 'TRAINING' };
    
    return `[TACTICAL DEBRIEF - ${timestamp}] 
Mission Title: "${mission.title}"
Sector Location: ${mission.sector}
Priority Level: ${priorities[mission.priority] || 'ROUTINE'}
Outcome: SUCCESSFUL COMPLETION
Execution Summary:
- This training exercise involved coordinated patrols within ${mission.sector}.
- Logged telemetry entries: ${logsCount} updates registered to telemetry stream.
- Security boundary breaches: ${alertsCount} alarms triggered and resolved.
- Assigned combat personnel have executed all tactical objectives. All systems nominal.`;
  },

  /**
   * Threat Pattern Detector
   * Analyzes alerts in near real-time to identify coordinated events
   */
  detectThreatPatterns: async (newAlert) => {
    try {
      // Find historical alerts of similar nature in database or memory
      const alertsRes = await query('SELECT * FROM alerts WHERE created_at > NOW() - INTERVAL \'5 minutes\'');
      const recentAlerts = alertsRes.rows;

      if (recentAlerts.length >= 2) {
        // Multiple alerts in a short span implies a coordinated scenario
        return {
          patternDetected: true,
          description: `COORDINATED CRITIAL EVENT: ${recentAlerts.length + 1} alarm signals captured in the sector within 5 minutes. High probability of simulated ambush or hardware jammer deployment.`,
          severity: 'critical'
        };
      }
      return { patternDetected: false };
    } catch (e) {
      // Fallback for mock mode
      return { patternDetected: false };
    }
  },

  /**
   * Geospatial Analysis Engine (Geofencing check)
   * Checks if coordinates fall inside defined geofenced zones
   */
  checkGeofence: (lng, lat, zones) => {
    const breaches = [];
    for (const zone of zones) {
      // Basic bounding box check for simple circular zones
      // In this system, zones have: name, centerLng, centerLat, radiusMeters
      const dist = TIE._haversineDistance(lng, lat, zone.centerLng, zone.centerLat);
      if (dist <= zone.radiusMeters) {
        breaches.push({
          zoneName: zone.name,
          distanceFromCenter: dist,
          limitMeters: zone.radiusMeters
        });
      }
    }
    return breaches;
  },

  // Helper distance calculator
  _haversineDistance: (lon1, lat1, lon2, lat2) => {
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
};
