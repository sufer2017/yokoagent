'use client';

import React, { Suspense } from 'react';
import AgentConsole from '@/components/agent/AgentConsole';

export default function AgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentConsole />
    </Suspense>
  );
}
