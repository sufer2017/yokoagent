'use client';

import React, { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import type { Agent, Channel, Project } from '@/types/database';
import type {
  MockAppState,
  PerformanceRecord,
  StrategyDraftInput,
  WeeklyConstraintSet,
} from '@/types/mock';
import { buildStrategyFromTemplate, createSeedState, mockStrategyTemplate } from './seed';
import { generateAllocationPlan } from './engine';
import { parsePerformanceCsv } from './csv';

const STORAGE_KEY = 'yokoagent-v2-mock-state';

interface MockAppContextValue {
  state: MockAppState;
  isHydrated: boolean;
  latestStrategy: WeeklyConstraintSet;
  latestPlan: MockAppState['plans'][number] | null;
  generatePlan: (input: StrategyDraftInput) => { success: boolean; message: string };
  importCsvText: (fileText: string) => { success: boolean; message: string; errors?: string[] };
  upsertEntity: (kind: 'agents' | 'channels' | 'projects', entity: Partial<Agent & Channel & Project> & { id?: string; name: string }) => void;
  toggleEntityActive: (kind: 'agents' | 'channels' | 'projects', id: string) => void;
  addAgentRecord: (record: Omit<PerformanceRecord, 'id' | 'activationCost' | 'channelName' | 'agentName' | 'projectName'>) => void;
  resetDemo: () => void;
}

const MockAppContext = createContext<MockAppContextValue | null>(null);

function createInitialState(): MockAppState {
  const seed = createSeedState();
  const initialStrategy = buildStrategyFromTemplate(mockStrategyTemplate);
  const initialPlan = generateAllocationPlan(
    initialStrategy,
    seed.records,
    seed.channels,
    seed.agents,
    [],
    mockStrategyTemplate.reason
  );

  return {
    ...seed,
    strategies: [initialStrategy],
    plans: [initialPlan],
  };
}

export function MockAppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MockAppState>(createInitialState);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let hydrationTimer = 0;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        startTransition(() => {
          setState(JSON.parse(raw) as MockAppState);
        });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    hydrationTimer = window.setTimeout(() => {
      setIsHydrated(true);
    }, 0);

    return () => {
      window.clearTimeout(hydrationTimer);
    };
  }, []);

  useEffect(() => {
    if (isHydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [isHydrated, state]);

  const latestStrategy = useMemo(
    () => state.strategies.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0],
    [state.strategies]
  );

  const latestPlan = useMemo(
    () => state.plans
      .filter((plan) => plan.strategyId === latestStrategy.id)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0] || null,
    [latestStrategy.id, state.plans]
  );

  const generatePlan = useCallback((input: StrategyDraftInput) => {
    const constraintSum = input.channelShareConstraints.reduce((sum, item) => sum + item.minShare, 0);
    if (constraintSum > 1) {
      return { success: false, message: '渠道最小占比总和不能超过 100%。' };
    }

    const strategyId = `strategy-${input.weekStart}`;
    const existing = state.strategies.find((strategy) => strategy.id === strategyId);
    const strategy: WeeklyConstraintSet = existing ? {
      ...existing,
      weekEnd: input.weekEnd,
      budgetUpperBound: input.budgetUpperBound,
      minActivations: input.minActivations,
      minRetentionDay1: input.minRetentionDay1,
      minRetentionDay7: input.minRetentionDay7,
      channelShareConstraints: input.channelShareConstraints,
      updatedAt: dayjs().toISOString(),
    } : buildStrategyFromTemplate(input);

    const previousVersions = state.plans.filter((plan) => plan.strategyId === strategy.id);
    const nextPlan = generateAllocationPlan(
      strategy,
      state.records,
      state.channels,
      state.agents,
      previousVersions,
      input.reason
    );

    setState((prev) => ({
      ...prev,
      strategies: existing
        ? prev.strategies.map((item) => item.id === strategy.id ? strategy : item)
        : [...prev.strategies, strategy],
      plans: [...prev.plans.filter((plan) => plan.id !== nextPlan.id), nextPlan],
    }));

    return { success: true, message: `已生成第 ${nextPlan.versionNumber} 版预算方案。` };
  }, [state.agents, state.channels, state.plans, state.records, state.strategies]);

  const importCsvText = useCallback((fileText: string) => {
    const { records, errors } = parsePerformanceCsv(fileText);
    if (errors.length > 0) {
      return { success: false, message: 'CSV 导入失败，请修正格式后重试。', errors };
    }

    const newRecords: PerformanceRecord[] = records.map((record) => {
      const channel = state.channels.find((item) => item.name === record.channelName);
      const agent = state.agents.find((item) => item.name === record.agentName);
      const project = state.projects.find((item) => item.name === record.projectName);

      return {
        ...record,
        id: `import-${record.date}-${record.channelName}-${record.agentName}-${record.projectName}`,
        channelId: channel?.id || `channel-import-${record.channelName}`,
        agentId: agent?.id || `agent-import-${record.agentName}`,
        projectId: project?.id || `project-import-${record.projectName}`,
      };
    });

    setState((prev) => ({
      ...prev,
      records: [...prev.records, ...newRecords],
    }));

    return { success: true, message: `已导入 ${newRecords.length} 条历史数据。` };
  }, [state.agents, state.channels, state.projects]);

  const upsertEntity = useCallback((kind: 'agents' | 'channels' | 'projects', entity: { id?: string; name: string }) => {
    setState((prev) => {
      const collection = prev[kind] as Array<Agent | Channel | Project>;
      const now = dayjs().toISOString();
      const nextEntity = entity.id
        ? collection.map((item) => item.id === entity.id ? { ...item, name: entity.name, updated_at: now } : item)
        : [...collection, {
          id: `${kind}-${Math.random().toString(36).slice(2, 10)}`,
          name: entity.name,
          is_active: true,
          created_at: now,
          updated_at: now,
        }];

      return {
        ...prev,
        [kind]: nextEntity,
      };
    });
  }, []);

  const toggleEntityActive = useCallback((kind: 'agents' | 'channels' | 'projects', id: string) => {
    setState((prev) => ({
      ...prev,
      [kind]: (prev[kind] as Array<Agent | Channel | Project>).map((item) => (
        item.id === id ? { ...item, is_active: !item.is_active, updated_at: dayjs().toISOString() } : item
      )),
    }));
  }, []);

  const addAgentRecord = useCallback((record: Omit<PerformanceRecord, 'id' | 'activationCost' | 'channelName' | 'agentName' | 'projectName'>) => {
    const channel = state.channels.find((item) => item.id === record.channelId);
    const agent = state.agents.find((item) => item.id === record.agentId);
    const project = state.projects.find((item) => item.id === record.projectId);

    if (!channel || !agent || !project) {
      return;
    }

    const nextRecord: PerformanceRecord = {
      ...record,
      id: `manual-${record.date}-${record.channelId}-${record.agentId}-${record.projectId}`,
      channelName: channel.name,
      agentName: agent.name,
      projectName: project.name,
      activationCost: record.activations > 0 ? Number((record.cost / record.activations).toFixed(2)) : 0,
    };

    setState((prev) => ({
      ...prev,
      records: [
        ...prev.records.filter((item) => item.id !== nextRecord.id),
        nextRecord,
      ],
    }));
  }, [state.agents, state.channels, state.projects]);

  const resetDemo = useCallback(() => {
    const next = createInitialState();
    startTransition(() => {
      setState(next);
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const value = useMemo<MockAppContextValue>(() => ({
    state,
    isHydrated,
    latestStrategy,
    latestPlan,
    generatePlan,
    importCsvText,
    upsertEntity,
    toggleEntityActive,
    addAgentRecord,
    resetDemo,
  }), [addAgentRecord, generatePlan, importCsvText, isHydrated, latestPlan, latestStrategy, resetDemo, state, toggleEntityActive, upsertEntity]);

  return (
    <MockAppContext.Provider value={value}>
      {children}
    </MockAppContext.Provider>
  );
}

export function useMockApp() {
  const context = useContext(MockAppContext);
  if (!context) {
    throw new Error('useMockApp must be used within MockAppProvider');
  }

  return context;
}
