import { expect, it } from 'vitest';
import { filterAgents, groupAgents } from '../src/client/gardens/dashboard/agentView';
import type { Agent } from '../src/shared/types';

it('combines multi-provider, status and search filters before grouping by the full project path', () => {
  const agents = [
    {
      id: 'one',
      provider: 'codex',
      sessionId: 'native-one',
      name: 'Miso',
      project: '/work/app',
      task: 'Parser',
      status: 'working',
      connection: 'connected',
    },
    {
      id: 'two',
      provider: 'claude',
      sessionId: 'native-two',
      name: 'Clove',
      project: '/work/app',
      task: 'Parser',
      status: 'waiting',
      connection: 'connected',
    },
    {
      id: 'three',
      provider: 'claude',
      sessionId: 'native-three',
      name: 'Sage',
      project: '/other/app',
      task: 'Docs',
      status: 'finished',
      connection: 'disconnected',
    },
  ] as Agent[];
  expect(filterAgents(agents, ['claude'], 'all', '').map((agent) => agent.id)).toEqual([
    'two',
    'three',
  ]);
  expect(
    filterAgents(agents, ['claude', 'codex'], 'waiting', 'parser').map((agent) => agent.id),
  ).toEqual(['two']);
  expect(filterAgents(agents, [], 'all', '')).toEqual([]);
  expect(
    filterAgents(agents, ['claude'], 'disconnected', 'native-three').map((agent) => agent.id),
  ).toEqual(['three']);
  expect(
    groupAgents(agents, true).map((group) => [
      group.project,
      group.agents.map((agent) => agent.id),
    ]),
  ).toEqual([
    ['/work/app', ['one', 'two']],
    ['/other/app', ['three']],
  ]);
  expect(groupAgents(agents, false)[0].agents).toEqual(agents);
});

it('shows only genuinely empty projects and searches their saved names, respecting hide empty', () => {
  const projects = [
    { path: '/work/empty', name: 'Design lab' },
    { path: '/work/busy', name: 'Busy' },
  ];
  const all = [{ project: '/work/busy' }] as Agent[];
  expect(groupAgents([], true, { projects, allAgents: all, hideEmpty: false, search: '' })).toEqual(
    [{ project: '/work/empty', agents: [] }],
  );
  expect(groupAgents([], true, { projects, allAgents: all, hideEmpty: true, search: '' })).toEqual(
    [],
  );
  expect(
    groupAgents([], true, { projects, allAgents: all, hideEmpty: false, search: 'design' }),
  ).toHaveLength(1);
  expect(
    groupAgents([], true, { projects, allAgents: all, hideEmpty: false, search: 'busy' }),
  ).toEqual([]);
  expect(
    groupAgents([], true, {
      projects,
      allAgents: all,
      hideEmpty: false,
      search: '',
      status: 'waiting',
    }),
  ).toEqual([]);
});

it('does not present projects with hidden-provider agents as empty', () => {
  expect(
    groupAgents([], true, {
      projects: [{ path: '/work/hidden', name: 'Hidden', agentCount: 1 }],
      allAgents: [],
      hideEmpty: false,
      search: '',
    }),
  ).toEqual([]);
});
