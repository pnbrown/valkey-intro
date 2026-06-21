import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;
console.log('Connecting to database:', process.env.DATABASE_URL);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    await client.connect();
    console.log('Successfully connected to Neon PostgreSQL!');
    
    // Create tables
    console.log('Creating tables if they do not exist...');
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
    console.log('Tables initialized successfully.');

    // Seed default users
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      console.log('Seeding default operators...');
      await client.query(`
        INSERT INTO users (name, rank, role, status, last_location, battery_level) VALUES
        ('Col. Vance Rutherford', 'Colonel', 'commander', 'active', '{"lat": 34.0522, "lng": -118.2437}', 95),
        ('Sgt. Marcus Miller', 'Sergeant', 'soldier', 'active', '{"lat": 34.0535, "lng": -118.2450}', 88),
        ('Cpl. Sarah Jenkins', 'Corporal', 'soldier', 'active', '{"lat": 34.0510, "lng": -118.2420}', 42),
        ('Pvt. Daniel Chen', 'Private', 'soldier', 'active', '{"lat": 34.0550, "lng": -118.2465}', 15),
        ('SysAdmin Prime', 'Chief Warrant Officer', 'admin', 'active', NULL, 100);
      `);
      console.log('Seeding complete.');
    } else {
      console.log('Users already seeded.');
    }

  } catch (err) {
    console.error('Database connection or query failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
