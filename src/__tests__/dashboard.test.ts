import { describe, it, expect } from 'vitest';
import { loadProjects } from '../dashboard.js';
import type { GoodjobConfig } from '../types.js';

describe('dashboard', () => {
  describe('loadProjects', () => {
    it('returns projects from config with resolved paths', () => {
      const config: GoodjobConfig = {
        projects: [
          { name: 'App Front', path: '../angular-sandbox' },
          { name: 'Back Office', path: '/absolute/path/backoffice' },
        ],
      };
      const projects = loadProjects(config, '/base/project');
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('App Front');
      expect(projects[0].path).toBe('/base/angular-sandbox');
      expect(projects[1].path).toBe('/absolute/path/backoffice');
    });

    it('returns empty array when no projects configured', () => {
      const config: GoodjobConfig = {};
      const projects = loadProjects(config, '/base');
      expect(projects).toHaveLength(0);
    });

    it('returns empty array when projects is undefined', () => {
      const projects = loadProjects({}, '/base');
      expect(projects).toHaveLength(0);
    });

    it('resolves relative paths correctly', () => {
      const config: GoodjobConfig = {
        projects: [{ name: 'test', path: './sibling/folder' }],
      };
      const projects = loadProjects(config, '/base/project');
      expect(projects[0].path).toBe('/base/project/sibling/folder');
    });
  });
});
