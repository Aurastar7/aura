import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createPool } from '../config/database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(rootDir, '.env') });
dotenv.config({ path: path.resolve(rootDir, '.env.production') });
dotenv.config();

const schemaPath = path.resolve(rootDir, 'server', 'db', 'schema.sql');
const pool = createPool();

const run = async () => {
  const sql = await fs.readFile(schemaPath, 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('Database migrated successfully.');
};

run().catch(async (error) => {
  console.error('Migration failed:', error);
  try {
    await pool.end();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});
