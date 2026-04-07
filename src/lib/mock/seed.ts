import dayjs from 'dayjs';
import type { Agent, Channel, Project } from '@/types/database';
import type {
  MockAppState,
  PerformanceRecord,
  StrategyDraftInput,
  WeeklyConstraintSet,
} from '@/types/mock';

interface ChannelProfile {
  id: string;
  name: string;
  baseActivationCost: number;
  baseActivations: number;
  baseRetentionDay1: number;
  baseRetentionDay7: number;
  currentWeekCostFactor: number;
  currentWeekActivationFactor: number;
  currentWeekRetentionDay1Delta: number;
  currentWeekRetentionDay7Delta: number;
}

interface AgentProfile {
  id: string;
  name: string;
  channelId: string;
  activationBias: number;
  costBias: number;
  retentionDay1Bias: number;
  retentionDay7Bias: number;
}

const CHANNEL_PROFILES: ChannelProfile[] = [
  {
    id: 'channel-baidu',
    name: '百度',
    baseActivationCost: 124,
    baseActivations: 34,
    baseRetentionDay1: 35.8,
    baseRetentionDay7: 13.2,
    currentWeekCostFactor: 1.3,
    currentWeekActivationFactor: 0.92,
    currentWeekRetentionDay1Delta: -1.4,
    currentWeekRetentionDay7Delta: -0.8,
  },
  {
    id: 'channel-gdt',
    name: '广点通',
    baseActivationCost: 88,
    baseActivations: 56,
    baseRetentionDay1: 41.8,
    baseRetentionDay7: 18.4,
    currentWeekCostFactor: 0.88,
    currentWeekActivationFactor: 1.08,
    currentWeekRetentionDay1Delta: 1.6,
    currentWeekRetentionDay7Delta: 1.1,
  },
  {
    id: 'channel-douyin',
    name: '抖音',
    baseActivationCost: 79,
    baseActivations: 63,
    baseRetentionDay1: 34.1,
    baseRetentionDay7: 12.8,
    currentWeekCostFactor: 0.97,
    currentWeekActivationFactor: 1.03,
    currentWeekRetentionDay1Delta: 0.5,
    currentWeekRetentionDay7Delta: 0.2,
  },
  {
    id: 'channel-kuaishou',
    name: '快手',
    baseActivationCost: 96,
    baseActivations: 47,
    baseRetentionDay1: 39.2,
    baseRetentionDay7: 17.1,
    currentWeekCostFactor: 1.02,
    currentWeekActivationFactor: 0.95,
    currentWeekRetentionDay1Delta: -0.7,
    currentWeekRetentionDay7Delta: -2.8,
  },
  {
    id: 'channel-xhs',
    name: '小红书',
    baseActivationCost: 138,
    baseActivations: 26,
    baseRetentionDay1: 46.2,
    baseRetentionDay7: 21.7,
    currentWeekCostFactor: 1.06,
    currentWeekActivationFactor: 0.82,
    currentWeekRetentionDay1Delta: 0.8,
    currentWeekRetentionDay7Delta: 0.6,
  },
];

