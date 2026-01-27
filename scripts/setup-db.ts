/**
 * Database Setup Script
 *
 * Creates the database schema by running migrations.
 * Usage: npm run db:setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment
dotenv.config();

const { Client } = pg;

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '../src/infrastructure/database/migrations');

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Get migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('⚠️ No migration files found');
      return;
    }

    console.log(`\n📁 Found ${files.length} migration file(s):\n`);
    files.forEach(f => console.log(`   - ${f}`));
    console.log('');

    // Run each migration
    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`⏳ Running migration: ${file}...`);
      const start = Date.now();

      try {
        await client.query(sql);
        console.log(`✅ Completed: ${file} (${Date.now() - start}ms)`);
      } catch (error) {
        console.error(`❌ Failed: ${file}`);
        throw error;
      }
    }

    console.log('\n🎉 All migrations completed successfully!\n');

    // Show table summary
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('📊 Created tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Show view summary
    const viewsResult = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    if (viewsResult.rows.length > 0) {
      console.log('\n📋 Created views:');
      viewsResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migrations
runMigrations();
