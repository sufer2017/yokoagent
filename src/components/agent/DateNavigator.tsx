'use client';

import React from 'react';
import { DatePicker, Button, Space } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

interface DateNavigatorProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

export default function DateNavigator({ value, onChange }: DateNavigatorProps) {
  const current = dayjs(value);

  const handlePrev = () => {
    onChange(current.subtract(1, 'day').format('YYYY-MM-DD'));
  };

  const handleNext = () => {
    const next = current.add(1, 'day');
    // Don't go beyond today
    if (next.isAfter(dayjs(), 'day')) return;
    onChange(next.format('YYYY-MM-DD'));
  };

  const handleDateChange = (date: Dayjs | null) => {
    if (date) {
      onChange(date.format('YYYY-MM-DD'));
    }
  };

  const isToday = current.isSame(dayjs(), 'day');

  return (
    <Space>
      <Button icon={<LeftOutlined />} onClick={handlePrev} />
      <DatePicker
        value={current}
        onChange={handleDateChange}
        disabledDate={(d) => d.isAfter(dayjs(), 'day')}
        allowClear={false}
        format="YYYY-MM-DD"
        style={{ width: 160 }}
      />
      <Button icon={<RightOutlined />} onClick={handleNext} disabled={isToday} />
      {!isToday && (
        <Button type="link" size="small" onClick={() => onChange(dayjs().format('YYYY-MM-DD'))}>
          回到今天
        </Button>
      )}
    </Space>
  );
}