const AGENT_PROFILES: AgentProfile[] = [
  { id: 'agent-baidu-liran', name: '李然', channelId: 'channel-baidu', activationBias: 1.05, costBias: 0.98, retentionDay1Bias: 0.8, retentionDay7Bias: 0.5 },
  { id: 'agent-baidu-zhaomin', name: '赵敏', channelId: 'channel-baidu', activationBias: 0.95, costBias: 1.04, retentionDay1Bias: -0.6, retentionDay7Bias: -0.2 },
  { id: 'agent-baidu-chenzhe', name: '陈哲', channelId: 'channel-baidu', activationBias: 0.88, costBias: 1.12, retentionDay1Bias: -1.1, retentionDay7Bias: -0.9 },
  { id: 'agent-gdt-a', name: 'A代理', channelId: 'channel-gdt', activationBias: 1.08, costBias: 0.9, retentionDay1Bias: 2.1, retentionDay7Bias: 1.4 },
  { id: 'agent-gdt-b', name: 'B代理', channelId: 'channel-gdt', activationBias: 1.02, costBias: 0.98, retentionDay1Bias: 0.2, retentionDay7Bias: 0.3 },
  { id: 'agent-gdt-c', name: 'C代理', channelId: 'channel-gdt', activationBias: 0.9, costBias: 1.09, retentionDay1Bias: -1.4, retentionDay7Bias: -1.1 },
  { id: 'agent-douyin-sunyang', name: '孙洋', channelId: 'channel-douyin', activationBias: 1.14, costBias: 0.96, retentionDay1Bias: 0.4, retentionDay7Bias: 0.1 },
  { id: 'agent-douyin-heyu', name: '何宇', channelId: 'channel-douyin', activationBias: 0.96, costBias: 1.03, retentionDay1Bias: -0.5, retentionDay7Bias: -0.4 },
  { id: 'agent-douyin-zhouke', name: '周珂', channelId: 'channel-douyin', activationBias: 0.92, costBias: 1.08, retentionDay1Bias: -0.8, retentionDay7Bias: -0.7 },
  { id: 'agent-kuaishou-wuyue', name: '吴越', channelId: 'channel-kuaishou', activationBias: 0.98, costBias: 1.01, retentionDay1Bias: -0.4, retentionDay7Bias: -2.6 },
  { id: 'agent-kuaishou-linshan', name: '林杉', channelId: 'channel-kuaishou', activationBias: 1.06, costBias: 0.97, retentionDay1Bias: 1.0, retentionDay7Bias: 0.8 },
  { id: 'agent-kuaishou-jiangfan', name: '江帆', channelId: 'channel-kuaishou', activationBias: 0.91, costBias: 1.06, retentionDay1Bias: -0.9, retentionDay7Bias: -1.2 },
  { id: 'agent-xhs-chenxi', name: '晨曦', channelId: 'channel-xhs', activationBias: 1.04, costBias: 0.96, retentionDay1Bias: 1.6, retentionDay7Bias: 1.1 },
  { id: 'agent-xhs-tingyu', name: '听雨', channelId: 'channel-xhs', activationBias: 0.94, costBias: 1.05, retentionDay1Bias: -0.2, retentionDay7Bias: 0.2 },
  { id: 'agent-xhs-moruo', name: '莫若', channelId: 'channel-xhs', activationBias: 0.86, costBias: 1.11, retentionDay1Bias: -1.0, retentionDay7Bias: -0.7 },
];

const PROJECT_NAMES = [
  '小说拉新',
  '工具变现',
  '短剧投流',
];

export const mockChannels: Channel[] = CHANNEL_PROFILES.map((profile) => ({
  id: profile.id,
  name: profile.name,
  is_active: true,
  created_at: dayjs().subtract(90, 'day').toISOString(),
  updated_at: dayjs().toISOString(),
}));

export const mockAgents: Agent[] = AGENT_PROFILES.map((profile) => ({
  id: profile.id,
  name: profile.name,
  is_active: true,
  created_at: dayjs().subtract(90, 'day').toISOString(),
  updated_at: dayjs().toISOString(),
}));

export const mockProjects: Project[] = PROJECT_NAMES.map((name, index) => ({
  id: `project-${index + 1}`,
  name,
  is_active: true,
  created_at: dayjs().subtract(90, 'day').toISOString(),
  updated_at: dayjs().toISOString(),
}));

function toIsoDate(value: dayjs.Dayjs) {
  return value.format('YYYY-MM-DD');
}

function getSpecialMultiplier(date: dayjs.Dayjs, channelProfile: ChannelProfile, agentProfile: AgentProfile) {
  const weekdayFactor = [0.96, 1, 1.04, 1.02, 1.01, 0.94, 0.9][date.day()];
  const wave = Math.sin(date.date() / 3 + agentProfile.activationBias) * 0.07;
  const dayOfYear = date.diff(date.startOf('year'), 'day') + 1;
  const trend = Math.cos(dayOfYear / 8 + channelProfile.baseActivationCost / 50) * 0.04;
  const isCurrentWeek = date.isAfter(dayjs().startOf('week').subtract(1, 'day'));

  return {
    activationFactor: weekdayFactor + wave + trend + (isCurrentWeek ? channelProfile.currentWeekActivationFactor - 1 : 0),
    costFactor: 1 + Math.cos(date.date() / 2 + agentProfile.costBias) * 0.05 + (isCurrentWeek ? channelProfile.currentWeekCostFactor - 1 : 0),
    retentionDay1Delta: Math.sin(date.date() / 4 + agentProfile.retentionDay1Bias) * 0.9 + (isCurrentWeek ? channelProfile.currentWeekRetentionDay1Delta : 0),
    retentionDay7Delta: Math.cos(date.date() / 5 + agentProfile.retentionDay7Bias) * 0.6 + (isCurrentWeek ? channelProfile.currentWeekRetentionDay7Delta : 0),
  };
}

