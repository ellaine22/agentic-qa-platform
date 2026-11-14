// Tool connectors. Each exposes the same surface whether it is backed by a
// fixture (prototype) or a REST API (production). Only this file changes when
// you point the platform at the real Jira, Confluence and flag platform.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from '../orchestrator/store.js';

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/platform.json'), 'utf8'));
export { config };

const abs = p => path.join(ROOT, p);

// --- Jira --------------------------------------------------------------

export const jira = {
  getEpic(key) {
    const file = abs(path.join(config.connectors.jira.fixtures, `${key}.json`));
    if (!fs.existsSync(file)) throw new Error(`Jira epic ${key} not found at ${file}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  },

  // In production this POSTs to /rest/api/3/issue. Here it returns a draft the
  // triage gate approves before anything is created.
  draftBug({ project, summary, description, severity, labels, evidence }) {
    return {
      fields: {
        project: { key: project },
        issuetype: { name: 'Bug' },
        summary,
        description,
        labels: labels ?? [],
        priority: { name: severity === 'high' ? 'High' : severity === 'low' ? 'Low' : 'Medium' }
      },
      _evidence: evidence ?? [],
      _status: 'draft'
    };
  }
};

// --- Confluence --------------------------------------------------------

export const confluence = {
  getPage(id) {
    const file = abs(path.join(config.connectors.confluence.fixtures, `${id}.md`));
    if (!fs.existsSync(file)) return null;
    return { id, body: fs.readFileSync(file, 'utf8') };
  },

  // Production: PUT /rest/api/content/{id}. Prototype: writes the page to disk
  // so you can see exactly what would be published.
  publish(id, title, body) {
    const dir = abs(config.connectors.confluence.publishTo);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.md`);
    fs.writeFileSync(file, `<!-- Confluence space: ${config.connectors.confluence.space} -->\n# ${title}\n\n${body}\n`);
    return { id, title, url: path.relative(ROOT, file) };
  }
};

// --- Feature flags -----------------------------------------------------

export const flags = {
  all() {
    return JSON.parse(fs.readFileSync(abs(config.connectors.flags.state), 'utf8')).flags;
  },

  get(key) {
    const flag = this.all().find(f => f.key === key);
    if (!flag) throw new Error(`Flag ${key} not found`);
    return flag;
  },

  treatments(key) {
    return this.get(key).treatments.map(t => t.key);
  },

  // The per-session override a test environment allows, so one run can exercise
  // both treatments. Returns the identity the executor should use.
  override(key, treatment) {
    const flag = this.get(key);
    const t = flag.treatments.find(x => x.key === treatment);
    if (!t) throw new Error(`Flag ${key} has no treatment "${treatment}"`);
    return { flag: key, treatment, identity: t.testIdentity, description: t.description };
  },

  write(all) {
    const file = abs(config.connectors.flags.state);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.flags = all;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  }
};

// --- Git / spec files --------------------------------------------------

export const git = {
  // Walk the spec roots and return every file with its text.
  specs() {
    const out = [];
    for (const root of config.connectors.git.specRoots) {
      const dir = abs(root);
      if (!fs.existsSync(dir)) continue;
      const walk = d => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (/\.(cy\.js|yaml|yml)$/.test(entry.name)) {
            out.push({ path: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') });
          }
        }
      };
      walk(dir);
    }
    return out;
  },

  writeSpec(relPath, text) {
    const file = abs(relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return relPath;
  },

  removeSpec(relPath) {
    const file = abs(relPath);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return relPath;
  }
};

// --- Test case repository ---------------------------------------------

export const testcases = {
  all() {
    const dir = abs('data/testcases');
    const out = [];
    const walk = d => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.ya?ml$/.test(entry.name)) {
          const doc = YAML.parse(fs.readFileSync(p, 'utf8'));
          for (const c of doc.cases ?? []) {
            out.push({ ...c, area: c.area ?? doc.area, platform: c.platform ?? doc.platform, file: path.relative(ROOT, p) });
          }
        }
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
  },

  byId(id) {
    return this.all().find(c => c.id === id);
  },

  // Append generated project cases to their own file so a reviewer sees exactly
  // what the agent added.
  writeProjectFile(name, doc) {
    const file = abs(path.join('data/testcases', doc.platform === 'mobile' ? 'mobile' : 'web', `${name}.yaml`));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, YAML.stringify(doc));
    return path.relative(ROOT, file);
  }
};

export const inventory = () => JSON.parse(fs.readFileSync(abs('data/inventory.json'), 'utf8'));
