import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// PostgreSQL Connection configuration
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sentinelops';
let pool = null;
let isMock = false;

// Mock database storage in case PG is offline
export const mockDb = {
  users: [
    { id: 1, name: 'Col. Vance Rutherford', rank: 'Colonel', role: 'commander', status: 'active', last_location: { lat: 34.0522, lng: -118.2437 }, battery_level: 95 },
    { id: 2, name: 'Sgt. Marcus Miller', rank: 'Sergeant', role: 'soldier', status: 'active', last_location: { lat: 34.0535, lng: -118.2450 }, battery_level: 88 },
    { id: 3, name: 'Cpl. Sarah Jenkins', rank: 'Corporal', role: 'soldier', status: 'active', last_location: { lat: 34.0510, lng: -118.2420 }, battery_level: 42 },
    { id: 4, name: 'Pvt. Daniel Chen', rank: 'Private', role: 'soldier', status: 'active', last_location: { lat: 34.0550, lng: -118.2465 }, battery_level: 15 },
    { id: 5, name: 'SysAdmin Prime', rank: 'Chief Warrant Officer', role: 'admin', status: 'active', last_location: null, battery_level: 100 }
  ],
  missions: [
    { id: 1, title: 'Rescue Hostages - Sector Grid Echo', description: 'Simulate high-priority rescue extraction of civilian hostages in hostile Sector Grid Echo.', priority: 1, status: 'active', sector: 'Sector Grid Echo', assigned_to: 2, created_at: new Date() },
    { id: 2, title: 'Investigate Radar Anomalies', description: 'Investigate Jamming signal near northern border of Training Grounds.', priority: 2, status: 'pending', sector: 'Sector North-Alpha', assigned_to: 3, created_at: new Date() },
    { id: 3, title: 'Routine Perimeter Patrol', description: 'Conduct sector sweeps to verify geofence barriers are functional.', priority: 3, status: 'completed', sector: 'Outer Boundary Beta', assigned_to: 4, created_at: new Date() }
  ],
  alerts: [],
  event_logs: []
};

try {
  pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 3000
  });
  console.log(`[Database] Attempting connection to: ${connectionString.split('@')[1] || 'local'}`);
} catch (err) {
  console.warn('[Database] Initial connection pool setup failed. Falling back to IN-MEMORY Mock DB.');
  isMock = true;
}

export const query = async (text, params) => {
  if (isMock || !pool) {
    return handleMockQuery(text, params);
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error(`[Database Error] SQL query execution failed: ${err.message}. Routing to mock fallback.`);
    isMock = true; // Fallback to mock for subsequent queries
    return handleMockQuery(text, params);
  }
};

export const getDbStatus = () => {
  return isMock ? 'OFFLINE (USING MOCK DB)' : 'CONNECTED';
};

