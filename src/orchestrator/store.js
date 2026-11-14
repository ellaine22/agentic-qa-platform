// JSON-backed data store for QA case files, runs, gates, bugs and coverage snapshots.
// Swap this module for Postgres/Azure SQL without touching the agents: they only
// use the exported functions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB_PATH = path.join(ROOT, 'data', 'store.json');

const EMPTY = {
  version: 1,
  caseFiles: {},   // key -> QA case file
  runs: [],        // execution runs
  gates: [],       // human checkpoints
  bugs: [],        // drafted Jira bugs
  coverage: [],    // coverage snapshots over time
  events: []       // audit log
};

export function load() {
  if (!fs.existsSync(DB_PATH)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch (err) {
    throw new Error(`Store at ${DB_PATH} is not readable JSON: ${err.message}`);
  }
}

export function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  return db;
}

export function reset() {
  return save(structuredClone(EMPTY));
}

export function update(fn) {
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

export function logEvent(db, { actor, action, subject, detail }) {
  db.events.push({
    at: new Date().toISOString(),
    actor,
    action,
    subject,
    detail: detail ?? null
  });
}

// --- QA case files -----------------------------------------------------

export const STAGES = [
  'intake',
  'planning',
  'case-design',
  'project-testing',
  'release-candidate',
  'prod-testing',
  'rollout',
  'launched'
];

export function createCaseFile(db, { key, epic, flag, platforms }) {
  if (db.caseFiles[key]) return db.caseFiles[key];
  db.caseFiles[key] = {
    key,
    epic,
    flag,
    platforms,
    stage: 'intake',
    createdAt: new Date().toISOString(),
    plan: null,
    cases: [],
    regressionImpact: [],
    runs: [],
    bugs: [],
    decisions: {}
  };
  return db.caseFiles[key];
}

export function getCaseFile(db, key) {
  const cf = db.caseFiles[key];
  if (!cf) throw new Error(`No QA case file for "${key}". Run: qa intake ${key}`);
  return cf;
}

export function advance(db, key, stage) {
  const cf = getCaseFile(db, key);
  cf.stage = stage;
  logEvent(db, { actor: 'orchestrator', action: 'stage', subject: key, detail: stage });
  return cf;
}

// --- Gates -------------------------------------------------------------

export function openGate(db, { key, type, role, summary, payload }) {
  const existing = db.gates.find(g => g.key === key && g.type === type && g.status === 'open');
  if (existing) return existing;
  const gate = {
    id: `G-${String(db.gates.length + 1).padStart(3, '0')}`,
    key,
    type,
    role,
    summary,
    payload: payload ?? null,
    status: 'open',
    openedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    note: null
  };
  db.gates.push(gate);
  logEvent(db, { actor: 'orchestrator', action: 'gate-open', subject: key, detail: type });
  return gate;
}

export function decideGate(db, id, { decision, by, note }) {
  const gate = db.gates.find(g => g.id === id);
  if (!gate) throw new Error(`No gate ${id}`);
  if (gate.status !== 'open') throw new Error(`Gate ${id} is already ${gate.status}`);
  gate.status = decision; // approved | rejected
  gate.decidedAt = new Date().toISOString();
  gate.decidedBy = by;
  gate.note = note ?? null;
  logEvent(db, { actor: by, action: `gate-${decision}`, subject: gate.key, detail: gate.type });
  return gate;
}

export function openGatesFor(db, key) {
  return db.gates.filter(g => g.key === key && g.status === 'open');
}

export function isApproved(db, key, type) {
  return db.gates.some(g => g.key === key && g.type === type && g.status === 'approved');
}
