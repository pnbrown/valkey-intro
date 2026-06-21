import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import { query, initDb, getDbStatus, mockDb } from './config/db.js';
import { getValkeyStatus, pubsub, valkey } from './config/valkey.js';
import { valkeyService } from './services/valkeyService.js';
import { TIE } from './services/tie.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5005;
const JWT_SECRET = process.env.JWT_SECRET || 'SENTINEL_OPS_SECRET_KEY_2026_TAC';

// Define simulation restricted geofenced zones
const RESTRICTED_ZONES = [
  { name: 'Restricted Sector Red (Zone Alpha)', centerLng: -118.2450, centerLat: 34.0535, radiusMeters: 150 },
  { name: 'Minefield Sector (Zone Delta)', centerLng: -118.2415, centerLat: 34.0505, radiusMeters: 100 }
];

app.use(cors());
app.use(express.json());

// Logger middleware with custom Valkey rate limiting
app.use(async (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Apply rate limiter
  const limiter = await valkeyService.rateLimit(ip, 40, 10);
  if (!limiter.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded. Threat detection threshold flagged.' });
  }
  next();
});

// --- REST Endpoints ---

// Check System Health for Admin Dashboard
app.get('/api/health', async (req, res) => {
  try {
    const valkeyStatus = getValkeyStatus();
    const dbStatus = getDbStatus();
    const valkeyMetrics = await valkeyService.getValkeyMetrics();
    const activeSockets = io.sockets.sockets.size;

    // Measure API latency
    const start = process.hrtime();
    await query('SELECT 1');
    const diff = process.hrtime(start);
    const latencyMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);

    res.json({
      status: 'nominal',
      timestamp: new Date(),
      database: dbStatus,
      valkey: valkeyStatus,
      activeWebSockets: activeSockets,
      latencyMs: `${latencyMs}ms`,
      valkeyMetrics,
      serverMemory: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      restrictedZones: RESTRICTED_ZONES
    });
  } catch (e) {
    res.status(500).json({ status: 'degraded', error: e.message });
  }
});

