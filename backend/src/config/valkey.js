import Redis from 'ioredis';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

const valkeyUrl = process.env.VALKEY_URL || 'redis://127.0.0.1:6379';
let valkeyClient = null;
let valkeySubClient = null;
let isValkeyMock = false;

// High-fidelity In-Memory Valkey Simulator
class ValkeyMockSimulator extends EventEmitter {
  constructor() {
    super();
    this.store = new Map();
    this.ttls = new Map();
    this.channels = new Map(); // Pub/Sub channels
    this.streams = new Map(); // Streams storage
    console.log('[Valkey Sim] In-Memory Simulator Active.');
  }

  // Key-value operations
  async set(key, value, mode, duration) {
    this.store.set(key, value);
    if (mode === 'EX' && duration) {
      const expireTime = Date.now() + duration * 1000;
      this.ttls.set(key, expireTime);
      setTimeout(() => {
        if (this.ttls.get(key) === expireTime) {
          this.store.delete(key);
          this.ttls.delete(key);
          this.emit('expired', key);
        }
      }, duration * 1000);
    }
    return 'OK';
  }

  async get(key) {
    this.checkExpiry(key);
    return this.store.get(key) || null;
  }

  async del(key) {
    this.ttls.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key) {
    this.checkExpiry(key);
    return this.store.has(key) ? 1 : 0;
  }

  checkExpiry(key) {
    if (this.ttls.has(key) && this.ttls.get(key) < Date.now()) {
      this.store.delete(key);
      this.ttls.delete(key);
    }
  }

  async ttl(key) {
    this.checkExpiry(key);
    if (!this.store.has(key)) return -2;
    if (!this.ttls.has(key)) return -1;
    return Math.max(0, Math.ceil((this.ttls.get(key) - Date.now()) / 1000));
  }

  // Lists (Queue operations)
  async lpush(key, ...values) {
    if (!this.store.has(key)) this.store.set(key, []);
    const list = this.store.get(key);
    list.unshift(...values);
    return list.length;
  }

  async rpop(key) {
    if (!this.store.has(key)) return null;
    const list = this.store.get(key);
    const item = list.pop();
    if (list.length === 0) this.store.delete(key);
    return item || null;
  }

  async lrange(key, start, stop) {
    if (!this.store.has(key)) return [];
    const list = this.store.get(key);
    const resolvedStop = stop === -1 ? list.length : stop + 1;
    return list.slice(start, resolvedStop);
  }

  // Sorted Sets (Priority Queues)
  async zadd(key, score, member) {
    if (!this.store.has(key)) this.store.set(key, new Map());
    const zset = this.store.get(key);
    zset.set(member, parseFloat(score));
    return 1;
  }

  async zrange(key, start, stop) {
    if (!this.store.has(key)) return [];
    const zset = this.store.get(key);
    const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
    const resolvedStop = stop === -1 ? sorted.length : stop + 1;
    return sorted.slice(start, resolvedStop).map(entry => entry[0]);
  }

  async zrem(key, member) {
    if (!this.store.has(key)) return 0;
    const zset = this.store.get(key);
    const deleted = zset.delete(member);
    if (zset.size === 0) this.store.delete(key);
    return deleted ? 1 : 0;
  }

  // Geospatial
  async geoadd(key, lng, lat, member) {
    if (!this.store.has(key)) this.store.set(key, new Map());
    const geodb = this.store.get(key);
    geodb.set(member, { lat: parseFloat(lat), lng: parseFloat(lng) });
    return 1;
  }

  async geopos(key, member) {
    if (!this.store.has(key)) return [null];
    const geodb = this.store.get(key);
    const pos = geodb.get(member);
    return pos ? [[pos.lng, pos.lat]] : [null];
  }

  async geodist(key, member1, member2) {
    if (!this.store.has(key)) return null;
    const geodb = this.store.get(key);
    const pos1 = geodb.get(member1);
    const pos2 = geodb.get(member2);
    if (!pos1 || !pos2) return null;

    // Haversine formula
    const R = 6371e3; // meters
    const phi1 = (pos1.lat * Math.PI) / 180;
    const phi2 = (pos2.lat * Math.PI) / 180;
    const deltaPhi = ((pos2.lat - pos1.lat) * Math.PI) / 180;
    const deltaLambda = ((pos2.lng - pos1.lng) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return (R * c).toFixed(4); // returns distance in meters
  }

  // Pub/Sub
  async publish(channel, message) {
    const pubSubEmitter = mockPubSubBus;
    pubSubEmitter.emit(channel, message);
    return 1; // 1 subscriber simulated
  }

  // Streams (Replay System)
  async xadd(streamKey, id, ...args) {
    if (!this.streams.has(streamKey)) this.streams.set(streamKey, []);
    const stream = this.streams.get(streamKey);
    const entryId = id === '*' ? `${Date.now()}-${stream.length}` : id;
    
    // Parse key-value arguments
    const fields = {};
    for (let i = 0; i < args.length; i += 2) {
      fields[args[i]] = args[i + 1];
    }

    const newEntry = [entryId, fields];
    stream.push(newEntry);
    this.store.set(streamKey, `Stream (${stream.length} items)`); // make key inspectable
    return entryId;
  }

  async xrange(streamKey, start = '-', end = '+') {
    if (!this.streams.has(streamKey)) return [];
    return this.streams.get(streamKey);
  }

  // Admin key scanner
  async keys(pattern) {
    const keysArray = [...this.store.keys(), ...this.streams.keys()];
    if (pattern === '*') return keysArray;
    const cleanPattern = pattern.replace('*', '');
    return keysArray.filter(key => key.includes(cleanPattern));
  }
}

// Global emitter to act as mock redis pub/sub bus
const mockPubSubBus = new EventEmitter();

// Initialize clients
try {
  valkeyClient = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    retryStrategy: () => null
  });

  valkeySubClient = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    retryStrategy: () => null
  });

  valkeyClient.on('error', (err) => {
    if (!isValkeyMock) {
      console.warn('[Valkey Connection Warning] Service offline. Activating local Valkey Simulator.');
      isValkeyMock = true;
      valkeyClient = new ValkeyMockSimulator();
      valkeySubClient = new EventEmitter(); // Mock sub client
    }
  });

  valkeySubClient.on('error', (err) => {
    // Silenced sub warnings
  });
} catch (e) {
  console.warn('[Valkey Client Creation failed] Falling back to Valkey Mock Simulator.');
  isValkeyMock = true;
  valkeyClient = new ValkeyMockSimulator();
  valkeySubClient = new EventEmitter();
}

export const getValkeyStatus = () => {
  return isValkeyMock ? 'SIMULATOR (IN-MEMORY)' : 'CONNECTED';
};

export const pubsub = {
  publish: async (channel, data) => {
    const payload = typeof data === 'object' ? JSON.stringify(data) : data;
    if (isValkeyMock) {
      return valkeyClient.publish(channel, payload);
    } else {
      try {
        return await valkeyClient.publish(channel, payload);
      } catch (e) {
        return mockPubSubBus.emit(channel, payload);
      }
    }
  },
  subscribe: (channel, callback) => {
    if (isValkeyMock) {
      mockPubSubBus.on(channel, callback);
    } else {
      valkeySubClient.subscribe(channel, (err) => {
        if (err) {
          console.error(`[Valkey Sub Error] Failed to subscribe to ${channel}`);
          mockPubSubBus.on(channel, callback);
        }
      });
      valkeySubClient.on('message', (chan, msg) => {
        if (chan === channel) callback(msg);
      });
    }
  }
};

export { valkeyClient as valkey };
export { isValkeyMock };
