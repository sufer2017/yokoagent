'use client';

import React, { Suspense } from 'react';
import DataDashboard from '@/components/admin/DataDashboard';

export default function DataPage() {
  return (
    <Suspense fallback={null}>
      <DataDashboard />
    </Suspense>
  );
}
