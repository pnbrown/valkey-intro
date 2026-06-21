import { valkey } from '../config/valkey.js';

export const valkeyService = {
  /**
   * Updates coordinates in Valkey GEO structure: soldier_locations
   */
  updateSoldierLocation: async (soldierId, lng, lat) => {
    try {
      const key = `soldier:${soldierId}`;
      await valkey.geoadd('soldier_locations', lng, lat, key);
      // Also cache coordinate values as temporary backup hash with TTL for tracking integrity
      await valkey.set(`soldier:coords:${soldierId}`, JSON.stringify({ lng, lat }), 'EX', 3600);
      return true;
    } catch (e) {
      console.error('[ValkeyService] GEO Location caching failed', e);
      return false;
    }
  },

  /**
   * Retrieves coordinates from Valkey GEO structure
   */
  getSoldierLocation: async (soldierId) => {
    try {
      const key = `soldier:${soldierId}`;
      const pos = await valkey.geopos('soldier_locations', key);
      if (pos && pos[0]) {
        return { lng: pos[0][0], lat: pos[0][1] };
      }
      // Try fallback from backing cache
      const cached = await valkey.get(`soldier:coords:${soldierId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      console.error('[ValkeyService] GEO Location lookup failed', e);
      return null;
    }
  },

  /**
   * Push mission assignments to Valkey Sorted Set
   * Priority values: 1 (Rescue), 2 (Threat), 3 (Patrol), 4 (Training)
   * A lower priority number maps to higher urgency
   */
  addMissionToPriorityQueue: async (missionId, priority) => {
    try {
      // Score = Priority (lower score is popped first)
      await valkey.zadd('priority_missions', priority, `mission:${missionId}`);
      // Log to double-queue mechanism
      await valkey.lpush('mission_queue', `mission:${missionId}`);
      return true;
    } catch (e) {
      console.error('[ValkeyService] Priority queue push failed', e);
      return false;
    }
  },

  /**
   * Retrieves all missions in the priority queue ordered by urgency
   */
  getPriorityMissions: async () => {
    try {
      // Returns members ordered by score ascending (Priority 1 first)
      const list = await valkey.zrange('priority_missions', 0, -1);
      return list;
    } catch (e) {
      console.error('[ValkeyService] Priority queue read failed', e);
      return [];
    }
  },

  /**
   * Remove mission from the priority queue
   */
  removeMissionFromPriorityQueue: async (missionId) => {
    try {
      await valkey.zrem('priority_missions', `mission:${missionId}`);
      return true;
    } catch (e) {
      console.error('[ValkeyService] Priority queue removal failed', e);
      return false;
    }
  },

  /**
   * Logs tactical events inside Valkey Stream 'mission_events' for Replay System
   */
  logMissionEvent: async (eventType, payload) => {
    try {
      const timestamp = Date.now().toString();
      await valkey.xadd(
        'mission_events',
        '*', // automatic ID generation
        'type', eventType,
        'payload', JSON.stringify(payload),
        'timestamp', timestamp
      );
      return true;
    } catch (e) {
      console.error('[ValkeyService] Stream logging failed', e);
      return false;
    }
  },

  /**
   * Retrieves chronological logs from Valkey Stream for replay
   */
  getMissionEvents: async () => {
    try {
      // Fetch stream events
      const rawEvents = await valkey.xrange('mission_events', '-', '+');
      return rawEvents.map(event => {
        const id = event[0];
        const fields = event[1];
        return {
          id,
          type: fields.type,
          payload: fields.payload ? JSON.parse(fields.payload) : {},
          timestamp: parseInt(fields.timestamp || Date.now(), 10)
        };
      });
    } catch (e) {
      console.error('[ValkeyService] Stream read failed', e);
      return [];
    }
  },

  /**
   * Sliding window Rate Limiter utilizing Valkey
   * Prevents spam / Denial of Service on socket triggers and API calls
   */
  rateLimit: async (ip, limit = 20, windowSecs = 10) => {
    try {
      const key = `ratelimit:${ip}`;
      const current = await valkey.get(key);
      
      if (current === null) {
        // First request, set key with TTL
        await valkey.set(key, 1, 'EX', windowSecs);
        return { allowed: true, remaining: limit - 1 };
      }

      const count = parseInt(current, 10);
      if (count >= limit) {
        return { allowed: false, remaining: 0 };
      }

      // Increment value. If Valkey simulator is running, get ttl via TTL command.
      const timeRemaining = await valkey.ttl(key);
      const val = count + 1;
      await valkey.set(key, val, 'EX', timeRemaining > 0 ? timeRemaining : windowSecs);

      return { allowed: true, remaining: limit - val };
    } catch (e) {
      // Fallback if Valkey fails - allow request
      return { allowed: true, remaining: limit };
    }
  },

  /**
   * Queries general Valkey key space metrics to render on the Admin dashboard
   */
  getValkeyMetrics: async () => {
    try {
      const allKeys = await valkey.keys('*');
      const metrics = {
        totalKeys: allKeys.length,
        keysList: [],
        locationsCached: 0,
        queuedMissions: 0,
        streamEvents: 0
      };

      for (const key of allKeys) {
        let type = 'String';
        let ttlValue = await valkey.ttl(key);

        if (key === 'soldier_locations') {
          type = 'GEO Geospatial';
          const range = await valkey.zrange(key, 0, -1);
          metrics.locationsCached = range.length;
        } else if (key === 'priority_missions') {
          type = 'ZSET (Sorted Set)';
          const range = await valkey.zrange(key, 0, -1);
          metrics.queuedMissions = range.length;
        } else if (key === 'mission_queue') {
          type = 'LIST (Queue)';
        } else if (key === 'mission_events') {
          type = 'STREAM (Logs)';
          const events = await valkey.xrange(key, '-', '+');
          metrics.streamEvents = events.length;
        } else if (key.startsWith('soldier:coords:')) {
          type = 'HASH Location Backup';
        } else if (key.startsWith('ratelimit:')) {
          type = 'String (TTL Rate Limit)';
        }

        metrics.keysList.push({ key, type, ttl: ttlValue });
      }

      return metrics;
    } catch (e) {
      return { totalKeys: 0, keysList: [], error: true };
    }
  }
};
