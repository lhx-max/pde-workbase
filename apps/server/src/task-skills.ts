import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export interface InstalledTaskSkill {
  id: string;
  digest: string;
  instructions: string;
  resources: Array<{ path: string; digest: string; content: string }>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Only application-installed, allowlisted instruction resources may become system context. */
export function resolveTaskSkills(installedRoot: string | undefined, ids: string[]): InstalledTaskSkill[] {
  if (!ids.length) return [];
  try {
    if (!installedRoot || !path.isAbsolute(installedRoot) || lstatSync(installedRoot).isSymbolicLink()) throw new Error('Explicit installed resource root required');
    const root = realpathSync(installedRoot);
    return [...new Set(ids)].map(id => {
      if (id !== 'page-recreation') throw new Error('Skill is not allowlisted');
      const directory = path.join(root, id);
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Invalid skill directory');
      const resources: InstalledTaskSkill['resources'] = []; let bytes = 0;
      function collect(relative: string, depth = 0): void {
        if (depth > 4) throw new Error('Skill resource depth exceeded');
        const location = path.join(directory, relative); const stat = lstatSync(location);
        if (stat.isSymbolicLink() || !realpathSync(location).startsWith(`${root}${path.sep}`)) throw new Error('Skill resource escapes installed root');
        if (stat.isDirectory()) { for (const name of readdirSync(location).sort()) collect(relative ? `${relative}/${name}` : name, depth + 1); return; }
        if (!stat.isFile() || (!relative.endsWith('.md') && relative !== 'LICENSE')) throw new Error('Unsupported installed skill resource');
        bytes += stat.size; if (bytes > 256 * 1024 || resources.length >= 32) throw new Error('Skill resources exceed budget');
        const content = readFileSync(location, 'utf8'); resources.push({ path: relative, digest: hash(content), content });
      }
      collect('');
      const instructions = resources.find(resource => resource.path === 'SKILL.md')?.content;
      if (!instructions?.trim()) throw new Error('Skill instructions are missing');
      return { id, digest: hash(JSON.stringify(resources)), instructions, resources: resources.filter(resource => resource.path !== 'SKILL.md') };
    });
  } catch {
    throw Object.assign(new Error('Required page-recreation skill resources are unavailable or unsafe'), { status: 503, code: 'SKILL_RESOURCE_UNAVAILABLE' });
  }
}