function buildPerformanceRecords(): PerformanceRecord[] {
  const startDate = dayjs().subtract(83, 'day');
  const records: PerformanceRecord[] = [];

  for (let offset = 0; offset < 84; offset += 1) {
    const date = startDate.add(offset, 'day');

    CHANNEL_PROFILES.forEach((channelProfile, channelIndex) => {
      const channelAgents = AGENT_PROFILES.filter((agent) => agent.channelId === channelProfile.id);

      channelAgents.forEach((agentProfile, agentIndex) => {
        const special = getSpecialMultiplier(date, channelProfile, agentProfile);
        const activations = Math.max(
          6,
          Math.round(channelProfile.baseActivations * agentProfile.activationBias * special.activationFactor * (1 + agentIndex * 0.03))
        );
        const activationCost = Math.max(
          48,
          Number((channelProfile.baseActivationCost * agentProfile.costBias * special.costFactor).toFixed(2))
        );
        const cost = Number((activations * activationCost).toFixed(2));
        const retentionDay1 = Number(
          Math.min(58, Math.max(22, channelProfile.baseRetentionDay1 + agentProfile.retentionDay1Bias + special.retentionDay1Delta)).toFixed(2)
        );
        const retentionDay7 = Number(
          Math.min(28, Math.max(7, channelProfile.baseRetentionDay7 + agentProfile.retentionDay7Bias + special.retentionDay7Delta)).toFixed(2)
        );
        const project = mockProjects[(offset + channelIndex + agentIndex) % mockProjects.length];

        records.push({
          id: `record-${channelProfile.id}-${agentProfile.id}-${toIsoDate(date)}`,
          date: toIsoDate(date),
          channelId: channelProfile.id,
          channelName: channelProfile.name,
          agentId: agentProfile.id,
          agentName: agentProfile.name,
          projectId: project.id,
          projectName: project.name,
          cost,
          activations,
          activationCost,
          retentionDay1,
          retentionDay7,
        });
      });
    });
  }

  return records;
}

export const mockStrategyTemplate: StrategyDraftInput = {
  weekStart: dayjs().startOf('week').format('YYYY-MM-DD'),
  weekEnd: dayjs().endOf('week').format('YYYY-MM-DD'),
  budgetUpperBound: 480000,
  minActivations: 4700,
  minRetentionDay1: 36,
  minRetentionDay7: 15,
  reason: '周一初版：按照最新周会约束生成',
  channelShareConstraints: [
    { channelId: 'channel-baidu', minShare: 0, maxShare: 0.7 },
    { channelId: 'channel-gdt', minShare: 0.1, maxShare: 0.2 },
    { channelId: 'channel-douyin', minShare: 0.2, maxShare: 0.35 },
    { channelId: 'channel-kuaishou', minShare: 0.1, maxShare: 0.25 },
    { channelId: 'channel-xhs', minShare: 0, maxShare: 0.15 },
  ],
};

export function buildStrategyFromTemplate(template: StrategyDraftInput): WeeklyConstraintSet {
  const now = dayjs().toISOString();

  return {
    id: `strategy-${template.weekStart}`,
    weekStart: template.weekStart,
    weekEnd: template.weekEnd,
    budgetUpperBound: template.budgetUpperBound,
    minActivations: template.minActivations,
    minRetentionDay1: template.minRetentionDay1,
    minRetentionDay7: template.minRetentionDay7,
    channelShareConstraints: template.channelShareConstraints,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSeedState(): Omit<MockAppState, 'plans'> {
  return {
    agents: mockAgents,
    channels: mockChannels,
    projects: mockProjects,
    records: buildPerformanceRecords(),
    strategies: [buildStrategyFromTemplate(mockStrategyTemplate)],
  };
}