// SQL-to-Mock interpreter to allow frontend to seamlessly operate
function handleMockQuery(text, params) {
  const queryStr = text.toLowerCase().trim();
  
  // SELECT USERS
  if (queryStr.includes('select') && queryStr.includes('users')) {
    if (queryStr.includes('where id =') || queryStr.includes('where id = $1')) {
      const id = params ? params[0] : 1;
      const user = mockDb.users.find(u => u.id == id);
      return { rows: user ? [user] : [] };
    }
    if (queryStr.includes('where name =') || queryStr.includes('where name = $1')) {
      const name = params ? params[0] : '';
      const user = mockDb.users.find(u => u.name.toLowerCase() === name.toLowerCase());
      return { rows: user ? [user] : [] };
    }
    return { rows: mockDb.users };
  }

  // SELECT MISSIONS
  if (queryStr.includes('select') && queryStr.includes('missions')) {
    if (queryStr.includes('assigned_to =')) {
      const assignId = params ? params[0] : 2;
      return { rows: mockDb.missions.filter(m => m.assigned_to == assignId) };
    }
    return { rows: mockDb.missions };
  }

  // SELECT ALERTS
  if (queryStr.includes('select') && queryStr.includes('alerts')) {
    return { rows: mockDb.alerts };
  }

  // INSERT INTO ALERTS
  if (queryStr.includes('insert into alerts')) {
    const newAlert = {
      id: mockDb.alerts.length + 1,
      type: params[0],
      severity: params[1],
      location: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
      created_at: new Date()
    };
    mockDb.alerts.push(newAlert);
    return { rows: [newAlert] };
  }

  // INSERT INTO MISSIONS
  if (queryStr.includes('insert into missions')) {
    const newMission = {
      id: mockDb.missions.length + 1,
      title: params[0],
      description: params[1],
      priority: params[2],
      status: params[3] || 'pending',
      sector: params[4],
      assigned_to: params[5],
      created_at: new Date()
    };
    mockDb.missions.push(newMission);
    return { rows: [newMission] };
  }

  // UPDATE MISSIONS
  if (queryStr.includes('update missions')) {
    if (queryStr.includes('status = $1') && queryStr.includes('id = $2')) {
      const status = params[0];
      const id = params[1];
      const mIdx = mockDb.missions.findIndex(m => m.id == id);
      if (mIdx !== -1) {
        mockDb.missions[mIdx].status = status;
        return { rows: [mockDb.missions[mIdx]], rowCount: 1 };
      }
    }
  }

  // UPDATE USERS (Status, locations, battery)
  if (queryStr.includes('update users')) {
    // E.g., status = $1, last_location = $2, battery_level = $3 WHERE id = $4
    const status = params[0];
    const location = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
    const battery = params[2];
    const id = params[3];
    const uIdx = mockDb.users.findIndex(u => u.id == id);
    if (uIdx !== -1) {
      if (status !== undefined) mockDb.users[uIdx].status = status;
      if (location !== undefined) mockDb.users[uIdx].last_location = location;
      if (battery !== undefined) mockDb.users[uIdx].battery_level = battery;
      return { rows: [mockDb.users[uIdx]], rowCount: 1 };
    }
  }

  return { rows: [], rowCount: 0 };
}

export const initDb = async () => {
  if (isMock || !pool) {
    console.log('[Database] Initializing Mock database schema (In-Memory).');
    return;
  }
  
  try {
    // Connect to check if DB exists and write tables
    const client = await pool.connect();
    console.log('[Database] Connected to PostgreSQL. Initializing schemas...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rank VARCHAR(50),
        role VARCHAR(20) DEFAULT 'soldier',
        status VARCHAR(20) DEFAULT 'active',
        last_location JSONB,
        battery_level INTEGER DEFAULT 100
      );

      CREATE TABLE IF NOT EXISTS missions (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 3,
        status VARCHAR(20) DEFAULT 'pending',
        sector VARCHAR(50),
        assigned_to INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) DEFAULT 'medium',
        location JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_logs (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50),
        payload JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check if empty, seed default users
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      console.log('[Database Seeding] Seeding default tactical accounts...');
      await client.query(`
        INSERT INTO users (name, rank, role, status, last_location, battery_level) VALUES
        ('Col. Vance Rutherford', 'Colonel', 'commander', 'active', '{"lat": 34.0522, "lng": -118.2437}', 95),
        ('Sgt. Marcus Miller', 'Sergeant', 'soldier', 'active', '{"lat": 34.0535, "lng": -118.2450}', 88),
        ('Cpl. Sarah Jenkins', 'Corporal', 'soldier', 'active', '{"lat": 34.0510, "lng": -118.2420}', 42),
        ('Pvt. Daniel Chen', 'Private', 'soldier', 'active', '{"lat": 34.0550, "lng": -118.2465}', 15),
        ('SysAdmin Prime', 'Chief Warrant Officer', 'admin', 'active', NULL, 100);
      `);
      
      await client.query(`
        INSERT INTO missions (title, description, priority, status, sector, assigned_to) VALUES
        ('Rescue Hostages - Sector Grid Echo', 'Simulate high-priority rescue extraction of civilian hostages in hostile Sector Grid Echo.', 1, 'active', 'Sector Grid Echo', 2),
        ('Investigate Radar Anomalies', 'Investigate Jamming signal near northern border of Training Grounds.', 2, 'pending', 'Sector North-Alpha', 3);
      `);
    }

    client.release();
    console.log('[Database] Tables checked and verified.');
  } catch (err) {
    console.warn(`[Database] PostgreSQL initialization failed: ${err.message}. Switched to in-memory Mock mode.`);
    isMock = true;
  }
};