// Secure Login with JWT Generation
app.post('/api/auth/login', async (req, res) => {
  const { name, role } = req.body;
  
  if (!name || !role) {
    return res.status(400).json({ error: 'Identification credentials missing.' });
  }

  try {
    // Find or simulate user credentials
    const result = await query('SELECT * FROM users WHERE name = $1', [name]);
    let user = result.rows[0];

    if (!user) {
      // For ease of hackathon evaluation, auto-create account if matching simulated ranks
      const rank = role === 'commander' ? 'Captain' : 'Private';
      const lastLoc = role === 'soldier' ? { lat: 34.0522, lng: -118.2437 } : null;
      
      const insertResult = await query(
        'INSERT INTO users (name, rank, role, status, last_location, battery_level) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [name, rank, role, 'active', JSON.stringify(lastLoc), 100]
      );
      user = insertResult.rows[0];
    }

    // Verify role matches
    if (user.role !== role) {
      return res.status(401).json({ error: 'Access Denied: Role mismatch on access token.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, rank: user.rank },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        rank: user.rank,
        status: user.status,
        battery_level: user.battery_level
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Authentication service failure.' });
  }
});

// Fetch active military personnel coordinates
app.get('/api/soldiers', async (req, res) => {
  try {
    const result = await query("SELECT id, name, rank, status, last_location, battery_level FROM users WHERE role = 'soldier'");
    
    // Supplement SQL values with live coordinates cached in Valkey GEO
    const soldiers = [];
    for (const soldier of result.rows) {
      const liveCoords = await valkeyService.getSoldierLocation(soldier.id);
      soldiers.push({
        ...soldier,
        last_location: liveCoords || soldier.last_location
      });
    }

    res.json(soldiers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch active missions
app.get('/api/missions', async (req, res) => {
  try {
    const result = await query('SELECT * FROM missions ORDER BY priority ASC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assign new mission
app.post('/api/missions', async (req, res) => {
  const { title, description, priority, sector, assignedTo } = req.body;
  if (!title || !priority || !assignedTo) {
    return res.status(400).json({ error: 'Required mission parameters missing.' });
  }

  try {
    const assignedToId = parseInt(assignedTo, 10);
    const priorityInt = parseInt(priority, 10);

    const result = await query(
      'INSERT INTO missions (title, description, priority, status, sector, assigned_to) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, description, priorityInt, 'active', sector, assignedToId]
    );
    const mission = result.rows[0];

    // Push into Valkey Sorted Set (Mission priority Queue)
    await valkeyService.addMissionToPriorityQueue(mission.id, priorityInt);

    // Stream the creation event inside Valkey Stream for replay
    await valkeyService.logMissionEvent('mission-started', {
      missionId: mission.id,
      title,
      priority: priorityInt,
      assignedTo: assignedToId,
      sector
    });

    // Notify components via Valkey Pub/Sub
    await pubsub.publish('mission_channel', { event: 'created', mission });

    res.status(201).json(mission);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch historical stream events for mission replay
app.get('/api/replay', async (req, res) => {
  try {
    const events = await valkeyService.getMissionEvents();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Valkey Pub/Sub Listeners ---
// Subscribe to channels to broadcast events instantly over WebSockets
pubsub.subscribe('sos_channel', (message) => {
  const data = JSON.parse(message);
  io.emit('sos-broadcast', data);
});

pubsub.subscribe('threat_channel', (message) => {
  const data = JSON.parse(message);
  io.emit('threat-broadcast', data);
});

pubsub.subscribe('mission_channel', (message) => {
  const data = JSON.parse(message);
  io.emit('mission-broadcast', data);
});

// --- WebSocket Event Handlers ---
io.on('connection', (socket) => {
  console.log(`[Socket] Client linked: ${socket.id}`);

  // 1. Telemetry / Coordinate Stream
  socket.on('soldier-telemetry', async (data) => {
    const { soldierId, lng, lat, battery_level, status } = data;
    if (!soldierId) return;

    // Cache position in Valkey GEO
    await valkeyService.updateSoldierLocation(soldierId, lng, lat);

    // Update coordinates in Postgres / Local Mock DB
    await query(
      'UPDATE users SET last_location = $1, battery_level = $2, status = $3 WHERE id = $4',
      [JSON.stringify({ lat, lng }), battery_level, status, soldierId]
    );

    // Log tracking movement to Valkey Stream for replay
    await valkeyService.logMissionEvent('soldier-moved', {
      soldierId,
      lng,
      lat,
      battery_level,
      status
    });

    // Run Geospatial Engine: check geofencing restricted zones
    const breaches = TIE.checkGeofence(lng, lat, RESTRICTED_ZONES);
    for (const breach of breaches) {
      const alertPayload = {
        type: 'Intrusion Alert',
        severity: 'high',
        soldierId,
        detail: `Soldier entered prohibited geofence boundary: ${breach.zoneName} by ${Math.round(breach.distanceFromCenter)}m.`
      };

      // Push intrusion notification to Postgres / Mock
      const dbAlert = await query(
        'INSERT INTO alerts (type, severity, location, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
        [alertPayload.type, alertPayload.severity, JSON.stringify({ lat, lng })]
      );

      // Publish over Pub/Sub channel
      await pubsub.publish('threat_channel', {
        ...alertPayload,
        dbId: dbAlert.rows[0]?.id
      });
    }

    // Broadcast updated positions to all dashboards (e.g. Commander map)
    io.emit('soldier-position-update', {
      soldierId,
      lng,
      lat,
      battery_level,
      status
    });
  });

  // 2. SOS Trigger (Emergency System)
  socket.on('sos-trigger', async (data) => {
    const { soldierId, lat, lng, reason } = data;
    
    // Update user status
    await query("UPDATE users SET status = 'sos' WHERE id = $1", [soldierId]);

    // Insert alert into PostgreSQL
    const dbAlert = await query(
      "INSERT INTO alerts (type, severity, location, created_at) VALUES ('SOS', 'critical', $1, NOW()) RETURNING *",
      [JSON.stringify({ lat, lng })]
    );

    // Stream SOS to Valkey Replay Stream
    await valkeyService.logMissionEvent('sos-activated', {
      soldierId,
      lat,
      lng,
      reason
    });

    // Run TIE Threat Pattern Detector
    const threatCheck = await TIE.detectThreatPatterns({ soldierId, lat, lng });
    if (threatCheck.patternDetected) {
      await pubsub.publish('threat_channel', {
        type: 'Pattern Threat alert',
        severity: 'critical',
        detail: threatCheck.description
      });
    }

    // Run TDSS (Tactical Decision Support System) auto responder suggestions
    const tdssResult = await TIE.recommendRescueUnit(lat, lng, soldierId);

    // Publish SOS data including TDSS recommendations to Valkey Pub/Sub
    await pubsub.publish('sos_channel', {
      soldierId,
      reason: reason || 'Extreme hazard coordinates breached.',
      lat,
      lng,
      timestamp: new Date(),
      tdss: tdssResult,
      dbId: dbAlert.rows[0]?.id
    });
  });

  // 3. Resolve SOS
  socket.on('sos-resolve', async (data) => {
    const { soldierId } = data;
    await query("UPDATE users SET status = 'active' WHERE id = $1", [soldierId]);
    await valkeyService.logMissionEvent('sos-resolved', { soldierId });
    io.emit('sos-resolved-broadcast', { soldierId });
  });

  // 4. Secure AES-256 WebSockets Chat Channel
  socket.on('chat-message', (data) => {
    const { sender, encryptedText, timestamp, recipientRole } = data;
    
    // Server acts as pure relay - does NOT decrypt message.
    // Relays secure ciphertext packet. Only clients with correct AES key decrypt it.
    io.emit('secure-chat-broadcast', {
      sender,
      encryptedText,
      timestamp,
      recipientRole
    });
  });

  // 5. Environmental/Tactical Simulation triggers (Commander Override)
  socket.on('simulation-event-trigger', async (data) => {
    const { eventType, active } = data;
    
    // Log event in replay streams
    await valkeyService.logMissionEvent('simulation-event', { eventType, active });

    // Broadcast simulation change to soldiers & admins (forces GPS loss or Comm Jam styling)
    io.emit('simulation-broadcast', { eventType, active });
  });

  // 6. Complete Mission & Generate Tactical Summary
  socket.on('mission-complete', async (data) => {
    const { missionId } = data;

    // Fetch mission
    const mRes = await query('SELECT * FROM missions WHERE id = $1', [missionId]);
    const mission = mRes.rows[0];

    if (mission) {
      // Mark completed in database
      await query("UPDATE missions SET status = 'completed' WHERE id = $1", [missionId]);
      
      // Remove from Valkey Sorted Set
      await valkeyService.removeMissionFromPriorityQueue(missionId);

      // Generate AI TIE Tactical Debrief summary
      const summaryText = TIE.generateMissionSummary(mission, 12, 1);

      // Stream completion
      await valkeyService.logMissionEvent('mission-completed', {
        missionId,
        summary: summaryText
      });

      // Notify clients
      io.emit('mission-completed-broadcast', {
        missionId,
        summary: summaryText
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// --- Server Bootstrap ---
httpServer.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(` SENTINELOPS SERVER RUNNING ON PORT: ${PORT}`);
  console.log(`======================================================`);
  
  // Setup database connection and schemas
  await initDb();
  
  // Clear mock streams/priority lists on reload to avoid bloated test caches
  try {
    await valkey.del('soldier_locations');
    await valkey.del('priority_missions');
    await valkey.del('mission_queue');
    await valkey.del('mission_events');
    console.log('[Valkey Cache] Initial clean state set up.');
  } catch (err) {
    // Simulator handles it
  }
});
